// src/ai/geminiService.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSysPrompt } = require("../prompts/getPrompt");
const axios = require("axios");
const { createTool } = require("./tool.service");
const textHelper = require("../helpers/text.helpers");

require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function isTransientError(err) {
  const msg = err && (err.message || err.toString()) || "";
  const code = err && (err.statusCode || err.code || err.status) || null;
  // treat 429, 5xx, "overload", "temporar", "unavailable" as transient
  return (
    (typeof code === "number" && [429, 500, 502, 503, 504].includes(code)) ||
    /429|503|temporar|overload|unavailable|rate limit/i.test(msg)
  );
}

/**
 * executeWithRetry: runs an async operation with exponential backoff + jitter
 * params:
 *  - op: a function that returns a Promise (the operation to retry)
 *  - opts: { maxAttempts, baseDelayMs, maxDelayMs, onRetry }
 */
async function executeWithRetry(op, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 5; // total tries (1 initial + 4 retries)
  const baseDelayMs = opts.baseDelayMs ?? 500; // initial backoff
  const maxDelayMs = opts.maxDelayMs ?? 10000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op(); // success -> return result
    } catch (err) {
      const lastAttempt = attempt === maxAttempts;
      if (!isTransientError(err) || lastAttempt) {
        // non-transient or no attempts left -> throw
        throw err;
      }
      // transient -> compute backoff + jitter and wait
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(1000, exponential));
      const wait = exponential + jitter;
      if (typeof opts.onRetry === "function") {
        try { opts.onRetry({ attempt, maxAttempts, err, wait }); } catch (_) {}
      } else {
        console.warn(`Transient error (attempt ${attempt}/${maxAttempts}). Retrying in ${wait}ms.`, err && (err.message || err));
      }
      await sleep(wait);
      // then loop to retry
    }
  }
  // should never reach here
  throw new Error("executeWithRetry: exhausted retries");
}

async function generateReply(
  jid,
  messageContent,
  context,
  sysPrompt,
  tools = {},
  toolFunctions = {}
) {
  console.log(`Generating reply for ${jid}...`);
  const history = [...context];

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: sysPrompt,
      tools,
    });

    const chat = model.startChat({ history });
    const result = await executeWithRetry(
      () => chat.sendMessage(messageContent),
      {
        maxAttempts: 5,          // total attempts (tune as needed)
        baseDelayMs: 200,        // initial backoff
        maxDelayMs: 4000,        // max backoff
        onRetry: ({ attempt, maxAttempts, err, wait }) => {
          console.warn(`[AI retry] attempt ${attempt}/${maxAttempts} - will retry in ${wait}ms. error:`, err && (err.message || err));
        },
      }
    );
    const response = result.response;
    const functionCalls = response.functionCalls();
    console.log("functionCalls", functionCalls);
    if ( isTransientError(response.text()) ) return "Sorry, we are overloaded plz try again later."
    if (functionCalls && functionCalls.length > 0) {
      console.log("Gemini requested a tool call:", functionCalls[0].name);
      const call = functionCalls[0];
      console.log("Calls", call);

      if (toolFunctions[call.name]) {
        // The arguments from the AI are in call.args
        console.log(call.args);
        call.args.jid = jid; // Always pass the jid to the tool
        const apiResponse = await toolFunctions[call.name](call.args);
        // const result2 = await chat.sendMessage([
        //   { functionResponse: { name: call.name, response: apiResponse } },
        // ]);
        //return "Session Changed!";
      } else {
        return "Sorry, I tried to use a tool that I don't recognize.";
      }
    }
    console.log(`Generated reply for ${jid}: ${response.text()}`);
    return response.text();
  } catch (error) {
    console.error("Error during Gemini AI call:", error);
    return `Sorry, I had a little trouble thinking. Could you please try again? \n ${error}`;
  }
}

class LLMService {
  constructor() {
    // Use a Map to store registered tools by name for easy access.
    this.registeredTools = new Map();
  }
  /**
   * Registers a list of custom tools that the AI can use.
   * @param {Array<object>} tools - An array of tool configuration objects.
   * Each object must have a 'declaration' and an 'execute' function.
   */
  registerTools(tools = []) {
    for (const toolConfig of tools) {
      if (toolConfig.declaration && toolConfig.execute) {
        const tool = createTool(toolConfig.declaration, toolConfig.execute);
        this.registeredTools.set(tool.declaration.name, tool);
        console.log(`[LLMService] Registered tool: "${tool.declaration.name}"`);
      }
    }
  }
  
