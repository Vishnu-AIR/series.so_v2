const { Queue, Worker } = require('bullmq');
const redisClient = require('./redis'); // Use the same redis client
const outreachJobProcessor = require('../jobs/outreach.job');

// Create a new connection for BullMQ as it has specific requirements.
// It's best practice to duplicate the client connection for subscribers.
const queueConnection = {
    connection: redisClient.duplicate()
};

// 1. Create the Outreach Queue
// This queue will hold jobs related to finding and vetting candidates for a new query.
const outreachQueue = new Queue('outreach-queue', queueConnection);
console.log('👑 BullMQ Outreach Queue created.');


// 2. Create the Worker
// The worker listens to the queue and processes jobs as they come in.
// The actual logic for processing the job is in 'jobs/outreach.job.js'.
const outreachWorker = new Worker('outreach-queue', outreachJobProcessor, queueConnection);

outreachWorker.on('completed', job => {
  console.log(`✅ Job ${job.id} for query ${job.data.queryId} has completed!`);
});

outreachWorker.on('failed', (job, err) => {
  console.log(`❌ Job ${job.id} for query ${job.data.queryId} has failed with ${err.message}`);
});

// Export the queue so other services can add jobs to it.
module.exports = {
    outreachQueue
};

