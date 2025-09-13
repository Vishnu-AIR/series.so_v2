const sessionService = require("../services/session.service");

/**
 * Creates and returns a tool object for handling the end of a user session.
 * This factory function encapsulates the tool's declaration and execution logic.
 *
 * @returns {object} An object containing the tool's `declaration` and `execute` function.
 */
function createHandleEndOfSessionTool() {
  // --- 1. Tool Declaration ---
  // This is the definition that you pass to the Gemini model. It describes what the tool does and what parameters it needs.
  const declaration = {
    name: "handleEndOfSession",
    description: "Handles the end of a user's conversational session. Use this when the user indicates they are finished or the conversation is complete.",
    parameters: {
      type: "OBJECT",
      properties: {
        userType: {
          type: "STRING",
          description: "The user's current type, for example: 'freelancer', 'client', or 'candidate'.",
        },
        jid: {
          type: "STRING",
          description: "The unique JID (Jabber ID) of the user whose session is being concluded.",
        },
        usersNewType: {
          type: "STRING",
          description: "The new type to be assigned to the user after this session, as determined by the conversation.",
        },
      },
      required: ["userType", "jid", "usersNewType"],
    },
  };

  // --- 2. Tool Execution Logic ---
  // This is the actual JavaScript function that runs when the model decides to use the tool.
  /**
   * Executes the logic to end a session, such as logging and cleanup.
   * @param {object} args - The arguments provided by the model, matching the parameters in the declaration.
   * @param {string} args.userType - The user's current type.
   * @param {string} args.jid - The JID of the user.
   * @param {string} args.usersNewType - The new type to assign to the user.
   * @returns {Promise<object>} A promise that resolves to an object confirming the session has ended.
   */
  async function execute({ userType, jid, usersNewType }) {
    console.log(`[Tool Executed] Ending session for ${userType} with JID: ${jid}. Assigning new type: ${usersNewType}.`);

    // In a real application, you would add logic here to:
    // 1. Update the user's profile in the database with the 'usersNewType'.
    // 2. Save the final conversation state to a database.
    // 3. Log session metrics for analytics.
    // 4. Perform any necessary cleanup tasks.
    sessionService(jid, userType, usersNewType);

    return {
      success: true,
      message: `Session for user ${jid} concluded. User type has been updated to ${usersNewType}.`,
    };
  }

  // --- 3. Return the combined tool object ---
  return {
    declaration,
    execute,
  };
}

// --- 4. Default Export ---
// Export the factory function as the default export of this module.
module.exports = createHandleEndOfSessionTool;

