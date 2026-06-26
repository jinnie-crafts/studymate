/**
 * RAG Runner — StudyMate AI
 * 
 * Pipeline orchestrator: Classifier → Retriever → Formatter
 * Single entry point for the entire RAG system.
 */

const { classify, CATEGORIES } = require("./classifier");
const { retrieve } = require("./retriever");
const { formatContext } = require("./formatter");
const knowledgeService = require("../services/knowledgeService");

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const ragCache = new Map();
const RAG_CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes
const RAG_CACHE_MAX_SIZE = 200;

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

/**
 * Execute the full RAG pipeline for a given query.
 * 
 * @param {string} query - User's message
 * @returns {Promise<{
 *   enhanced: boolean,
 *   promptContext: string,
 *   sources: Array,
 *   debug: object
 * }>}
 */
async function execute(query) {
  const pipelineStart = Date.now();
  const debug = {
    classifier: null,
    retrieval: null,
    formatter: null,
    cached: false,
    totalTimeMs: 0,
    fallbackReason: null
  };

  try {
    // --- 1. Classification ---
    const classifierStart = Date.now();
    const classification = classify(query);
    debug.classifier = {
      ...classification,
      timeMs: Date.now() - classifierStart
    };

    console.log(`[RAG Pipeline] Classifier: needsRetrieval=${classification.needsRetrieval}, ` +
      `category=${classification.category}, confidence=${classification.confidence}, ` +
      `signals=[${classification.signals.join(", ")}]`);

    // --- 1.5 Knowledge Base Interception (Always Check First) ---
    const kbStart = Date.now();
    const kbResult = knowledgeService.search(query);
    
    console.log(`[RAG Pipeline] KB Search: match=${kbResult.bestMatch ? 'yes' : 'no'}, confidence=${kbResult.confidence}`);
    
    // Check if we have a strong KB match
    if (kbResult.bestMatch && kbResult.confidence >= 0.60) {
      debug.kb = {
        timeMs: Date.now() - kbStart,
        confidence: kbResult.confidence,
        entryId: kbResult.bestMatch.id
      };
      debug.totalTimeMs = Date.now() - pipelineStart;
      
      const formattedKB = `[STUDYMATE AI KNOWLEDGE BASE RESULT]\nQuestion: ${kbResult.bestMatch.question}\nAnswer: ${kbResult.bestMatch.answer}`;
      
      return {
        enhanced: true,
        promptContext: formattedKB,
        sources: [{ title: kbResult.bestMatch.source, url: "#" }],
        debug,
        kbExactMatch: true
      };
    } else if (classification.category === CATEGORIES.STUDYMATE_KB) {
      console.log(`[RAG Pipeline] KB Match too weak (${kbResult.confidence}). Falling back to standard RAG...`);
      // We will log this miss to analytics in Phase 10
      try {
        const kbAnalytics = require("../analytics/kbAnalytics");
        kbAnalytics.logMissedQuery(query, classification.category, kbResult.confidence);
      } catch(e) {} // Analytics might not be ready yet
    }

    // Fast exit if no retrieval needed
    if (!classification.needsRetrieval) {
      debug.totalTimeMs = Date.now() - pipelineStart;
      console.log(`[RAG Pipeline] Skipped (static query). Total: ${debug.totalTimeMs}ms`);
      return { enhanced: false, promptContext: "", sources: [], debug };
    }

    // --- 2. Cache Check ---
    const cacheKey = normalizeCacheKey(query);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      debug.cached = true;
      debug.totalTimeMs = Date.now() - pipelineStart;
      console.log(`[RAG Pipeline] Cache hit for: "${cacheKey.slice(0, 40)}..."`);
      return cached;
    }

    // --- 3. Retrieval ---
    const retrievalResult = await retrieve(query, classification.category);
    debug.retrieval = {
      sourceCount: retrievalResult.sources.length,
      timeMs: retrievalResult.retrievalTimeMs,
      providers: [...new Set(retrievalResult.sources.map(s => s.provider))]
    };

    console.log(`[RAG Pipeline] Retrieval: ${retrievalResult.sources.length} sources in ${retrievalResult.retrievalTimeMs}ms`);

    // No sources found — graceful empty return
    if (!retrievalResult.sources.length) {
      debug.fallbackReason = "no_sources_retrieved";
      debug.totalTimeMs = Date.now() - pipelineStart;
      console.log("[RAG Pipeline] No sources found. Falling back to standard AI.");
      return { enhanced: false, promptContext: "", sources: [], debug };
    }

    // --- 4. Formatting ---
    const formatterStart = Date.now();
    const formatted = formatContext(retrievalResult.sources, classification.category);
    debug.formatter = {
      sourceCount: formatted.sourceCount,
      contextChars: formatted.contextCharCount,
      timeMs: Date.now() - formatterStart
    };

    console.log(`[RAG Pipeline] Formatter: ${formatted.sourceCount} sources, ${formatted.contextCharCount} chars`);

    // Build clean source metadata for frontend
    const frontendSources = retrievalResult.sources
      .slice(0, formatted.sourceCount)
      .map((src, i) => ({
        title: src.title || `Source ${i + 1}`,
        url: src.url
      }))
      .filter(s => s.url && /^https?:\/\//i.test(s.url));

    debug.totalTimeMs = Date.now() - pipelineStart;
    console.log(`[RAG Pipeline] Complete. Enhanced=true. Total: ${debug.totalTimeMs}ms`);

    const result = {
      enhanced: true,
      promptContext: formatted.promptContext,
      sources: frontendSources,
      debug
    };

    // Cache the result
    setCacheResult(cacheKey, result);

    return result;

  } catch (error) {
    // --- CRITICAL: Never crash the chat flow ---
    debug.fallbackReason = `pipeline_error: ${error.message}`;
    debug.totalTimeMs = Date.now() - pipelineStart;
    console.error(`[RAG Pipeline] CRITICAL ERROR (graceful fallback): ${error.message}`);
    console.error(error.stack);
    return { enhanced: false, promptContext: "", sources: [], debug };
  }
}

// ---------------------------------------------------------------------------
// Cache Helpers
// ---------------------------------------------------------------------------

function normalizeCacheKey(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getCachedResult(key) {
  if (!key) return null;
  const entry = ragCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > RAG_CACHE_TTL_MS) {
    ragCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCacheResult(key, data) {
  if (!key) return;
  // LRU eviction
  if (ragCache.size >= RAG_CACHE_MAX_SIZE) {
    const oldest = ragCache.keys().next().value;
    ragCache.delete(oldest);
  }
  ragCache.set(key, { data, timestamp: Date.now() });
}

module.exports = { execute };
