/**
 * RAG Query Classifier — StudyMate AI
 * 
 * Determines whether a user query requires real-time/recent information retrieval.
 * Uses multi-signal heuristic scoring (no AI call needed — fast & free).
 * 
 * Returns: { needsRetrieval, category, confidence, signals }
 */

// ---------------------------------------------------------------------------
// Intent Categories
// ---------------------------------------------------------------------------

const CATEGORIES = {
  LIVE_INFO: "LIVE_INFO",           // Live scores, weather, prices
  RECENT_NEWS: "RECENT_NEWS",       // News, headlines, current affairs
  TRENDING: "TRENDING",             // Trending topics, viral content
  EDUCATIONAL_UPDATE: "EDUCATIONAL_UPDATE", // Exam results, syllabus changes
  STATIC_KNOWLEDGE: "STATIC_KNOWLEDGE"     // Textbook concepts, definitions
};

// ---------------------------------------------------------------------------
// Signal Patterns (weighted)
// ---------------------------------------------------------------------------

/**
 * Temporal markers — strongest signal for recency need.
 * Weight: HIGH (0.35 per match, capped)
 */
const TEMPORAL_PATTERNS = [
  /\b(today|tonight|this morning|this evening)\b/i,
  /\b(yesterday|last night)\b/i,
  /\b(this week|this month|this year)\b/i,
  /\b(right now|at the moment|currently)\b/i,
  /\b(latest|newest|most recent|just released)\b/i,
  /\b(2025|2026|2027)\b/i,
  /\b(upcoming|ongoing|happening)\b/i
];

/**
 * Action/query patterns — user is explicitly asking for fresh data.
 * Weight: MEDIUM (0.25 per match)
 */
const ACTION_PATTERNS = [
  /\bwho won\b/i,
  /\bwho is winning\b/i,
  /\bwhat happened\b/i,
  /\bwhat.?s (new|trending|happening)\b/i,
  /\bhow much (is|are|does)\b.*\b(cost|price|worth)\b/i,
  /\b(score|result|standing|ranking)\b.*\b(today|now|latest|current|live)\b/i,
  /\b(update|updates|news|headlines|breaking)\b/i,
  /\btell me about.*recent\b/i,
  /\bcurrent (status|situation|state|affairs)\b/i
];

/**
 * Topic patterns — domains that frequently require recent data.
 * Weight: LOW-MEDIUM (0.15 per match)
 */
const TOPIC_PATTERNS = [
  { regex: /\b(cricket|football|soccer|nba|ipl|world cup|premier league|match|tournament)\b/i, category: CATEGORIES.LIVE_INFO },
  { regex: /\b(stock|market|nifty|sensex|bitcoin|crypto|share price|nasdaq)\b/i, category: CATEGORIES.LIVE_INFO },
  { regex: /\b(weather|temperature|forecast|rain)\b/i, category: CATEGORIES.LIVE_INFO },
  { regex: /\b(election|vote|polling|government|minister|president)\b/i, category: CATEGORIES.RECENT_NEWS },
  { regex: /\b(openai|chatgpt|gemini|claude|gpt-?[0-9]|llama|ai model|artificial intelligence.*new)\b/i, category: CATEGORIES.RECENT_NEWS },
  { regex: /\b(release|launched|announced|unveiled|introduced)\b/i, category: CATEGORIES.RECENT_NEWS },
  { regex: /\b(viral|trending|meme|controversy|scandal)\b/i, category: CATEGORIES.TRENDING },
  { regex: /\b(exam result|board result|neet|jee|upsc|syllabus change|admission)\b/i, category: CATEGORIES.EDUCATIONAL_UPDATE },
  { regex: /\b(cuet|gate|cat result|cutoff|merit list)\b/i, category: CATEGORIES.EDUCATIONAL_UPDATE }
];

/**
 * Negative patterns — these suppress false positives.
 * If matched, REDUCE confidence significantly.
 */
const NEGATIVE_PATTERNS = [
  /\b(explain|define|what is|describe|concept|theory|principle|formula|theorem)\b/i,
  /\b(how (does|do|to)|write (a|an)|create|build|implement|code)\b/i,
  /\b(difference between|compare|vs\.?|versus)\b/i,
  /\b(history of|origin of|invented|discovered)\b/i,
  /\b(solve|calculate|simplify|derive|prove)\b/i,
  /\b(example|practice|exercise|question paper)\b/i
];