  /**
   * This service isolates all interactions with a Large Language Model.
   * By using structured JSON responses, it provides reliable, machine-readable
   * output for the rest of the application.
   */
  async generateCandidateList(NLP, candidates, messageHistory, maxRetries = 3) {
    const sysPrompt = `Analyze the provided list of candidates based on the following criteria: "${NLP}".
  
  You MUST return ONLY a valid JSON array of objects containing the best-selected candidates.
  Do not include any other text, explanations, backticks, or markdown formatting. Your entire response must be the raw JSON array.
  
  The format of the array must be exactly as follows:
  [
      {
          "name": "<name_of_candidate>",
          "phone": "<phone_of_candidate>",
          "metadata": "<all_other_info_about_the_candidate>"
      },
      ...
  ]`;

    let attempts = 0;
    while (attempts < maxRetries) {
      attempts++;
      console.log(`Attempt ${attempts} to generate a valid candidate list...`);

      try {
        // Convert the candidates data to a string to be included in the prompt.
        const candidatesString = JSON.stringify(candidates, null, 2);
        const responseText = await generateReply(
          {}, // jid (not needed for this specific task)
          `Here is the list of candidates:\n${candidatesString}`,
          messageHistory,
          sysPrompt
        );

        // 1. Attempt to parse the response string into a JavaScript object.
        const parsedResponse = JSON.parse(responseText);

        // 2. Validate that the parsed object is an array.
        if (Array.isArray(parsedResponse)) {
          console.log(
            "Successfully received and validated the candidate list."
          );
          return parsedResponse; // Success! Return the valid array.
        } else {
          // This handles cases where the LLM returns valid JSON that is not an array (e.g., an object).
          console.warn(
            `Attempt ${attempts} failed: Response was valid JSON but not an array.`,
            parsedResponse
          );
        }
      } catch (error) {
        // This handles cases where the LLM returns a string that isn't valid JSON.
        console.warn(
          `Attempt ${attempts} failed: Response was not valid JSON. Error: ${error.message}`
        );
        // The error is logged, and the loop will continue to the next attempt.
      }
    }

    // If the loop finishes without a valid response, it has failed.
    console.error(
      `Failed to generate a valid candidate list after ${maxRetries} attempts.`
    );
    return null; // Return null to indicate failure.
  }
  async classifyDocumentText(jid, resumeText, messageHistory = [], maxRetries = 2) {
    /**
     * - jid: chat id
     * - resumeText: extracted resume text (string)
     * - messageHistory: optional conversation history array (passed as context to the LLM)
     *
     * Returns:
     * {
     *   isResume: boolean,
     *   confidence: 0.0-1.0,
     *   reasons: [ "...", ... ],
     *   key_fields: { email, phone, name, top_skills:[], years_experience }
     * }
     */

    const sysPrompt = `
    You are a strict resume classifier. RETURN ONLY one JSON object (no prose, no markdown, no backticks).
    You will be given:
    - A short conversation history (context) and
    - The extracted document text (resume candidate).

    TASK:
    1) Decide whether the provided document text is a resume/CV belonging to the user (is_resume true/false).
      - Use clear resume signals (sections like "Experience", "Education", lists of skills, contact info, role titles, dates).
      - If the text is not clearly a resume, set is_resume = false.

    2) Provide:
      - "is_resume": true|false
      - "confidence": number between 0.0 and 1.0 (be conservative; low for uncertain)
      - "reasons": array of short factual strings justifying the decision (e.g., "has_email", "has_experience_section", "multiple_role_titles", "single_paragraph_bio").
      - "key_fields": object with any of these optional keys: "email", "phone", "name", "top_skills" (array), "years_experience".

    OUTPUT EXACT SCHEMA:
    {
      "is_resume": true|false,
      "confidence": 0.0-1.0,
      "reasons": ["..."],
      "key_fields": {
        "email": "...",
        "phone": "...",
        "name": "...",
        "top_skills": ["skill1","skill2"],
        "years_experience": "..."
      }
    }

    Be concise and conservative. Do NOT hallucinate personal attributes not present in the text. Use "unknown" or leave fields empty when uncertain.
    `;

    // LLM attempts
    let attempts = 0;
    while (attempts < maxRetries) {
      attempts++;
      try {
        // pass messageHistory as context so generateReply can include it in the model call
        const responseRaw = await generateReply(jid, resumeText, messageHistory, sysPrompt);
        const responseText = typeof responseRaw === "string" ? responseRaw : JSON.stringify(responseRaw);

        // cleaning
        let cleaned = String(responseText).trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").replace(/^`+|`+$/g, "");

        // try direct parse
        try {
          const parsed = JSON.parse(cleaned);
          return normalizeParsed(parsed);
        } catch (parseErr) {
          // fallback: extract first {...}
          const firstJsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (firstJsonMatch) {
            try {
              const parsed2 = JSON.parse(firstJsonMatch[0]);
              return normalizeParsed(parsed2);
            } catch (parseErr2) {
              console.warn(`[classifyDocumentText] fallback JSON parse failed: ${parseErr2.message}`);
            }
          }
          console.warn(`[classifyDocumentText] attempt ${attempts} parse failed: ${parseErr.message}`);
        }
      } catch (err) {
        console.warn(`[classifyDocumentText] attempt ${attempts} generateReply failed: ${err && err.message ? err.message : err}`);
      }
    }

    // LLM failed after retries -> heuristic fallback (lightweight)
    try {
      const text = String(resumeText || "").trim();
      const lower = text.toLowerCase();

      const email = (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/i) || [null])[0] || null;
      const phone = (text.match(/(\+?\d[\d\-\s]{6,}\d)/g) || [null])[0] || null;
      // name heuristics: "Name: X" or first capitalized two-word sequence near top
      const nameLabel = text.match(/name[:\-]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/);
      const nameMatch = nameLabel ? nameLabel[1] : (text.split("\n").slice(0, 5).join(" ").match(/[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}/) || [null])[0];

      // detect resume-like sections
      const hasExperience = /(^|\n)\s*(experience|work experience|professional experience)\s*[:\n]/i.test(text);
      const hasEducation = /(^|\n)\s*(education|qualifications)\s*[:\n]/i.test(text);
      const hasSkills = /(^|\n)\s*(skills|technical skills|core skills)\s*[:\n]/i.test(text);
      const hasRoleTitles = /\b(engineer|developer|designer|manager|consultant|analyst|director|lead)\b/i.test(text);

      // top skills seed
      const skillsSeed = ["react", "node", "python", "django", "aws", "docker", "figma", "ui/ux", "javascript", "typescript", "php", "wordpress"];
      const foundSkills = skillsSeed.filter(s => lower.includes(s));

      // years experience heur
      const years = (text.match(/(\d+)\s*(?:years|yrs|y)\b/i) || [null])[1] || null;

      const reasons = [];
      if (email) reasons.push(`has_email`);
      if (phone) reasons.push(`has_phone`);
      if (hasExperience) reasons.push(`has_experience_section`);
      if (hasEducation) reasons.push(`has_education_section`);
      if (hasSkills) reasons.push(`has_skills_section`);
      if (hasRoleTitles) reasons.push(`has_role_titles`);
      if (foundSkills.length) reasons.push(`found_skills:${foundSkills.join(",")}`);
      if (years) reasons.push(`mentioned_years:${years}`);

      // Basic decision logic: require at least two resume signals (email/phone/experience/education/skills/roleTitles)
      const signalCount = (email ? 1 : 0) + (phone ? 1 : 0) + (hasExperience ? 1 : 0) + (hasEducation ? 1 : 0) + (hasSkills ? 1 : 0) + (hasRoleTitles ? 1 : 0);
      const isLikelyResume = signalCount >= 2 || foundSkills.length >= 3;

      const confidence = Math.min(0.75, 0.15 * signalCount + (foundSkills.length ? 0.05 * foundSkills.length : 0) + (years ? 0.05 : 0));

      const key_fields = {
        email: email || null,
        phone: phone || null,
        name: nameMatch || null,
        top_skills: foundSkills,
        years_experience: years || null,
      };

      return {
        isResume: !!isLikelyResume,
        confidence: isLikelyResume ? Number(confidence.toFixed(2)) : Number((Math.max(0, confidence * 0.5)).toFixed(2)),
        reasons,
        key_fields,
      };
    } catch (fallbackErr) {
      return {
        isResume: false,
        confidence: 0,
        reasons: ["heuristic_failed"],
        key_fields: {},
      };
    }

