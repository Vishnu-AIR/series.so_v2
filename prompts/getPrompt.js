// Import the 'fs' (file system) module with promise-based functions, and the 'path' module.
const fs = require('fs').promises;
const path = require('path');

/**
 * Asynchronously reads and returns the content of a .txt file from a specified directory.
 *
 * @param {string} fileBaseName - The base name of the file without the .txt extension (e.g., 'candidate').
 * @param {string} [directory="prompts"] - The directory where the file is located. Defaults to 'prompts'.
 * @returns {Promise<string>} A promise that resolves with the content of the file, or an error message if the file is not found or cannot be read.
 */
async function getSysPrompt(fileBaseName, directory = "prompts") {
    // Append the .txt extension to the base name
    const fileName = `${fileBaseName}.txt`;
    const filePath = path.join(directory, fileName);

    try {
        // Asynchronously read the file content using utf-8 encoding.
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (error) {
        // If the error code is 'ENOENT', it means the file or directory was not found.
        if (error.code === 'ENOENT') {
            return `Error: The file at '${filePath}' was not found.`;
        }
        // For any other errors, return a generic error message.
        return `An unexpected error occurred: ${error.message}`;
    }
}

// Export the function to make it available for other modules to import.
module.exports = { getSysPrompt };