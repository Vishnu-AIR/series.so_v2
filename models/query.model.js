const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Mongoose schema for a Query document.
 */
const querySchema = new Schema(
  {
    /**
     * A reference to the user who authored the query.
     * Links to the 'User' collection.
     */
    author_id: {
      type: String,
      required: true,
    },


    totalCount:{
      type: Number,
      default: 0,
    },

    count:{
      type: Number,
      default: 0,
    },

    /**
     * The text content of the query.
     */
    query: {
      type: String,
      required: true,
    },

    /**
     * The type of user who created the query.
     */
    author_type: {
      type: String,
      required: true,
      enum: ["hr", "client"],
    },

    /**
     * The current status of the query.
     * Must be one of the predefined values.
     */
    status: {
      type: String,
      required: true,
      enum: ["init", "success", "fail", "hold"],
      default: "init",
    },
  },
  { timestamps: true }
); // Automatically adds createdAt and updatedAt fields

// Create and export the model
const Query = mongoose.model("Query", querySchema);

module.exports = Query;