/**
 * Strong negative — if the query is purely educational, skip retrieval entirely.
 */
const PURE_EDUCATIONAL_PATTERNS = [
  /^(explain|define|what is|describe)\b.{5,}$/i,
  /^how (does|do|to)\b.{5,}$/i,
  /\b(binary search|linked list|array|sorting|oop|polymorphism|inheritance)\b/i,
  /\b(photosynthesis|mitosis|gravity|newton|einstein|quantum|organic chemistry)\b/i,
  /\b(algebra|calculus|trigonometry|geometry|statistics|probability)\b/i
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a user query to determine if it needs real-time retrieval.
 * 
 * @param {string} query - The user's message
 * @returns {{ needsRetrieval: boolean, category: string, confidence: number, signals: string[] }}
 */
function classify(query) {
  const text = String(query || "").trim();
  
  // Empty or very short queries — skip
  if (text.length < 3) {
    return result(false, CATEGORIES.STATIC_KNOWLEDGE, 0.99, ["too_short"]);
  }

  const signals = [];
  let score = 0;
  let detectedCategory = CATEGORIES.STATIC_KNOWLEDGE;

  // --- 1. Check pure educational patterns first (fast exit) ---
  const isPureEducational = PURE_EDUCATIONAL_PATTERNS.some(p => p.test(text));
  if (isPureEducational) {
    // Still check for temporal override (e.g., "explain latest AI model")
    const hasTemporalOverride = TEMPORAL_PATTERNS.some(p => p.test(text));
    if (!hasTemporalOverride) {
      return result(false, CATEGORIES.STATIC_KNOWLEDGE, 0.95, ["pure_educational"]);
    }
    signals.push("educational_with_temporal_override");
  }

  // --- 2. Temporal signal scoring ---
  for (const pattern of TEMPORAL_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(pattern)?.[0] || "temporal";
      signals.push(`temporal:${match.toLowerCase()}`);
      score += 0.35;
    }
  }

  // --- 3. Action signal scoring ---
  for (const pattern of ACTION_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(pattern)?.[0] || "action";
      signals.push(`action:${match.toLowerCase().slice(0, 30)}`);
      score += 0.25;
    }
  }

  // --- 4. Topic signal scoring ---
  for (const { regex, category } of TOPIC_PATTERNS) {
    if (regex.test(text)) {
      const match = text.match(regex)?.[0] || "topic";
      signals.push(`topic:${match.toLowerCase()}`);
      score += 0.15;
      // Use the most specific topic category detected
      if (detectedCategory === CATEGORIES.STATIC_KNOWLEDGE) {
        detectedCategory = category;
      }
    }
  }

  // --- 5. Negative signal dampening ---
  let negativeDampening = 0;
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      const match = text.match(pattern)?.[0] || "negative";
      signals.push(`negative:${match.toLowerCase().slice(0, 30)}`);
      negativeDampening += 0.20;
    }
  }
  score = Math.max(0, score - negativeDampening);

  // --- 6. Determine category from highest signals ---
  if (score > 0 && detectedCategory === CATEGORIES.STATIC_KNOWLEDGE) {
    // Default to RECENT_NEWS if we have signals but no specific topic
    if (signals.some(s => s.startsWith("action:") && /news|update|headline|breaking/i.test(s))) {
      detectedCategory = CATEGORIES.RECENT_NEWS;
    } else if (signals.some(s => s.startsWith("action:") && /trending|viral/i.test(s))) {
      detectedCategory = CATEGORIES.TRENDING;
    } else {
      detectedCategory = CATEGORIES.RECENT_NEWS;
    }
  }

  // --- 7. Final decision ---
  const confidence = Math.min(score, 1.0);
  const needsRetrieval = confidence >= 0.20; // Threshold: at least one medium signal

  // Clamp confidence for clear cases
  const finalConfidence = needsRetrieval
    ? Math.max(confidence, 0.20)
    : Math.max(1.0 - score, 0.50);

  return result(needsRetrieval, detectedCategory, parseFloat(finalConfidence.toFixed(2)), signals);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function result(needsRetrieval, category, confidence, signals) {
  return {
    needsRetrieval,
    category,
    confidence,
    signals
  };
}

module.exports = { classify, CATEGORIES };
