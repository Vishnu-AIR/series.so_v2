const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Mongoose schema for a ReachOut document.
 */
const reachOutSchema = new Schema(
  {
    /**
     * A reference to the user who initiated the reach-out.
     * Links to the 'User' collection.
     */
    targetId: {
      type: String,
      required: true,
    },

    /**
     * A reference to a related query, if applicable.
     * Links to the 'Query' collection.
     */
    queryId: {
      type: Schema.Types.ObjectId,
      ref: "Query", // Assumes you have a 'Query' model
      required: true,
    },

    /**
     * The current status of the reach-out process.
     * Must be one of the predefined values.
     */
    status: {
      type: String,
      required: true,
      enum: ["init", "qualify", "hold", "fail"],
      default: "hold",
    },

    /**
     * The type of reach-out action.
     * Must be one of the predefined values.
     */
    type: {
      type: String,
      required: true,
      enum: ["ask", "notify"],
    },

    /**
     * Additional metadata related to the reach-out.
     * Can store any extra information as a flexible object.
     */
    userInfo: {
      type: String,
      default: "",
    },

    /**
     * Indicates if the reach-out process has ended.
     */
    end: {
      type: Boolean,
      default: false,
    },

    /**
     * Timestamps for document creation and last update.
     */
  },
  { timestamps: true }
); // Automatically adds createdAt and updatedAt fields

// Create and export the model
const ReachOut = mongoose.model("ReachOut", reachOutSchema);

module.exports = ReachOut;
