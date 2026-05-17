/**
 * Memory Retriever — StudyMate AI
 * 
 * Filters, ranks, and retrieves relevant memory context to inject into prompts.
 */

const MAX_MEMORIES_TO_INJECT = 3;

/**
 * Ranks provided user memories against the current query to find the most relevant context.
 * 
 * @param {string} query - The current user message
 * @param {Array} userMemories - The user's full memory store
 * @returns {Array} Top relevant memories
 */
function retrieveRelevantMemories(query, userMemories) {
  if (!Array.isArray(userMemories) || userMemories.length === 0) return [];
  if (!query || typeof query !== "string") return [];

  const normalizedQuery = query.toLowerCase();
  const queryTokens = new Set(normalizedQuery.split(/\s+/).filter(t => t.length > 3));

  const rankedMemories = userMemories.map(memory => {
    let score = 0;
    
    // Always give baseline score to preferences, as they apply globally
    if (memory.category === "PREFERENCE") {
      score += 0.5; 
    }

    // Keyword matching
    const factTokens = String(memory.fact || "").toLowerCase().split(/\s+/);
    for (const token of factTokens) {
      if (token.length > 3 && queryTokens.has(token)) {
        score += 1.0;
      }
    }

    // Time decay: Newer memories get a slight boost
    const daysOld = (Date.now() - (memory.timestamp || Date.now())) / (1000 * 60 * 60 * 24);
    const timeBoost = Math.max(0, 0.2 - (daysOld * 0.01));
    score += timeBoost;

    // Confidence weight
    score *= (memory.confidence || 0.8);

    return { ...memory, relevanceScore: score };
  });

  // Filter out irrelevant facts (score > 0.3 ensures we don't inject noise)
  // PREFERENCE type naturally passes this threshold because of baseline score
  const relevant = rankedMemories
    .filter(m => m.relevanceScore > 0.3)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, MAX_MEMORIES_TO_INJECT);

  return relevant;
}

/**
 * Formats retrieved memories into a prompt string.
 */
function formatMemoryPrompt(memories) {
  if (!memories || memories.length === 0) return "";
  
  const facts = memories.map(m => `- ${m.fact}`).join("\n");
  return `\n[User Memory/Preferences Context:\n${facts}\nAdapt your response to align with these facts and preferences.]\n`;
}

module.exports = { retrieveRelevantMemories, formatMemoryPrompt };
