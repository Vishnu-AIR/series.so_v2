const mongoose = require('mongoose');

/**
 * Establishes a connection to the MongoDB database using the URI
 * from the environment variables.
 */
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI , {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('📦 MongoDB connected successfully.');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        // Exit process with failure
        process.exit(1);
    }
};

module.exports = connectDB;

