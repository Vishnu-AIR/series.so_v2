// src/ai/geminiService.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSysPrompt } = require("../prompts/getPrompt");
const axios = require("axios");
const { createTool } = require("./tool.service");

require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

  async qualifyUserForReachOut(userType,reachOut, messageHistory) {
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
