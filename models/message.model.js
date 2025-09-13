const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  jid: { type: String, required: true },
  by: { type: String, required: true, enum: ["user", "model"] },
  type: {
    type: String,
    required: true,
    enum: ["new", "candidate", "freelancer", "rof", "roc", "hr", "client"],
  },
  reachOutModel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ReachOut", // Assumes you have a 'ReachOut' model
    default: null,
  },
  content: { type: String, required: true },
  hasMedia: { type: Boolean, default: false },
  mediaUrl: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
