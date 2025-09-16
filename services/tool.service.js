/**
 * A generic factory function to create a tool for the AI.
 * It pairs a function declaration (for the AI to understand) with the
 * actual JavaScript function to execute.
 *
 * @param {object} declaration - The tool's schema, including its name, description, and parameters.
 * @param {Function} executeFunction - The async function to run when the tool is called.
 * @returns {object} A complete tool object with its declaration and an execute method.
 */
function createTool(declaration, executeFunction) {
  /**
   * The execute function that the LLM service will call.
   * It logs the tool execution and then calls the provided function with the AI's arguments.
   * @param {object} args - The arguments provided by the AI model.
   */
  async function execute(args) {
    console.log(
      `[Tool Executed] Calling tool: "${declaration.name}" with args:`,
      args
    );
    // Directly call the function passed into the factory.
    return executeFunction(args);
  }

  return {
    declaration,
    execute,
  };
}

module.exports = { createTool };
