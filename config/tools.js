/**
 * A centralized library for defining the schemas (declarations) of all custom tools
 * that the AI can use. This keeps the main application logic clean and organized.
 */
class ToolDeclarations {
  /**
   * Returns the declaration for the 'handleEndOfSession' tool.
   * @returns {object} The tool's schema.
   */
  static handleEndOfSession() {
    return {
      name: "handleEndOfSession",
      description:
        "Handles the end of a user's conversational session. Use this when the user indicates they are finished or the conversation is complete.",
      parameters: {
        type: "OBJECT",
        properties: {
          userType: {
            type: "STRING",
            description:
              "The user's current type, for example: 'freelancer', 'client', or 'candidate'.",
          },
          // jid: {
          //   type: "STRING",
          //   description:
          //     "The unique JID (Jabber ID) of the user whose session is being concluded.",
          // },
          newUserType: {
            type: "STRING",
            description:
              "The new type to be assigned to the user after this session, as determined by the conversation.",
          },
        },
        required: ["userType", "newUserType"],
      },
    };
  }

  /**
   * To add a new tool in the future, simply create another static method here.
   * For example:
   *
   * static scheduleFollowUp() {
   * return {
   * name: "scheduleFollowUp",
   * description: "Schedules a follow-up meeting with a user.",
   * ...and so on
   * };
   * }
   */
}

module.exports = ToolDeclarations;
