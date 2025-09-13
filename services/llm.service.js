// src/ai/geminiService.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSysPrompt } = require("../prompts/getPrompt");
const createHandleEndOfSessionTool = require("../config/tools");

require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generates a reply using the Gemini model, handling tool calls and conversation history dynamically.
 * This function is decoupled from the data storage and specific tool implementations.
 *
 * @param {string} jid The user's JID (for logging and passing to tools).
 * @param {string} messageContent The new message from the user.
 * @param {Array<object>} context The current conversation history.
 * @param {string} sysPrompt The system instruction/prompt for the model.
 * @param {object} [tools={}] - The tool definitions to be passed to the Gemini model. Defaults to an empty object.
 * @param {object} [toolFunctions={}] - An object mapping tool names to their implementation functions. Defaults to an empty object.
 * @returns {Promise<string>} A promise that resolves to a string containing the AI's reply.
 */
async function generateReply(
    jid,
    messageContent,
    context,
    sysPrompt,
    tools = {},
    toolFunctions = {}
) {
    console.log(`Generating reply for ${jid}...`);

    // Use the provided context directly. It's a good practice to work on a copy.
    const history = [...context];

    try {
        // The 'tools' object is now passed in dynamically.

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", // Using the latest flash model
            tools,
            systemInstruction: sysPrompt,
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(messageContent);
        const response = result.response;
        const functionCalls = response.functionCalls();

        let replyText;

        if (functionCalls && functionCalls.length > 0) {
            console.log("Gemini requested a tool call:", functionCalls[0].name);
            const call = functionCalls[0];

            // The 'toolFunctions' object is now passed in dynamically.
            if (toolFunctions[call.name]) {
                // NOTE: You will need to decide how to pass 'sock' if it's needed by the tool functions.
                // It could be passed into generateReply, or bundled with the toolFunctions.
                // For this example, I am removing it from the direct call.
                const apiResponse = await toolFunctions[call.name](call.args, jid);

                const result2 = await chat.sendMessage([
                    { functionResponse: { name: call.name, response: apiResponse } },
                ]);
                replyText = result2.response.text();
            } else {
                console.warn(`Unknown tool called: ${call.name}`);
                replyText = "Sorry, I tried to use a tool that I don't recognize.";
            }
        } else {
            replyText = response.text();
            console.log("Gemini did not request any tool calls.", replyText);
        }

        return replyText;
    } catch (error) {
        console.error("Error during Gemini AI call:", error);
        // await delay(2000); // brief pause before retrying
        return `Sorry, I had a little trouble thinking. Could you please try again? /n ${error}`;
    }
}

class LLMService {
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
        const initialCandidates = await hybrid_search(nlpQuery);

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

    async qualifyUserForReachOut(reachOut, messageHistory) {
        const prompt = `
            Analyze the user's response for the outreach regarding: "${reachOut.queryId.query}".
            Based on the conversation history, determine if they qualify.
            and answer in one WORD from [qualify, fail].
        `;
        const sp = await getSysPrompt(userType);
        const response = await generateReply(jid, prompt, messageHistory, sp);
        return response.trim().toLowerCase();
    }

    async generateGeneralReply(user, prompt, messageHistory) {
        const sysPrompt = await getSysPrompt(user.type);
        const handleEndOfSessionTool = await createHandleEndOfSessionTool();

        // 1. Define the tools and functions for this specific call using the imported object.
        const tools = {
            functionDeclarations: [handleEndOfSessionTool.declaration],
        };

        const toolFunctions = {
            // Use the tool's name from its declaration as the key
            [handleEndOfSessionTool.declaration.name]: handleEndOfSessionTool.execute,
        };

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

module.exports = LLMService;
