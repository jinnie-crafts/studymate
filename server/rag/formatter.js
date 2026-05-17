/**
 * RAG Formatter — StudyMate AI
 * 
 * Formats retrieved context into safe, structured prompt sections.
 * Handles sanitization, token budgeting, and prompt injection prevention.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FORMAT_CONFIG = {
  MAX_CONTEXT_CHARS: 2000,       // ~500 tokens — aggressive cap for free models
  MAX_SNIPPET_CHARS: 200,        // Per-source snippet limit
  MAX_SOURCES_IN_PROMPT: 5       // Max sources injected into prompt
};

// ---------------------------------------------------------------------------
// Prompt Injection Prevention
// ---------------------------------------------------------------------------

/**
 * Dangerous patterns that could hijack the AI's behavior if injected from web content.
 */
const INJECTION_PATTERNS = [
  /\bignore (all |previous |above )?instructions?\b/i,
  /\byou are now\b/i,
  /\bforget (everything|all|your)\b/i,
  /\bact as\b/i,
  /\bpretend (to be|you are)\b/i,
  /\bnew instructions?\b/i,
  /\bsystem prompt\b/i,
  /\boverride\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /\bdo anything now\b/i,
  /\[system\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /<\|im_start\|>/i,
  /\brespond with\b.*\b(only|just)\b/i
];

// ---------------------------------------------------------------------------
// Main Formatter
// ---------------------------------------------------------------------------

/**
 * Format retrieved sources into a safe, structured prompt context section.
 * 
 * @param {Array} sources - Retrieved sources from retriever
 * @param {string} category - Classification category
 * @returns {{ promptContext: string, sourceCount: number, contextCharCount: number }}
 */
function formatContext(sources, category) {
  if (!Array.isArray(sources) || sources.length === 0) {
    console.log("[RAG Formatter] No sources to format.");
    return { promptContext: "", sourceCount: 0, contextCharCount: 0 };
  }

  const safeSources = sources
    .slice(0, FORMAT_CONFIG.MAX_SOURCES_IN_PROMPT)
    .map((src, i) => {
      const title = deepSanitize(src.title || "Untitled");
      const snippet = deepSanitize((src.snippet || "").slice(0, FORMAT_CONFIG.MAX_SNIPPET_CHARS));
      const url = sanitizeUrl(src.url || "");
      return { index: i + 1, title, snippet, url };
    })
    .filter(src => src.title.length > 3 && src.url);

  if (safeSources.length === 0) {
    console.log("[RAG Formatter] All sources filtered out after sanitization.");
    return { promptContext: "", sourceCount: 0, contextCharCount: 0 };
  }

  // Build the context block
  const categoryLabel = getCategoryLabel(category);
  const sourceLines = safeSources.map(src => {
    let line = `[${src.index}] "${src.title}"`;
    if (src.snippet) line += ` — ${src.snippet}`;
    if (src.url) line += ` (Source: ${src.url})`;
    return line;
  });

  let contextBlock = sourceLines.join("\n");

  // Enforce character budget
  if (contextBlock.length > FORMAT_CONFIG.MAX_CONTEXT_CHARS) {
    contextBlock = contextBlock.slice(0, FORMAT_CONFIG.MAX_CONTEXT_CHARS) + "\n[...truncated for brevity]";
  }

  const promptContext = [
    `\n[${categoryLabel} — Retrieved from web. Use this to inform your answer. Cite sources by number when referencing them.]`,
    contextBlock,
    `[END LIVE CONTEXT — Answer using above information where relevant. If the context is insufficient or unrelated, rely on your own knowledge and state that.]`
  ].join("\n");

  console.log(`[RAG Formatter] Formatted ${safeSources.length} sources (${promptContext.length} chars)`);

  return {
    promptContext,
    sourceCount: safeSources.length,
    contextCharCount: promptContext.length
  };
}

// ---------------------------------------------------------------------------
// Security Sanitization
// ---------------------------------------------------------------------------

/**
 * Deep sanitize text — removes HTML, prompt injections, and unsafe content.
 */
function deepSanitize(text) {
  let clean = String(text || "");

  // 1. Strip HTML/XML tags
  clean = clean.replace(/<[^>]*>/g, "");

  // 2. Remove HTML entities
  clean = clean.replace(/&[a-zA-Z0-9#]+;/g, " ");

  // 3. Remove prompt injection attempts
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, "[FILTERED]");
  }

  // 4. Remove control characters
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 5. Collapse excessive whitespace
  clean = clean.replace(/\s{3,}/g, " ").trim();

  // 6. Remove markdown-style system instructions that might leak
  clean = clean.replace(/```[^`]*```/g, "[code block removed]");

  return clean;
}

/**
 * Sanitize URL — only allow http/https, strip dangerous schemes.
 */
function sanitizeUrl(url) {
  const trimmed = String(url || "").trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

/**
 * Get human-readable category label for the prompt.
 */
function getCategoryLabel(category) {
  const labels = {
    LIVE_INFO: "LIVE INFORMATION",
    RECENT_NEWS: "RECENT NEWS",
    TRENDING: "TRENDING TOPICS",
    EDUCATIONAL_UPDATE: "EDUCATIONAL UPDATE",
    STATIC_KNOWLEDGE: "SUPPLEMENTARY CONTEXT"
  };
  return labels[category] || "SUPPLEMENTARY CONTEXT";
}

module.exports = { formatContext, deepSanitize, FORMAT_CONFIG };
