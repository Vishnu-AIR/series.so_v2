// Load environment variables from .env file
require("dotenv").config();

const connectDB = require("./config/mongoose");
const redisClient = require("./config/redis");
// Import the BullMQ config to initialize the queue and worker.
require("./config/bullmq");
const WhatsAppService = require("./services/whatsApp.service");
const LLMService = require("./services/llm.service");
const UserService = require("./services/user.service");
const QueryService = require("./services/query.service");
const OutreachService = require("./services/outreach.service");
const ToolDeclarations = require("./config/tools");

/**
 * Main function to initialize and run the application.
 */
async function main() {
  console.log("🚀 Initializing application...");

  // 1. Connect to primary and caching databases
  await connectDB();
  if (!redisClient.isOpen) {
    console.log("Connecting to Redis...");
    await redisClient.connect();
  }

  // 2. Initialize all services, injecting dependencies.
  const llmService = new LLMService();
  const userService = new UserService(redisClient);
  const queryService = new QueryService();
  const outreachService = new OutreachService(
    userService,
    queryService,
    llmService
  );
  const whatsAppService = new WhatsAppService(outreachService);
  // 2. Inject the whatsAppService into outreachService to enable direct sending
  outreachService.setWhatsAppService(whatsAppService);
  llmService.registerTools([
    {
      // Get the declaration from the centralized class
      declaration: ToolDeclarations.handleEndOfSession(),
      // Pass the actual function from the outreachService instance
      execute: outreachService.handleEndOfSession.bind(outreachService),
    },
    // To add another tool, call its static method: ToolDeclarations.scheduleFollowUp()
  ]);

  // 3. Start the WhatsApp service to connect and listen for messages.
  await whatsAppService.initialize();

  console.log("✅ Application is running and connected to WhatsApp.");
  console.log("🎧 Worker is listening for outreach jobs in the background.");
}

// Start the application and catch any critical errors.
main().catch((err) => {
  console.error("❌ An unexpected error occurred during startup:", err);
  process.exit(1);
});