    // normalizeParsed helper used after successful LLM parse
    function normalizeParsed(parsed) {
      const is_resume = !!parsed.is_resume || !!parsed.isResume || false;
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : (typeof parsed.confidence === "string" && !isNaN(parseFloat(parsed.confidence)) ? Math.max(0, Math.min(1, parseFloat(parsed.confidence))) : 0);
      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons
        : parsed.reasons
        ? [String(parsed.reasons)]
        : [];
      const key_fields = parsed.key_fields || parsed.keyFields || parsed.key_fields || {};

      // normalize top_skills to array if present
      if (key_fields.top_skills && !Array.isArray(key_fields.top_skills)) {
        key_fields.top_skills = String(key_fields.top_skills).split(/\s*,\s*/);
      }

      return {
        isResume: is_resume,
        confidence,
        reasons,
        key_fields,
      };
    }
  }


  // Simplified, no-heavy-normalization version.
// Assumes you already prepare/format messageHistory for generateReply (or pass an array of strings).
  async classifyPortfolioMatchFromHistory(jid, messageHistory = [], lastMessage = "", maxRetries = 2) {
    /**
     * Lightweight version (minimal normalization).
     * - messageHistory: array (preferably already formatted for your generateReply context)
     * - lastMessage: string (the most recent user msg — likely contains portfolio URL or portfolio text)
     *
     * Returns:
     * { isPortfolioOfUser: bool, confidence: 0..1, match_reasons: [], combined_profile: { ... } }
     */

    // quick helper to coerce history into a single short text block if generateReply expects plain context

    const sysPrompt = `
    You are a strict classifier. RETURN ONLY one JSON object (no prose, no markdown, no backticks).

    You are given:
    - User's recent conversation history (their own details)
    - Latest user message (may include a portfolio URL or portfolio text)

    TASK:
    1) Decide if the portfolio/text in the last message clearly belongs to the SAME user described in the conversation history.
      - Strong evidence required (matching name, email, phone, or consistent work details).
      - If the portfolio shows a different person (different name, company, role, etc.) → set "isPortfolioOfUser": false.
      - If uncertain or conflicting → default to false.

    2) If isPortfolioOfUser = true, synthesize a "combined_profile" with as many inferred fields as possible:
      - name, email, phone, top_skills (array), years_experience, experience_details,
        current_company, designation, total_projects_completed,
        preferred_clients (Indian/Foreign/Both/Unknown), portfolio_urls (array), notes.
      - Only use fields that are consistent across history and portfolio. Do NOT merge contradictory identities.

    3) Always include:
      - "match_reasons": array of short facts that justify your decision
      - "confidence": number 0.0-1.0 (low if weak signals, high only if clear match)

    OUTPUT SCHEMA (exact keys):
    {
      "isPortfolioOfUser": true|false,
      "confidence": 0.0-1.0,
      "match_reasons": ["..."],
      "combined_profile": {
        "name": "",
        "email": "",
        "phone": "",
        "top_skills": [],
        "years_experience": "",
        "experience_details": "",
        "current_company": "",
        "designation": "",
        "total_projects_completed": "",
        "preferred_clients": "Indian|Foreign|Both|Unknown",
        "portfolio_urls": [],
        "notes": ""
      }
    }

    STRICT RULES:
    - Do NOT hallucinate or merge details from two different people.
    - If names or identities differ, immediately return isPortfolioOfUser = false.
    - If unsure → isPortfolioOfUser = false, confidence low, combined_profile mostly empty.
    `;

    // Try LLM a few times
    let attempts = 0;
    while (attempts < maxRetries) {
      attempts++;
      try {
        // Pass messageHistory as context so your generateReply can include full history in the model call.
        const responseRaw = await generateReply(jid, lastMessage, messageHistory, sysPrompt,[{ urlContext: {} },{ googleSearch: {} }]);
        const responseText = typeof responseRaw === "string" ? responseRaw : JSON.stringify(responseRaw);

        // minimal cleaning
        let cleaned = String(responseText).trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").replace(/^`+|`+$/g, "");

        // try direct parse
        try {
          const parsed = JSON.parse(cleaned);
          return _normalize(parsed);
        } catch (err) {
          // try to pull first {...}
          const m = cleaned.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const parsed2 = JSON.parse(m[0]);
              return _normalize(parsed2);
            } catch (e2) {
              console.warn(`[classifyPortfolioMatchFromHistory] parse attempt ${attempts} failed:`, e2.message);
            }
          }
          console.warn(`[classifyPortfolioMatchFromHistory] parse attempt ${attempts} failed:`, err.message);
        }
      } catch (err) {
        console.warn(`[classifyPortfolioMatchFromHistory] generateReply attempt ${attempts} error:`, err && err.message ? err.message : err);
      }
    }

    // LLM failed -> small heuristic fallback using combined text
    try {
      const combined = (shortHistoryText + "\n\n" + String(lastMessage)).toLowerCase();

      const email = (combined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/i) || [null])[0];
      const phone = (combined.match(/(\+?\d[\d\-\s]{6,}\d)/g) || [null])[0];
      const years = (combined.match(/(\d+)\s*(?:years|yrs|y)\b/i) || [null])[1] || null;

      const skillsSeed = ["react", "node", "figma", "ui/ux", "design", "python", "django", "aws", "docker", "wordpress", "php", "nextjs", "javascript", "typescript"];
      const skills = skillsSeed.filter(s => combined.includes(s));

      const reasons = [];
      if (email) reasons.push(`email_detected:${email}`);
      if (phone) reasons.push("phone_detected");
      if (skills.length) reasons.push(`skills:${skills.join(",")}`);
      if (years) reasons.push(`years:${years}`);

      const isLikely = reasons.length > 0;

      return {
        isPortfolioOfUser: !!isLikely,
        confidence: Math.min(0.6, 0.1 + 0.15 * reasons.length),
        match_reasons: reasons,
        combined_profile: {
          name: null,
          email: email || null,
          phone: phone || null,
          top_skills: skills,
          years_experience: years || null,
          experience_details: null,
          current_company: null,
          designation: null,
          total_projects_completed: null,
          preferred_clients: "Unknown",
          portfolio_urls: [], // you said you handle URLs elsewhere
          notes: "heuristic fallback; LLM did not return valid JSON"
        }
      };
    } catch (fallbackErr) {
      return {
        isPortfolioOfUser: false,
        confidence: 0,
        match_reasons: ["fallback_failed"],
        combined_profile: {}
      };
    }

    // small normalizer for returned parsed JSON
    function _normalize(parsed) {
      const out = {
        isPortfolioOfUser: !!(parsed.isPortfolioOfUser || parsed.is_portfolio_of_user || parsed.isPortfolio || parsed.is_portfolio),
        confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : (parsed.confidence ? parseFloat(parsed.confidence) || 0 : 0),
        match_reasons: Array.isArray(parsed.match_reasons) ? parsed.match_reasons : (parsed.match_reasons ? [String(parsed.match_reasons)] : []),
        combined_profile: parsed.combined_profile || parsed.profile || {}
      };
      // ensure arrays exist
      out.combined_profile.top_skills = Array.isArray(out.combined_profile.top_skills) ? out.combined_profile.top_skills : (out.combined_profile.top_skills ? String(out.combined_profile.top_skills).split(/\s*,\s*/) : []);
      out.combined_profile.portfolio_urls = Array.isArray(out.combined_profile.portfolio_urls) ? out.combined_profile.portfolio_urls : (out.combined_profile.portfolio_urls ? [out.combined_profile.portfolio_urls] : []);
      return out;
    }
  }

  async classifyLinkedinMatchFromHistory(jid, messageHistory = [], lastMessage = "", maxRetries = 2) {
    /**
     * Detects whether the LinkedIn profile (URL) shared in lastMessage belongs to
     * the same user described in messageHistory.
     *
     * Returns:
     * {
     *   isLinkedinUserSame: true|false,
     *   confidence: 0.0-1.0,
     *   match_reasons: ["..."],
     *   combined_profile: {
     *     name: null,
     *     linkedin_url: null,
     *     linkedin_handle: null,    // last part of linkedin url, if available
     *     email: null,
     *     phone: null,
     *     top_skills: [],
     *     years_experience: null,
     *     experience_details: null,
     *     current_company: null,
     *     designation: null,
     *     total_projects_completed: null,
     *     preferred_clients: "Indian|Foreign|Both|Unknown",
     *     notes: ""
     *   }
     * }
     *
     * Strict rules:
     * - If identities conflict (different names/emails), return isLinkedinUserSame=false.
     * - If uncertain -> false with low confidence.
     */

    const sysPrompt = `
  You are a strict classifier. RETURN ONLY one JSON object (no prose, no markdown, no backticks).

  You are given:
  - User's recent conversation history (the user's self-reported details).
  - Latest user message which includes a LinkedIn profile URL (or text referencing it).

  TASK:
  1) Decide if the LinkedIn profile in the latest message clearly belongs to the SAME user described in the conversation history.
    - Strong evidence required: matching name, email, phone, company, role, or highly consistent work/skill details.
    - If the LinkedIn profile shows a different person (different name/email/clear identity mismatch) -> set "isLinkedinUserSame": false.
    - If uncertain or conflicting -> default to false.

  2) If isLinkedinUserSame = true, synthesize a "combined_profile" with as many safe fields as you can infer:
    - name, linkedin_url, linkedin_handle, email, phone, top_skills (array), years_experience,
      experience_details, current_company, designation, total_projects_completed,
      preferred_clients (Indian/Foreign/Both/Unknown), notes.
    - Only fill fields that are consistent between history and LinkedIn. Do NOT merge contradictory identities.

  3) Always include:
    - "match_reasons": array of short facts that justify your decision
    - "confidence": number 0.0-1.0 (low if weak signals)

  OUTPUT SCHEMA (exact keys):
  {
    "isLinkedinUserSame": true|false,
    "confidence": 0.0-1.0,
    "match_reasons": ["..."],
    "combined_profile": {
      "name": "",
      "linkedin_url": "",
      "linkedin_handle": "",
      "email": "",
      "phone": "",
      "top_skills": [],
      "years_experience": "",
      "experience_details": "",
      "current_company": "",
      "designation": "",
      "total_projects_completed": "",
      "preferred_clients": "Indian|Foreign|Both|Unknown",
      "notes": ""
    }
  }

  STRICT RULES:
  - Do NOT hallucinate or invent contact details or names.
  - If names or identities differ, immediately return isLinkedinUserSame = false.
  - If unsure → isLinkedinUserSame = false, confidence low, combined_profile mostly empty.
  `;

    // Try LLM a few times
    let attempts = 0;
    while (attempts < maxRetries) {
      attempts++;
      try {
        // Pass messageHistory as context so your generateReply can include full history in the model call.
        // adapt the extra context args to your generateReply signature if needed
        const responseRaw = await generateReply(jid, lastMessage, messageHistory, sysPrompt, [{ urlContext: {} }, { googleSearch: {} }]);
        const responseText = typeof responseRaw === "string" ? responseRaw : JSON.stringify(responseRaw);

        // minimal cleaning
        let cleaned = String(responseText).trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").replace(/^`+|`+$/g, "");

        // try direct parse
        try {
          const parsed = JSON.parse(cleaned);
          return _normalize(parsed);
        } catch (err) {
          // try to pull first {...}
          const m = cleaned.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              const parsed2 = JSON.parse(m[0]);
              return _normalize(parsed2);
            } catch (e2) {
              console.warn(`[classifyLinkedinMatchFromHistory] parse attempt ${attempts} failed:`, e2.message);
            }
          }
          console.warn(`[classifyLinkedinMatchFromHistory] parse attempt ${attempts} failed:`, err.message);
        }
      } catch (err) {
        console.warn(`[classifyLinkedinMatchFromHistory] generateReply attempt ${attempts} error:`, err && err.message ? err.message : err);
      }
    }
    const shortHistoryText = Array.isArray(messageHistory) ? messageHistory.slice(-20).join("\n") : String(messageHistory || "");
    
    // LLM failed -> small heuristic fallback using combined text
    try {
      const combined = (shortHistoryText + "\n\n" + String(lastMessage)).toLowerCase();

      // LinkedIn URL detection
      const linkedinUrlMatch = String(lastMessage).match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%\.]+/i);
      const linkedinUrl = linkedinUrlMatch ? linkedinUrlMatch[0] : (combined.match(/linkedin\.com\/in\/[a-zA-Z0-9\-_%\.]+/i) ? "https://www." + combined.match(/linkedin\.com\/in\/[a-zA-Z0-9\-_%\.]+/i)[0] : null);
      let linkedinHandle = null;
      if (linkedinUrl) {
        const mHandle = linkedinUrl.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%\.]+)/i);
        if (mHandle) linkedinHandle = mHandle[1];
      }

      // Extract simple signals
      const email = (combined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/i) || [null])[0];
      const phone = (combined.match(/(\+?\d[\d\-\s]{6,}\d)/g) || [null])[0];

      // Try to extract name tokens from history if someone said "I am X" or "I'm X"
      let name = null;
      const nameMatch = shortHistoryText.match(/\bI(?:'| a)?m\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/m);
      if (nameMatch) name = nameMatch[1];

      // If linkedin handle contains likely name parts, derive possible name
      if (!name && linkedinHandle) {
        const guess = linkedinHandle.replace(/[-._]/g, ' ').split(' ').map(s => s.trim()).filter(Boolean);
        if (guess.length >= 1 && guess[0].length > 1) {
          name = guess.map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
        }
      }

      // years experience
      const years = (combined.match(/(\d+)\s*(?:years|yrs|y)\b/i) || [null, null])[1] || null;

      // skills seed
      const skillsSeed = ["react", "node", "figma", "ui/ux", "design", "python", "django", "aws", "docker", "wordpress", "php", "nextjs", "javascript", "typescript"];
      const skills = skillsSeed.filter(s => combined.includes(s));

      // company / designation quick heuristics
      let current_company = null;
      let designation = null;
      const compMatch = combined.match(/works? at ([A-Z][a-zA-Z0-9&\-\s]{2,50})/i) || combined.match(/currently at ([A-Z][a-zA-Z0-9&\-\s]{2,50})/i);
      if (compMatch) current_company = compMatch[1].trim();

      const desigMatch = combined.match(/(senior|lead|manager|director|engineer|developer|designer|consultant)[\w\s\-]{0,30}/i);
      if (desigMatch) designation = (desigMatch[0] || "").trim();

      // build reasons
      const reasons = [];
      if (linkedinUrl) reasons.push(`linkedin_url_detected:${linkedinUrl}`);
      if (email) reasons.push(`email_detected:${email}`);
      if (phone) reasons.push("phone_detected");
      if (name) reasons.push(`name_possible:${name}`);
      if (skills.length) reasons.push(`skills:${skills.join(",")}`);
      if (years) reasons.push(`years:${years}`);
      if (current_company) reasons.push(`company:${current_company}`);

      // basic match decision: require >=1 strong signal (email/name/company) OR multiple skill/years signals
      const strongSignals = (email ? 1 : 0) + (name ? 1 : 0) + (current_company ? 1 : 0);
      const isLikely = linkedinUrl && (strongSignals >= 1 || reasons.length >= 2);

      return {
        isLinkedinUserSame: !!isLikely,
        confidence: isLikely ? Math.min(0.85, 0.3 + 0.15 * reasons.length) : Math.min(0.5, 0.1 * reasons.length),
        match_reasons: reasons,
        combined_profile: {
          name: name || null,
          linkedin_url: linkedinUrl || null,
          linkedin_handle: linkedinHandle || null,
          email: email || null,
          phone: phone || null,
          top_skills: skills,
          years_experience: years || null,
          experience_details: null,
          current_company: current_company || null,
          designation: designation || null,
          total_projects_completed: null,
          preferred_clients: "Unknown",
          notes: "heuristic fallback; LLM did not return valid JSON"
        }
      };
    } catch (fallbackErr) {
      return {
        isLinkedinUserSame: false,
        confidence: 0,
        match_reasons: ["fallback_failed"],
        combined_profile: {}
      };
    }

    // normalizer for returned parsed JSON
    function _normalize(parsed) {
      const out = {
        isLinkedinUserSame: !!(parsed.isLinkedinUserSame || parsed.is_linkedin_user_same || parsed.isLinkedin || parsed.is_linkedin),
        confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : (parsed.confidence ? parseFloat(parsed.confidence) || 0 : 0),
        match_reasons: Array.isArray(parsed.match_reasons) ? parsed.match_reasons : (parsed.match_reasons ? [String(parsed.match_reasons)] : []),
        combined_profile: parsed.combined_profile || parsed.profile || {}
      };

      // ensure arrays exist
      out.combined_profile.top_skills = Array.isArray(out.combined_profile.top_skills) ? out.combined_profile.top_skills : (out.combined_profile.top_skills ? String(out.combined_profile.top_skills).split(/\s*,\s*/) : []);
      return out;
    }
  }

  async findAndAnalyzeCandidates(messageHistory) {
    console.log("Starting the candidate finding and analysis process...");

    // --- Step 1: Generate the NLP query from the conversation ---
    const nlpGenerationPrompt = `Based on the following conversation history, create a concise, one-sentence summary of the ideal candidate being sought. This summary will be used as a search query. For example: "a senior javascript developer with react and node.js experience located in san francisco". Do not add any other explanatory text.`;

    const nlpQuery = await generateReply(
      {}, // jid
      "Generate a search query from this conversation.",
      messageHistory,
      nlpGenerationPrompt
    );

    if (!nlpQuery || nlpQuery.trim() === "") {
      console.error(
        "Failed to generate a valid NLP query from the message history."
      );
      return null;
    }
    console.log(`Generated NLP Query: "${nlpQuery}"`);

    // --- Step 2: Get the list of candidates using the NLP query ---
    // This is where you call your actual candidate retrieval function.
    console.log("Performing hybrid search for candidates...");
    const initialCandidates = await callHybridSearch(nlpQuery);

    if (!initialCandidates || initialCandidates.length === 0) {
      console.log("Hybrid search returned no candidates.");
      return []; // Return an empty array as no candidates were found
    }
    console.log(`Found ${initialCandidates.length} potential candidates.`);

    // --- Step 3: Analyze the candidates and return the final list ---
    console.log("Analyzing and formatting the candidate list...");
    const finalList = await this.generateCandidateList(
      nlpQuery,
      initialCandidates,
      messageHistory
    );

    return finalList;
  }

  async determineUserType(messageHistory) {
    const sp = `
            Analyze the following conversation history to determine the user's professional type.
            The possible types are: 'candidate', 'freelancer', 'client' or 'hr'.
        `;
    const response = await generateReply(jid, prompt, messageHistory, sp);
    return response;
  }

  async qualifyUserForReachOut(userType, reachOut, messageHistory) {
    const prompt = `
            Analyze the user's response for the outreach regarding: "${reachOut.queryId.query}".
            Based on the conversation history, determine if they qualify.
            and answer in one WORD from [qualify, fail].
        `;
    const sp = await getSysPrompt(userType);
    const response = await generateReply("...", prompt, messageHistory, sp);
    return response.trim().toLowerCase();
  }

  async generateCustomReply(sysPrompt, prompt, messageHistory) {
    const response = await generateReply("", prompt, messageHistory, sysPrompt);
    return response;
  }

  async genrateQuerySummary(reachouts, messageHistory) {
    const sysPrompt = await getSysPrompt("query_summary");
    const response = await generateReply(
      "genrating the query summary",
      `${reachouts} Summarize the above in the required format accoording to the system prompt only.`,
      messageHistory,
      sysPrompt
    );
    return response;
  }

  async genrateTheReachOutInfo(user, query,type){
    const sysPrompt = await getSysPrompt("reachout_info");
    const prompt = type == "ask" ? `genarate reply according to system prompt for following user name:${user.name} and info: ${user.metadata} based on conversation and base on query: ${query.query} and author type: ${query.author_type} based on conversation` : `genarate reply according to system prompt for following user name:${user.name} and info: ${user.metadata}, base on query: ${query.query} and author type: ${query.author_type} based on conversation`
    const response = await generateReply(
      "genrating the reachout info",
      prompt,
      [],
      sysPrompt
    );
    return response;

  }

  async generateGeneralReply(user, prompt, messageHistory) {
    const sysPrompt = await getSysPrompt(user.type);

    // 1. Define the tools and functions for this specific call using the imported object.
    const functionDeclarations = [];
    const toolFunctions = {};
    // Dynamically add any registered tools to the AI call
    if (this.registeredTools.size > 0) {
      for (const [name, tool] of this.registeredTools.entries()) {
        functionDeclarations.push(tool.declaration);
        toolFunctions[name] = tool.execute;
      }
    }
    const tools = { functionDeclarations };

    const response = await generateReply(
      user.jid,
      prompt,
      messageHistory,
      sysPrompt,
      tools,
      toolFunctions
    );
    return response;
  }
}


