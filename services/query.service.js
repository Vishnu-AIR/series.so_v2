const Query = require("../models/query.model");
const User = require("../models/user.model");
// Import the queue to add new jobs.
const { outreachQueue } = require("../config/bullmq");
const ReachOut = require("../models/reachOut.model");

class QueryService {
  /**
   * Manages the lifecycle of recruitment queries.
   */
  async createQuery(authorId, queryText) {
    const author = await User.findById(authorId).lean();
    if (!author || !["hr", "client"].includes(author.type)) {
      throw new Error("Only HR or Client users can create queries.");
    }

    const newQuery = await Query.create({
      author_id: authorId,
      author_type: author.type,
      query: queryText,
      status: "init",
    });

    // This is the critical change: Instead of processing here,
    // we add a job to the BullMQ queue. The worker will pick it up asynchronously.
    // await outreachQueue.add("process-new-query", {
    //   queryId: newQuery._id,
    // });

    console.log(
      `✅ Query ${newQuery._id} created and job added to the outreach queue.`
    );
    return newQuery;
  }

  /**
   * Retrieves a single query document by its MongoDB ObjectId.
   * @param {string} queryId - The ID of the query.
   * @returns {Promise<Object|null>} The query document or null if not found.
   */
  async getQueryById(queryId) {
    console.log(`📚 Fetching query details for ID: ${queryId}`);
    return Query.findById(queryId).lean();
  }

  async updateQueryStatus(queryId, newStatus) {
    return Query.findByIdAndUpdate(
      queryId,
      { status: newStatus },
      { new: true }
    );
  }

  async getSuccessfulQuery(queryId) {
    const queries = await Query.find({ _id: queryId, status: "success" });
    return queries;
  }

  async isQuerySuccessful(queryId) {
    const reachOuts = await ReachOut.find({ queryId });
    const qualifyCount = reachOuts.filter((ro) => ro.status === "qualify").length;
    if (qualifyCount > reachOuts.length / 2) {
      await this.updateQueryStatus(queryId, "success");
      return true;
    }
    return false;
  }
}

module.exports = QueryService;
