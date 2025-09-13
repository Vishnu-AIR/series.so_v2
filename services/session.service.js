const { getSysPrompt } = require("../prompts/getPrompt");
const LLMService = require("./llm.service");
const QueryService = require("./query.service");
const ReachOutService = require("./reachOut.service");
const UserService = require("./user.service");
const WhatsAppService = require("./whatsApp.service");

async function checkReachOut(jid) {
  const messageHistory = await UserService.getMessageHistory(jid);
  //
  //TODO: check if any successfull query results left
  //
  const reachOuts = UserService.getReachOutsByJid(jid);
  let user = await UserService.findOrCreateUser(jid);
  if (reachOuts && reachOuts.length > 0) {
    // Engage with the user and provide updates
    await WhatsAppService.sendMessage(jid, "BTW I have few updates for you.");
    for (const reachOut of reachOuts) {
      if (reachOut.type === "ask") {
        const sysPrompt = getSysPrompt(
          reachOut.queryId.authorType === "hr" ? "roc" : "rof"
        );
        const prompt = `Give an opening mssg for the user based on the his histroy to start the reachOut so that it feels smooth`;
        user = await UserService.updateUser(user._id, {
          type: reachOut.queryId.authorType === "hr" ? "roc" : "rof",
          currentReachout: reachOut._id,
        });

        const llmResponse = await LLMService.generateGeneralReply(
          user,
          prompt,
          messageHistory
        );
        await UserService.saveMessage({
          jid: user.jid,
          by: "model",
          type: user.type,
          content: llmResponse,
        });
        await WhatsAppService.sendMessage(jid, llmResponse);
        //update current reachout status to init
        await ReachOutService.updateReachOutStatus(reachOut._id, "init");
        //update user type to roc or rof
        return true;
      }
      const sysPrompt = getSysPrompt("notify");
      const prompt = `Give an opening mssg for the user based on the his histroy to start the reachOut so that it feels smooth to notify the user about the opportunity based on the following NLP: ${reachOut.queryId.queryText}`;
      const llmResponse = await LLMService.generateGeneralReply(
        user,
        prompt,
        messageHistory
      );
      await ReachOutService.updateReachOutStatus(reachOut._id, "qualify");
      await UserService.saveMessage({
        jid: user.jid,
        by: "model",
        type: user.type,
        content: llmResponse,
      });
      await WhatsAppService.sendMessage(jid, llmResponse);
    }
    return true;
  }
  return false;
}

async function handleIdolUser(jid, newUserType) {
  // Custom logic for 'idol' users
  const haveReachOuts = await checkReachOut(jid);
  if (haveReachOuts) {
    return "reachOuts sent";
  }
  if (!newUserType) {
    console.warn("New user type not provided for 'new' user.");
    return "Please specify if they are a candidate, freelancer, client, or HR.";
  }
  // Update user type in DB and cache
  const user = await UserService.findOrCreateUser(jid);
  await UserService.updateUser(user._id, { type: newUserType });
  // Inform the user about their updated status
  return `now reply as if you were an established ${newUserType}.`;
}

async function handleReachOutUser(jid) {
  const user = await UserService.findOrCreateUser(jid);
  const getConversation = await UserService.getMessageHistory(jid);
  const reachOut = await ReachOutService.findReachOutById(jid);
  const isQualify = await LLMService.qualifyUserForReachOut(
    reachOut,
    getConversation
  );

  if (isQualify === "qualify") {
    await ReachOutService.updateReachOutStatus(reachOut._id, "qualify");
  } else if (isQualify === "fail") {
    await ReachOutService.updateReachOutStatus(reachOut._id, "fail");
  }
  const done = await QueryService.isQuerySuccessful(reachOut.queryId._id);
  if (done) {
    const author = await UserService.findOrCreateUser(
      reachOut.queryId.authorId
    );
    if (author && author.type === "idol") {
      await checkReachOut(author.jid);
    }
  }
  //update user.type to idol and currentReachout to null
  await UserService.updateUser(user._id, {
    type: "idol",
    currentReachout: null,
  });
  await checkReachOut(jid);
  return "reachOut ended";

  // Custom logic for 'roc' and 'rof' users
}

async function makeReachOut(authorId, NLP, candidates) {
  // make a query with status init and get queryId
  const query = await QueryService.createQuery(authorId, NLP);
  // loop through the candidates format : [{name,phone, metadata}, {name,phone, metadata}]
  for (const candidate of candidates) {
    if (!candidate || !candidate.phone) {
      continue;
    }
    const jid = `${candidate.phone}@s.whatsapp.net`;
    // check candidate in db if not found create as user as "new"
    const user = await UserService.findOrCreateUser(jid, candidate.name);
    // update profile user.metadata==candidate.metdata
    if (!user.metadata)
      await UserService.updateUser(user._id, { metadata: candidate.metadata });
    // here anaylze based on user profile that wether need to ask user or notify him
    let type = "notify";
    if (query.type == "client" || (query.type == "hr" && user.type == "new")) {
      type = "ask";
    }
    // save a reachOut to him from author with status:hold
    await ReachOutService.createReachOut({
      targetId: user.jid,
      queryId: query._id,
      status: "hold",
      type: type,
    });
    await checkReachOut(user.jid);
  }
  // loop end
}

async function handleQuery(jid) {
  const messageHistory = await UserService.getMessageHistory(jid);
  // update user type user type to idol and reply
  const candidates = await LLMService.findAndAnalyzeCandidates(messageHistory);
  // analyze using LLM get candidates list
  await makeReachOut(jid, NLP, candidates);
  const user = await UserService.findOrCreateUser(jid);
  await UserService.updateUser(user._id, {
    type: "idol",
    currentReachout: null,
  });
  await checkReachOut(jid);
  return "Query processed and reachOuts initiated.";
}

async function handleProfileUpdate(jid) {
  const user = await UserService.findOrCreateUser(jid);
  const messageHistory = await UserService.getMessageHistory(jid);
  //update user.metadata
  const updatedInfo = await LLMService.generateGeneralReply(
    user,
    `Based on the user convo history and user current profile give all the new things that user have told and will be useful for his future reachouts 
    
    user current profile : ${user.metadata}`,
    messageHistory
  );
  user.metadata.updatedInfo = updatedInfo;
  //save user.type == "idol"
  await UserService.updateUser(user._id, {
    type: "idol",
    metadata: user.metadata,
  });
  await checkReachOut(jid);
  //checkReachOut(jid)
}

// This function manages the end of sessoins of the users
async function sessionService(jid, currentType, newUserType) {
  switch (currentType) {
    case "new":
      if (!newUserType) {
        console.warn("New user type not provided for 'new' user.");
        return "Please specify if they are a candidate, freelancer, client, or HR.";
      }
      // Update user type in DB and cache
      const user = await UserService.findOrCreateUser(jid);
      await UserService.updateUser(user._id, { type: newUserType });
      // Inform the user about their updated status
      return `now reply as if you were an established ${newUserType}.`;

    case "idol":
      return handleIdolUser(jid, newUserType);

    case "roc":
    case "rof": // Combines 'roc' and 'rof'
      return handleReachOutUser(jid);

    case "candidate":
    case "freelancer":
      return handleProfileUpdate(jid);

    case "client":
    case "hr":
      return handleQuery(jid);

    default:
      console.warn(`Unhandled user type: ${user.type}`);
      return "I'm not sure how to handle that right now.";
  }
}

module.exports = sessionService;