async function generateReply(
  jid,
  messageContent,
  context,
  sysPrompt,
  tools = {},
  toolFunctions = {}
) {
  console.log(`Generating reply for ${jid}...`);
  const history = [...context];

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: sysPrompt,
      tools,
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(messageContent);
    const response = result.response;
    const functionCalls = response.functionCalls();
    console.log("functionCalls", functionCalls);

    if (functionCalls && functionCalls.length > 0) {
      console.log("Gemini requested a tool call:", functionCalls[0].name);
      const call = functionCalls[0];
      console.log("Calls", call);

      if (toolFunctions[call.name]) {
        // The arguments from the AI are in call.args
        console.log(call.args);
        call.args.jid = jid; // Always pass the jid to the tool
        const apiResponse = await toolFunctions[call.name](call.args);
        // const result2 = await chat.sendMessage([
        //   { functionResponse: { name: call.name, response: apiResponse } },
        // ]);
        // return result2.response.text();
      } else {
        return "Sorry, I tried to use a tool that I don't recognize.";
      }
    }
    console.log(`Generated reply for ${jid}: ${response.text()}`);
    return response.text();
  } catch (error) {
    console.error("Error during Gemini AI call:", error);
    return `Sorry, I had a little trouble thinking. Could you please try again? \n ${error}`;
  }
}

/**
 * Calls the external hybrid search API.
 * @param {string} query The search query.
 * @returns {Promise<object>} The API response.
 */
const callHybridSearch = async (query) => {
  console.log(`Executing hybrid search for query: "${query}"`);
  try {
    const response = await axios.post(
      "http://35.170.249.113:8000/api/v1/hybridsearch",
      new URLSearchParams({ prompt: query }),
      {
        headers: {
          accept: "application/json",
          "x-api-key": "ok",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Hybrid Search API Error:", error.message);
    if (error.response) {
      console.error("Error Response:", error.response.data);
    }
    return { error: `API call failed: ${error.message}` };
  }
};


module.exports = LLMService;
