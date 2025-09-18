const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  jid: { type: String, required: true },
  by: { type: String, required: true, enum: ["user", "model"] },
  type: {
    type: String,
    required: true,
    enum: ["new", "candidate", "freelancer", "rof", "roc", "hr", "client","idol"],
  },
  reachOutModel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ReachOut", // Assumes you have a 'ReachOut' model
    default: null,
  },
  content: { type: String, default: "" },
  hasMedia: { type: Boolean, default: false },
  mediaType: { 
    type: String, 
    enum: ["image", "video", "audio", "document", "sticker", "url", "linkedinUrl", "null"], 
    default: "null" 
  },
  mediaUrl: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
