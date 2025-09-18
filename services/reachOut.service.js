const ReachOut = require("../models/reachOut.model");

class ReachOutService {
  /**
   * Manages all database interactions related to ReachOut documents.
   */

  /**
   * Creates a new ReachOut document in the database.
   * @param {Object} reachOutData - Data for the new reachOut.
   * @returns {Promise<Object>} The created ReachOut document.
   */
  async createReachOut(reachOutData) {
    return ReachOut.create(reachOutData);
  }

  /**
   * Finds a ReachOut by its ID.
   * @param {string} reachOutId - The MongoDB ObjectId of the reachOut.
   * @returns {Promise<Object>} The found reachOut document.
   */
  async findReachOutById(reachOutId) {
    return ReachOut.findById(reachOutId).populate("queryId").lean();
  }

  /**
   * Finds all ReachOuts for a specific user that are on 'hold'.
   * This is used for the "idol" user flow.
   * @param {string} userId - The MongoDB ObjectId of the user.
   * @returns {Promise<Array<Object>>} A list of held reachOuts, sorted by time.
   */
  async findHeldReachOutsForUser(userId) {
    // Populate the queryId to get the actual query text
    return ReachOut.find({ targetId: userId, status: "hold" })
      .sort({ createdAt: "asc" })
      .populate("queryId") // <-- This is the key change
      .lean();
  }

  /**
   * Updates the status of a specific ReachOut.
   * @param {string} reachOutId - The MongoDB ObjectId of the reachOut.
   * @param {string} newStatus - The new status (e.g., 'init', 'qualify', 'fail').
   * @returns {Promise<Object>} The updated reachOut document.
   */
  async updateReachOutStatus(reachOutId, newStatus) {
    return ReachOut.findByIdAndUpdate(
      reachOutId,
      { status: newStatus },
      { new: true }
    );
  }

  /**
   * Finds all ReachOuts for a specific queryId and status.
   * @param {string} queryId - The MongoDB ObjectId of the query.
   * @param {string} status - The status to filter by (e.g., 'init', 'qualify', 'hold', 'fail').
   * @returns {Promise<Array<Object>>} A list of matching reachOuts.
   */
  async findReachOutsByQueryIdAndStatus(queryId, status) {
    return ReachOut.find({ queryId: queryId, status: status })
      .populate("queryId")
      .lean();
  }

  /**
   * Updates the userInfo field for a specific ReachOut.
   * @param {string} reachOutId - The MongoDB ObjectId of the reachOut.
   * @param {string} userInfo - The new userInfo string to set.
   * @returns {Promise<Object>} The updated reachOut document.
   */
  async updateReachOutUserInfo(reachOutId, userInfo) {
    return ReachOut.findByIdAndUpdate(reachOutId, { userInfo }, { new: true });
  }

  /**
   * Set ReachOut End.
   * @param {string} reachOutId - The MongoDB ObjectId of the reachOut.
   * @returns {Promise<Object>} The updated reachOut document.
   */
  async endReachOut(reachOutId) {
    return ReachOut.findByIdAndUpdate(reachOutId, { end: true }, { new: true });
  }
}

module.exports = ReachOutService;
