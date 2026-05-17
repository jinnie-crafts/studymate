/**
 * Memory Runner — StudyMate AI
 * 
 * Orchestrator for the conversational memory pipeline.
 */

const { extractMemory } = require("./memoryExtractor");
const { retrieveRelevantMemories, formatMemoryPrompt } = require("./memoryRetriever");

class MemoryRunner {
  
  /**
   * Generates the prompt injection string from the user's stored memory.
   * 
   * @param {string} query - The current user message
   * @param {Array} userMemories - The full memory array passed from frontend
   * @returns {string} The formatted memory prompt
   */
  retrieveContext(query, userMemories) {
    try {
      console.log(`[MemoryRunner] Retrieving context from ${userMemories?.length || 0} stored memories.`);
      const relevant = retrieveRelevantMemories(query, userMemories);
      if (relevant.length > 0) {
        console.log(`[MemoryRunner] Injected ${relevant.length} memories into prompt.`);
        return formatMemoryPrompt(relevant);
      }
      return "";
    } catch (error) {
      console.error(`[MemoryRunner] Retrieval Error: ${error.message}`);
      return ""; // Fail-safe
    }
  }

  /**
   * Extracts new memory facts from a conversation.
   * 
   * @param {string} apiKey - OpenRouter API key
   * @param {Array} messages - Chat history including latest user message
   * @param {Array} existingMemories - The user's current memory array to prevent duplicates
   * @returns {Promise<Array>} Array of NEW memory objects to save
   */
  async extractNewMemories(apiKey, messages, existingMemories = []) {
    try {
      const extracted = await extractMemory(apiKey, messages);
      
      // Deduplicate against existing memories (naive string match)
      const newMemories = extracted.filter(newMem => {
        const isDuplicate = existingMemories.some(existing => {
          // Simple string comparison for deduplication
          const a = newMem.fact.toLowerCase().replace(/[^a-z0-9]/g, "");
          const b = String(existing.fact || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return a === b || a.includes(b) || b.includes(a);
        });
        return !isDuplicate;
      });

      if (newMemories.length > 0) {
        console.log(`[MemoryRunner] Extracted ${newMemories.length} new memories.`);
      }
      return newMemories;
    } catch (error) {
      console.error(`[MemoryRunner] Extraction Error: ${error.message}`);
      return []; // Fail-safe
    }
  }
}

module.exports = new MemoryRunner();
