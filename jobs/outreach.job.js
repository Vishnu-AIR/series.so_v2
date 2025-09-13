const UserService = require('../services/user.service');
const LLMService = require('../services/llm.service');
const ReachOutService = require('../services/reachOut.service');
const QueryService = require('../services/query.service');
const redisClient = require('../config/redis');

// Initialize services needed for the job processor.
// In a larger application, this might use a dependency injection container.
const userService = new UserService(redisClient);
const llmService = new LLMService();
const reachOutService = new ReachOutService();
const queryService = new QueryService();


/**
 * This is the core logic for the background job that processes a new query.
 * It follows the HR/Client flow from your diagram.
 * @param {Object} job - The job object from the BullMQ queue.
 */
const outreachJobProcessor = async (job) => {
    const { queryId } = job.data;
    console.log(`💼 Processing outreach job for Query ID: ${queryId}`);

    // 1. Get the actual query details from the database.
    const query = await queryService.getQueryById(queryId);
    if (!query) {
        console.error(`-- ❌ Query with ID ${queryId} not found. Aborting job.`);
        return;
    }

    // 2. Get a list of potential users to reach out to from the database.
    const potentialUsers = await userService.findPotentialCandidates();
    if (!potentialUsers || potentialUsers.length === 0) {
        console.log('-- 🤷 No potential candidates found. Ending job.');
        await queryService.updateQueryStatus(queryId, 'closed_no_candidates');
        return;
    }
    console.log(`-- Found ${potentialUsers.length} potential candidates.`);

    // 3. Iterate through the list of potential users.
    for (const user of potentialUsers) {
        // Ensure user has a profile to analyze. The user model should contain a 'profile' field.
        const userProfileText = user.profile || 'No profile information available.';
        console.log(`-- Vetting user ${user.name} for query ${queryId}`);

        // 4. Use LLM to compare user profile with the query's needs.
        const { decision } = await llmService.qualifyUserForReachOut(query, [{ from: 'system', text: `Profile: ${userProfileText}` }]);

        if (decision === 'qualify') {
            console.log(`-- 👍 User ${user.name} is a good fit. Creating ReachOut.`);
            // 5. Create the ReachOut document with status 'hold'.
            await reachOutService.createReachOut({
                targetId: user._id,
                queryId: query._id,
                type: query.type || 'ask', // Default to 'ask' if not specified
                status: 'hold',
            });
        } else {
            console.log(`-- 👎 User ${user.name} is not a fit.`);
        }
    }

    // 6. Update the query status after the loop.
    await queryService.updateQueryStatus(queryId, 'processing_complete');
    console.log(`✅ Finished processing outreach job for Query ID: ${queryId}`);
};

module.exports = outreachJobProcessor;

