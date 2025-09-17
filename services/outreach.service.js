const { getSysPrompt } = require("../prompts/getPrompt");
const ReachOutService = require("./reachOut.service");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    this.reachOutService = new ReachOutService(); // Instantiate the new service here
    this.whatsAppService = null;
  }

  /**
   * Allows the main application to inject the WhatsAppService instance.
   * @param {WhatsAppService} waService - The instance of the WhatsApp service.
   */
  setWhatsAppService(waService) {
    this.whatsAppService = waService;
    console.log("[OutreachService] WhatsApp service has been set.");
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

      hasMedia: messageData.isMedia || false,
      mediaType: messageData.mediaType || "null",
      mediaUrl: messageData.mediaUrl || null, //need to be done from s3/aws
    });
    if(messageData.isMedia && messageData.mediaType == "document"){
      //wait a min i am checking the document - send this mssg
      const waitMssg = "Wait a min... I am checking the data in the doc you sent";
      this.whatsAppService.sendMessage(messageData.jid , waitMssg);
      await this.userService.saveMessage({
        jid: user.jid,
        by: "model",
        type: user.type,
        content: waitMssg,
      });

      //check for the data inside
      const resumeJson = await this.llmService.classifyDocumentText(messageData.jid,messageData.retrievedText);
      if ( resumeJson.isResume ){
        const gotResumeMssg = "Yes, we have recieved your resume, thnx for sharing that";
        this.whatsAppService.sendMessage(messageData.jid , gotResumeMssg);
        await this.userService.saveMessage({
          jid: user.jid,
          by: "model",
          type: user.type,
          content: gotResumeMssg,
        });
        await this.userService.saveMessage({
          jid: user.jid,
          by: "user",
          type: user.type,
          content: "Ok! So now you have got my resume, whats the next step?",
        });
        //we need to call the vectorFastApi server here 
      }
      else{
        const notResumeMssg = "Sorry the doc you provided, we were not able to detect if that was your resume, plz try again.";
        this.whatsAppService.sendMessage(messageData.jid , notResumeMssg);
        this.userService.saveMessage({
          jid: user.jid,
          by: "model",
          type: user.type,
          content: notResumeMssg,
        });
        return;
      }
    }
    
    // Fetch the user's message history
    const messageHistory = await this.userService.getMessageHistory(user.jid);
    // Now route based on user type
    let prompt = messageData.content;
    if (user.type === "rof" || user.type === "roc") {
      const reachOut = await this.reachOutService.findReachOutById(
        user.currentReachout
      );
      const author = await this.userService.findOrCreateUser(
        reachOut.queryId.author_id
      );
      const NLP = reachOut.queryId.query;

      prompt = `CONTEXT FOR THE REACHOUT: ${
        author.name || "A user"
      } is hiring for a role: "${NLP}".
        
        
        USER MESSAGE: ${messageData.content}`;
    }
    const llmRes = await this.llmService.generateGeneralReply(
      user,
      prompt,
      messageHistory.reverse()
    );
    this.userService.saveMessage({
      jid: user.jid,
      by: "model",
      type: user.type,
      content: llmRes,
    });
    return llmRes;
  }

  // Tool handler for ending a session and updating user type
  async handleEndOfSession(args) {
    const { jid, userType, newUserType } = args;

    console.log(
      `[Tool Executed] Ending session for ${userType} with JID: ${jid}. Assigning new type: ${newUserType}.`
    );
    let result;
    try {
      switch (userType) {
        case "new":
          if (!newUserType) {
            console.warn("New user type not provided for 'new' user.");
            result =
              "Please specify if they are a candidate, freelancer, client, or HR.";
            break;
          }
          // Update user type in DB and cache
          const user = await this.userService.findOrCreateUser(jid);
          await this.userService.updateUser(user._id, { type: newUserType });
          // Inform the user about their updated status
          result = `now reply as if you were an established ${newUserType}.`;
          break;

        case "idol":
          result = this.handleIdolUser(jid, newUserType);
          break;

        case "roc":
        case "rof": // Combines 'roc' and 'rof'
          result = this.handleReachOutUser(jid);
          break;

        case "candidate":
        case "freelancer":
          result = this.handleProfileUpdate(jid);
          break;

        case "client":
        case "hr":
          result = this.handleQuery(jid);
          break;

        default:
          console.warn(`Unhandled user type: ${userType}`);
          result = "I'm not sure what you mean.";
      }
      return { success: true, status: result };
    } catch (error) {
      console.error(
        `[OutreachService] Error handling end of session: ${error.message}`
      );
      return { success: false, status: "Error", error: error.message };
    }
  }

  //--------------------------------separate functions to handle each user type----------------------------

  async handleIdolUser(jid, newUserType) {
    // Custom logic for 'idol' users
    const haveReachOuts = await this.checkReachOut(jid);
    if (haveReachOuts) {
      return "reachOuts sent";
    }
    if (!newUserType) {
      console.warn("New user type not provided for 'new' user.");
      return "Please specify if they are a candidate, freelancer, client, or HR.";
    }
    // Update user type in DB and cache
    const user = await this.userService.findOrCreateUser(jid);
    await this.userService.updateUser(user._id, { type: newUserType });
    // Inform the user about their updated status
    return `now reply as if you were an established ${newUserType}.`;
  }

  async handleReachOutUser(jid) {
    const user = await this.userService.findOrCreateUser(jid);
    const getConversation = await this.userService.getMessageHistory(jid);
    const reachOut = await this.reachOutService.findReachOutById(
      user.currentReachout
    );
    const isQualify = await this.llmService.qualifyUserForReachOut(
      user.type,
      reachOut,
      getConversation
    );

    if (isQualify === "qualify") {
      await this.reachOutService.updateReachOutStatus(reachOut._id, "qualify");
    } else if (isQualify === "fail") {
      await this.reachOutService.updateReachOutStatus(reachOut._id, "fail");
    } else {
      return;
    }
    const done = await this.queryService.isQuerySuccessful(
      reachOut.queryId._id
    );
    if (done) {
      const author = await this.userService.findOrCreateUser(
        reachOut.queryId.author_id
      );
      if (author && author.type === "idol") {
        await this.checkReachOut(author.jid);
      }
    }
    //update user.type to idol and currentReachout to null
    await this.userService.updateUser(user._id, {
      type: "idol",
      currentReachout: null,
    });
    await this.checkReachOut(jid);
    return "reachOut ended";

    // Custom logic for 'roc' and 'rof' users
  }

  async handleQuery(jid) {
    const messageHistory = await this.userService.getMessageHistory(jid);
    // update user type user type to idol and reply
    // const candidates = await this.llmService.findAndAnalyzeCandidates(
    //   messageHistory
    // );
    // analyze using LLM get candidates list
    await this.makeReachOut(
      jid,
      `SDE-1 with 1 year experience, proficient in C++ and Java, strong in Data Structures, Algorithms, System Design, and Problem Solving, with Zero to One project experience, available ASAP, for any location, salary 14-15 LPA."
Performing hybrid search for candidates..`,
      [{ name: "Aryan Banwala", phone: "919104270427", metadata: {} }]
    );
    const user = await this.userService.findOrCreateUser(jid);
    await this.userService.updateUser(user._id, {
      type: "idol",
      currentReachout: null,
    });
    await this.checkReachOut(jid);
    return "Query processed and reachOuts initiated.";
  }

  async handleProfileUpdate(jid) {
    const user = await this.userService.findOrCreateUser(jid);
    const messageHistory = await this.userService.getMessageHistory(jid);
    //update user.metadata
    const updatedInfo = await this.llmService.generateGeneralReply(
      user,
      `Based on the user convo history and user current profile give all the new things that user have told and will be useful for his future reachouts 
    
    user current profile : ${user.metadata}`,
      messageHistory
    );
    // user.metadata.updatedInfo = updatedInfo;
    //save user.type == "idol"
    await this.userService.updateUser(user._id, {
      type: "idol",
      metadata: user.metadata,
    });
    await this.checkReachOut(jid);
    //checkReachOut(jid)
  }

  //-------------------------Supporting functions----------------------------

  // Check for pending reachOuts and engage the user
  /**
   * Checks for and processes pending reach-outs for a given user.
   * @param {string} jid The user's JID.
   * @returns {Promise<boolean>} True if a reach-out was processed, false otherwise.
   */
  async checkReachOut(jid) {
    console.log(`[checkReachOut] Starting process for jid: ${jid}`);
    try {
      const messageHistory = await this.userService.getMessageHistory(jid);
      //
      //TODO: check if any successfull query results left
      //
      const reachOuts = await this.reachOutService.findHeldReachOutsForUser(
        jid
      );
      console.log(
        `[checkReachOut] Found: ${
          reachOuts ? reachOuts.length : 0
        } held reach-outs for jid: ${jid}`
      );

      let user = await this.userService.findOrCreateUser(jid);

      if (reachOuts && reachOuts.length > 0) {
        console.log(
          `[checkReachOut] Engaging user ${jid} with pending reach-outs.`
        );

        // Engage with the user and provide updates
        if (user.type === "new") {
          await this.whatsAppService.sendMessage(
            jid,
            `Hey 👋, it’s Maya! Go ahead & save my contact. I have a cool opportunity for you.`
          );
        } else {
          await this.whatsAppService.sendMessage(
            jid,
            `By the way i have few updates for you..`
          );
        }

        for (const reachOut of reachOuts) {
          console.log(
            `[checkReachOut] Processing reachOut ID: ${reachOut._id} of type: ${reachOut.type}`
          );

          if (reachOut.type === "ask") {
            const newUserType =
              reachOut.queryId.author_type == "hr" ? "roc" : "rof";
            const sysPrompt = getSysPrompt(newUserType);

            console.log(
              `[checkReachOut] Updating user ${user._id} type to '${newUserType}' and setting currentReachout to ${reachOut._id}.`
            );
            user = await this.userService.updateUser(user._id, {
              type: newUserType,
              currentReachout: reachOut._id,
            });

            const context = `
            You are about to start a conversation with user: ${
              user.name || "a user"
            }.
            The opportunity is about: "${reachOut.queryId.query}".
            This opportunity was created by a user who is a(n) "${
              reachOut.queryId.author_type
            } at CirclePe name Vishnu mathur".
          `;
            const task =
              "Your task is to craft a smooth opening message that introduces the opportunity and asks if they are interested in learning more. Follow flow defined in your system prompt.";

            console.log(
              `[checkReachOut] Generating LLM response for 'ask' flow.`
            );

            const llmResponse = await this.llmService.generateCustomReply(
              sysPrompt,
              `${context}\n\n${task}`,
              messageHistory
            );

            console.log(
              `[checkReachOut] LLM response generated. Saving message to history.`
            );

            await this.userService.saveMessage({
              jid: user.jid,
              by: "model",
              type: user.type,
              content: llmResponse,
            });

            console.log(
              `[checkReachOut] Sending 'ask' opening message to ${jid}.`
            );
            await this.whatsAppService.sendMessage(jid, llmResponse);

            console.log(
              `[checkReachOut] Updating reachOut ${reachOut._id} status to 'init'.`
            );
            await this.reachOutService.updateReachOutStatus(
              reachOut._id,
              "init"
            );

            console.log(
              `[checkReachOut] Finished 'ask' flow for one reach-out. Returning true.`
            );
            return true;
          }

          // Handle 'notify' type
          const sysPrompt = getSysPrompt("notify");

          console.log(
            `[checkReachOut] Generating LLM response for 'notify' flow.`
          );

          const context = `
            You are about to start a conversation with user: ${
              user.name || "a user"
            }.
            The opportunity is about: "${reachOut.queryId.query}".
            This opportunity was created by a user who is a(n) "${
              reachOut.queryId.author_type
            } at CirclePe name Vishnu mathur".
          `;
          task =
            "Your task is to craft a smooth opening message that introduces the opportunity and asks if they are interested in learning more. Follow flow defined in your system prompt.";

          const llmResponse = await this.llmService.generateCustomReply(
            sysPrompt,
            `${context}\n\n${task}`,
            messageHistory
          );
          console.log(`[checkReachOut] LLM response generated.`);

          console.log(
            `[checkReachOut] Updating reachOut ${reachOut._id} status to 'qualify'.`
          );
          await this.reachOutService.updateReachOutStatus(
            reachOut._id,
            "qualify"
          );

          console.log(
            `[checkReachOut] Saving 'notify' message to history for ${jid}.`
          );
          await this.userService.saveMessage({
            jid: user.jid,
            by: "model",
            type: user.type,
            content: llmResponse,
          });

          console.log(`[checkReachOut] Sending 'notify' message to ${jid}.`);
          await this.whatsAppService.sendMessage(jid, llmResponse);
        }
        console.log(
          `[checkReachOut] Finished processing all reach-outs. Returning true.`
        );
        return true;
      }

      console.log(
        `[checkReachOut] No held reach-outs for jid: ${jid}. No action taken.`
      );
      console.log(`[checkReachOut] Returning false.`);
      return false;
    } catch (error) {
      console.error(
        `[checkReachOut] An unexpected error occurred for jid: ${jid}. Error:`,
        error
      );
      // On error, we return false to indicate the process was not successful.
      return false;
    }
  }

  // Function to create reachOuts based on candidates from LLM analysis
  async makeReachOut(authorId, NLP, candidates) {
    console.log(
      `[makeReachOut] Initiating reachOut creation for authorId: ${authorId}`
    );
    // make a query with status init and get queryId
    const query = await this.queryService.createQuery(authorId, NLP);
    console.log(
      `[makeReachOut] Query created with ID: ${query._id} for NLP: "${NLP}"`
    );
    // loop through the candidates format : [{name,phone, metadata}, {name,phone, metadata}]
    for (const candidate of candidates) {
      if (!candidate || !candidate.phone) {
        console.warn(
          `[makeReachOut] Skipping candidate due to missing data: ${JSON.stringify(
            candidate
          )}`
        );
        continue;
      }
      const jid = `${candidate.phone}@s.whatsapp.net`;
      console.log(
        `[makeReachOut] Processing candidate: ${candidate.name}, JID: ${jid}`
      );
      // check candidate in db if not found create as user as "new"
      const user = await this.userService.findOrCreateUser(jid, candidate.name);
      console.log(
        `[makeReachOut] User found/created with ID: ${user._id}, type: ${user.type}`
      );
      // update profile user.metadata==candidate.metdata
      if (!user.metadata) {
        await this.userService.updateUser(user._id, {
          metadata: candidate.metadata,
        });
        console.log(
          `[makeReachOut] Updated user metadata for user ID: ${user._id}`
        );
      }
      // here anaylze based on user profile that wether need to ask user or notify him
      let type = "notify";
      if (
        query.author_type == "client" ||
        (query.author_type == "hr" && user.type == "new")
      ) {
        type = "ask";
      }
      console.log(
        `[makeReachOut] Determined reachOut type: ${type} for user ID: ${user._id}`
      );
      // save a reachOut to him from author with status:hold
      await this.reachOutService.createReachOut({
        targetId: user.jid,
        queryId: query._id,
        status: "hold",
        type: type,
      });
      console.log(
        `[makeReachOut] Created reachOut for user JID: ${user.jid}, query ID: ${query._id}, type: ${type}`
      );
      await this.checkReachOut(user.jid);
      await delay(1000); // Adding a small delay to avoid overwhelming the system
      console.log(
        `[makeReachOut] checkReachOut triggered for user JID: ${user.jid}`
      );
    }
    console.log(
      `[makeReachOut] Finished processing all candidates for authorId: ${authorId}`
    );
    // loop end
  }
}

module.exports = OutreachService;
