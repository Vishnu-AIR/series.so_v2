const ReachOutService = require("./reachOut.service");

class OutreachService {
  /**
   * The OutreachService is the central coordinator for the application's business logic.
   * @param {UserService} userService - Service for user-related operations.
   * @param {QueryService} queryService - Service for query-related operations.
   * @param {LLMService} llmService - Service for LLM interactions.
   */
  constructor(userService, queryService, llmService) {
    this.userService = userService;
    this.queryService = queryService;
    this.llmService = llmService;
    // Instantiate the new service here
    this.reachOutService = new ReachOutService();
  }

  async handleIncomingMessage(messageData) {
    // According to the flowchart, the first step is always to check the user.
    // The diagram implies new users are created with type 'new', then defined.
    // Let's adjust findOrCreateUser to start them as 'new' for the definition step.
    const user = await this.userService.findOrCreateUser(
      messageData.jid,
      messageData.pushName
    );
    // Save the incoming message to the database
    // also update the redis cache within the same function
    await this.userService.saveMessage({
      jid: messageData.jid,
      by: "user",
      type: user.type,
      content: messageData.content,
    });
    // Fetch the user's message history
    const messageHistory = await this.userService.getMessageHistory(user.jid);
    // Now route based on user type
    const llmRes = await this.llmService.generateGeneralReply(
      user,
      messageData.content,
      messageHistory.slice(0, -1)
    );
    this.userService.saveMessage({
      jid: user.jid,
      by: "model",
      type: user.type,
      content: llmRes,
    });
    return llmRes;

    // switch (user.type) {
    //     case 'new':
    //         return this.handleNewUser(user, messageHistory);

    //     case 'idol':
    //         return this.handleIdolUser(user, messageHistory);

    //     case 'roc':
    //     case 'rof': // Combines 'roc' and 'rof'
    //         return this.handleOutreachResponse(user, messageHistory);
    //     case 'candidate':
    //     case 'freelancer':
    //     case 'client':
    //     case 'hr':
    //         return this.handleEstablishedUser(user, messageHistory);

    //     default:
    //         console.warn(`Unhandled user type: ${user.type}`);
    //         return "I'm not sure how to handle that right now.";
    // }
  }

  /**
   * Handles a message from an "idol" user (a potential candidate who messaged us first).
   */
  async handleIdolUser(user, messageHistory) {
    // 1. Check for any 'held' reach-outs for this user.
    const heldReachOuts = await this.reachOutService.findHeldReachOutsForUser(
      user._id
    );

    if (heldReachOuts && heldReachOuts.length > 0) {
      // 2. If reach-outs exist, inform the user and start the process.
      const firstReachOut = heldReachOuts[0];

      // Set user's current reachout and update their type to 'in_outreach'
      await this.userService.updateUser(user._id, {
        currentReachout: firstReachOut._id,
        type: "in_outreach",
      });

      // Update the reachout status from 'hold' to 'init'
      await this.reachOutService.updateReachOutStatus(
        firstReachOut._id,
        "init"
      );

      // Formulate the introductory message using the populated query text.
      const queryText = firstReachOut.queryId
        ? firstReachOut.queryId.query
        : "a potential opportunity";
      return `Thanks for reaching out! It's great timing, as I have some updates for you regarding ${queryText}. Would you be open to discussing it?`;
    } else {
      // 3. If no held reach-outs, provide a general reply.
      return this.llmService.generateGeneralReply(user.type, messageHistory);
    }
  }

  async handleNewUser(user, messageHistory) {
    const { type } = await this.llmService.determineUserType(messageHistory);

    // As per the diagram, the LLM defines the user type. 'idol' is a likely outcome for candidates.
    if (type && type !== "other") {
      await this.userService.updateUser(user._id, { type });
      return `Thanks for clarifying! I've updated your profile as a ${type}. How can I help you today?`;
    }
    return "Thanks for reaching out! To help me understand how I can assist, could you tell me a bit more about what you do?";
  }

  async handleOutreachResponse(user, messageHistory) {
    const mockReachOut = { queryId: { query: "Software Engineer role" } }; // This should be fetched
    const { decision } = await this.llmService.qualifyUserForReachOut(
      mockReachOut,
      messageHistory
    );

    let finalUserType = user.type; // Default to current
    // Here you would determine if they are a candidate or freelancer from the query.
    if (decision === "qualify") {
      finalUserType = "candidate";
    }

    await this.userService.updateUser(user._id, {
      type: finalUserType,
      currentReachout: null,
    });

    if (decision === "qualify") {
      return "That's great news! You seem like a good fit. We'll be in touch with the next steps shortly.";
    } else if (decision === "fail") {
      return "Thank you for your time. Based on your response, this doesn't seem to be the right fit at the moment.";
    } else {
      return "Thanks for the information. Could you please clarify a bit more about your experience with [specific skill]?";
    }
  }

  async handleEstablishedUser(user, prompt, messageHistory) {
    const llmRes = this.llmService.generateGeneralReply(
      user.type,
      prompt,
      messageHistory
    );

    return llmRes;
  }
}

module.exports = OutreachService;
