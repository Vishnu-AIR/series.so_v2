const User = require("../models/user.model");
const Message = require("../models/message.model"); // Import the Message model

// Constants for cache keys and expiration times.
const USER_CACHE_PREFIX = "user:";
const HISTORY_CACHE_PREFIX = "history:";
const CACHE_EXPIRATION_SECONDS = 3600; // 1 hour
const HISTORY_LENGTH = 30; // Keep the last 30 messages in cache

class UserService {
  /**
   * @param {RedisClientType} redisClient - The connected Redis client instance.
   */
  constructor(redisClient) {
    this.redis = redisClient;
  }

  /**
   * Finds a user by JID, using Redis as a cache to reduce DB load.
   * Creates a new user if one is not found.
   * @param {string} jid - The user's JID.
   * @param {string} [pushName=''] - The user's display name.
   * @returns {Promise<Object>} The user document.
   */
  async findOrCreateUser(jid, pushName = "") {
    const cacheKey = `${USER_CACHE_PREFIX}${jid}`;
    const cachedUser = await this.redis.get(cacheKey);
    if (cachedUser) {
      console.log(`⚡️ Cache HIT for user: ${jid}`);
      return JSON.parse(cachedUser);
    }

    console.log(`🐢 Cache MISS for user: ${jid}. Querying MongoDB.`);
    let user = await User.findOne({ jid }).lean();

    if (!user) {
      const newUser = await User.create({
        jid,
        phone: jid.split("@")[0],
        name: pushName,
        type: "new",
        profile: "Newly created user.",
      });
      user = newUser.toObject();
    }

    await this.redis.set(cacheKey, JSON.stringify(user), {
      EX: CACHE_EXPIRATION_SECONDS,
    });
    return user;
  }

  /**
   * Finds potential candidates ("idol" users not in an active conversation).
   * @returns {Promise<Array<Object>>} A list of potential user documents.
   */
  async findPotentialCandidates() {
    console.log(
      "🔎 Searching for potential candidates (type: idol) in the database..."
    );
    return User.find({
      type: "idol",
      currentReachout: null,
    }).lean();
  }

  /**
   * Updates a user in both MongoDB and the Redis cache.
   * @param {string} userId - The MongoDB ObjectId of the user.
   * @param {Object} updateData - An object containing the fields to update.
   * @returns {Promise<Object>} The updated user document.
   */
  async updateUser(userId, updateData) {
    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).lean();
    if (updatedUser) {
      const cacheKey = `${USER_CACHE_PREFIX}${updatedUser.jid}`;
      console.log(`🔄 Updating cache for user: ${updatedUser.jid}`);
      await this.redis.set(cacheKey, JSON.stringify(updatedUser), {
        EX: CACHE_EXPIRATION_SECONDS,
      });
    }
    return updatedUser;
  }

  /**
   * Retrieves the recent conversation history. It first tries the Redis cache.
   * If the cache is empty, it falls back to MongoDB and repopulates the cache.
   * @param {string} jid - The user's JID.
   * @returns {Promise<Array<Object>>} The conversation history.
   */
  async getMessageHistory(jid) {
    const historyKey = `${HISTORY_CACHE_PREFIX}${jid}`;
    let history = await this.redis.lRange(historyKey, 0, -1);

    if (history.length === 0) {
      console.log(
        `📜 Cache MISS for history: ${jid}. Repopulating from MongoDB.`
      );
      // Fetch the last 20 messages from the database.
      const dbHistory = await Message.find({ jid })
        .sort({ timestamp: -1 })
        .limit(HISTORY_LENGTH)
        .lean();

      // If we found history, populate the cache. Note: we push in reverse order.
      if (dbHistory.length > 0) {
        const pipeline = this.redis.multi();
        // Iterate from oldest to newest to maintain order in the Redis list.
        for (let i = dbHistory.length - 1; i >= 0; i--) {
          const msg = dbHistory[i];
          const cacheMessage = { from: msg.by, text: msg.content };
          pipeline.lPush(historyKey, JSON.stringify(cacheMessage));
        }
        await pipeline.exec();
        history = await this.redis.lRange(historyKey, 0, -1);
      }
    }

    return history.map((msg) => JSON.parse(msg));
  }

  /**
   * The primary method for saving a message.
   * It saves the full message to MongoDB for persistence and then updates
   * the recent history cache in Redis for speed.
   * @param {Object} messageData - The full message object matching the Message schema.
   */
  async saveMessage(messageData) {
    // 1. Save to MongoDB for permanent storage.
    try {
      await Message.create(messageData);
      console.log(`💾 Message for ${messageData.jid} saved to MongoDB.`);
    } catch (error) {
      console.error("❌ Error saving message to MongoDB:", error);
      // Decide if you want to stop or continue if DB save fails
      return;
    }

    // 2. Update the Redis cache with the new message.
    const historyKey = `${HISTORY_CACHE_PREFIX}${messageData.jid}`;
    const cacheMessage = {
      role: messageData.by === "user" ? "user" : "model",
      parts: [{ text: messageData.content }],
    };
    await this.redis.lPush(historyKey, JSON.stringify(cacheMessage));
    // Trim the list to keep it from growing indefinitely.
    await this.redis.lTrim(historyKey, 0, HISTORY_LENGTH - 1);
    console.log(`🔄 Message cache updated for ${messageData.jid}.`);
  }
}

module.exports = UserService;
