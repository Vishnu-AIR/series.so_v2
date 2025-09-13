const { createClient } = require('redis');

// Create a Redis client instance.
// The client will automatically try to connect to the Redis server
// specified in the REDIS_URL environment variable or default to localhost.
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Event listener for successful connection.
redisClient.on('connect', () => {
    console.log('📦 Redis connected successfully.');
});

// Event listener for connection errors.
redisClient.on('error', (err) => {
    console.error('❌ Redis connection error:', err);
});

// The client is exported directly. The connection is managed automatically.
// For modern versions of the `redis` package, you connect explicitly where needed
// or rely on it auto-connecting on the first command. We will connect in app.js.
module.exports = redisClient;
