/**
 * StudyMate AI — Backend Proxy
 *
 * Keeps the OpenRouter API key server-side.
 * Frontend calls POST /api/chat → this server → OpenRouter → response back.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;
const REALTIME_QUERY_REGEX = /(today|now|latest|news|current|recent|weather|price|score|stock|time)/i;
const NEWS_QUERY_REGEX = /(news|headlines|breaking|latest news|current affairs)/i;
const CODE_QUERY_REGEX = /code|programming|debug/i;
const MATH_QUERY_REGEX = /math|calculate|solve/i;
const DEFAULT_MODEL = "deepseek/deepseek-chat";
const IDENTITY_CLASSIFIER_MODEL = "deepseek/deepseek-chat";

// Model Strategy Constants
const MODELS = {
  GENERAL: "deepseek/deepseek-chat",
  LONG_EXPLANATION: "qwen/qwen3.6-plus",
  CODING: "google/gemini-flash-1.5",
  REASONING: "deepseek/deepseek-r1-distill",
  FAST: "google/gemini-flash-1.5",
  FALLBACK: "mistralai/mistral-small"
};

const IDENTITY_RESPONSES = [
  "I was created by Harsh Maurya, the developer of StudyMate AI. The UI is designed by Komal Sharma",
  "StudyMate AI was built by Harsh Maurya and Komal Sharma",
  "I’m a project developed by Harsh Maurya and designed by Komal Sharma to help students learn better.",
  "Harsh Maurya and Komal Sharma are the creators behind me.",
  "I was designed by Komal Sharma and developed by Harsh Maurya."
];
const REALTIME_CACHE_TTL_MS = 5 * 60 * 1000;
const IDENTITY_CACHE_TTL_MS = 30 * 60 * 1000;
const RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;

const realtimeCache = new Map();
const identityCache = new Map();
const responseCache = new Map();
const MAX_CACHE_SIZE = 500;

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

const PROMPT_TEMPLATES = {
  BASE: `
Structure:
1. Explanation: Clear, simple, and step-by-step.
2. Example: Practical or theoretical.
3. Key Points: Bulleted list of core concepts.
4. Quiz: Exactly one simple question to test understanding.
5. Use simple language
6. Avoid jargon
7. Teach like a friendly tutor

Quiz Rule: Always end with 'Quiz:' followed by a question. Do not include the answer.
`,
  CODING: "Goal: Provide clean, working code with a short, concise explanation. Focus on best practices.",
  FAST: "Goal: Provide a very concise and direct answer. No fluff or extra explanations.",
  REASONING: "Goal: Focus on logical steps, mathematical derivations, or analytical reasoning. Be precise.",
  LONG_EXPLANATION: "Goal: Provide a comprehensive, in-depth breakdown. Cover background, mechanics, and implications.",
  DOUBT: `
The student did not understand the previous explanation.
Your task:
- Explain in a MUCH simpler way
- Use analogies or real-life examples
- Break it down step-by-step
- Avoid technical jargon
- Keep it shorter and clearer
`,
  GENERAL: "Goal: Provide clear, simple, structured explanation.",
  EXAM: `
Goal: Provide exam-oriented answers.
- Be concise and clear
- Focus on important concepts
- Highlight key points for revision
- Avoid unnecessary detail
`
};

const THINKING_PROMPT = `
Think step-by-step internally.
Do NOT show your thinking.
Only return the final structured answer.
`;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "StudyMate AI Backend" });
});

// ---------------------------------------------------------------------------
// POST /api/chat — proxy to OpenRouter with fallback
// ---------------------------------------------------------------------------

const MODEL_FALLBACKS = [
  "qwen/qwen3.6-plus",
  "qwen/qwen-2.5-72b-instruct",
  "mistralai/mistral-small"
];

app.post("/api/chat", async (req, res) => {
  const start = Date.now();
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;


    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is not set.");
      return res.status(500).json({ error: "AI Service is currently unavailable." });
    }

    const { messages, mode, hinglish, notesMode, userId, doubt = false } = req.body;
    if (userId) console.log(`[AI Request] User: ${userId} | Mode: ${mode || "General"} | Doubt: ${doubt}`);

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "No messages provided." });
    }

    // Performance: Limit history to last 10 messages
    const limitedMessages = messages.slice(-10);
    const latestUserMessage = getLatestUserMessage(limitedMessages);

    // 1. Identity check (Keep existing logic unchanged)
    const identityResponse = await handleIdentityQuery(apiKey, latestUserMessage);
    if (identityResponse) {
      return res.json({
        text: identityResponse.text,
        reply: identityResponse.text,
        sources: identityResponse.sources
      });
    }

    // 2. Detect intent
    let intent = detectIntent(latestUserMessage);
    
    // 3. Mode Normalization
    let normalizedMode = (mode || "general").toLowerCase();
    const validModes = ["general", "coding", "exam"];
    if (!validModes.includes(normalizedMode)) {
      normalizedMode = "general";
    }

    // 4. Intent Override (CRITICAL)
    if (normalizedMode === "coding") {
      intent = "CODING";
    }

    // 5. Select model
    const selectedModel = selectModel(intent);

    // 6. Check cache (with bypass logic)
    const isRealtime = isRealtimeQuery(latestUserMessage) || NEWS_QUERY_REGEX.test(latestUserMessage);
    const cacheKey = generateCacheKey({
      message: latestUserMessage,
      intent,
      userProfile: req.body.userProfile,
      mode: normalizedMode
    });

    if (!isRealtime && !doubt && latestUserMessage.length <= 300) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        console.log(`[Cache Hit] Serving: ${cacheKey}`);
        return res.json({
          text: cached.reply,
          reply: cached.reply,
          quiz: cached.quiz,
          sources: [],
          model_used: cached.model_used,
          cached: true
        });
      }
    }

    let externalContext = "";
    let sources = [];
    const enhancedQuery = `${latestUserMessage} latest today news current`;

    if (isRealtime) {
      try {
        const realtimeResult = await fetchRealtimeContext(enhancedQuery);
        externalContext = realtimeResult.text;
        sources = realtimeResult.sources;
      } catch (error) {
        console.error("Search API failed:", error);
      }
    }

    sources = Array.isArray(sources)
      ? sources.filter((src) => (
        src &&
        typeof src.url === "string" &&
        /^https?:\/\//i.test(src.url) &&
        typeof src.title === "string" &&
        src.title.trim()
      ))
      : [];
    sources = dedupeSources(sources).slice(0, 5);
    sources = sources.map((src, i) => ({
      title: `🔗 Source ${i + 1}`,
      url: src.url
    }));

    // 5. Build prompt (Optimized context)
    const optimizedHistory = getRecentHistory(messages);
    const systemPrompt = buildPrompt({
      message: latestUserMessage,
      intent,
      userProfile: req.body.userProfile,
      externalContext,
      doubt,
      mode: normalizedMode
    });

    const finalMessages = [
      { role: "system", content: systemPrompt },
      ...optimizedHistory
    ];

    const modelCandidates = buildModelCandidates(selectedModel);
    let aiResponse = "";
    let modelUsed = "";

    console.log(`[Intent] ${intent} | [Model] ${selectedModel}`);

    // 6. Call AI with fallback
    for (const model of modelCandidates) {
      try {
        aiResponse = await fetchWithRetry(
          () => callAIModel(apiKey, model, finalMessages),
          1
        );
        modelUsed = model;
        break;
      } catch (error) {
        console.error(`[AI Error] ${model} failed:`, error.message);
      }
    }

    if (!aiResponse) {
      return res.status(503).json({ error: "AI is busy right now. Please try again." });
    }

    const answerBody = String(aiResponse).trim();
    const finalReply = answerBody;

    // Extract Quiz if present
    const quizContent = extractQuiz(answerBody);

    // 7. Store response in cache (if eligible)
    if (!isRealtime && !doubt && latestUserMessage.length <= 300) {
      setCache(cacheKey, { reply: finalReply, quiz: quizContent, model_used: modelUsed });
    }

    console.log("Response time:", Date.now() - start, "ms");

    // 8. Return response
    return res.json({
      text: finalReply,
      reply: finalReply,
      quiz: quizContent,
      sources: sources || [],
      model_used: modelUsed
    });

  } catch (error) {
    console.log("Response time (error):", Date.now() - start, "ms");
    console.error("POST /api/chat error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * detectIntent(query)
 * Classifies the query intent to route to the optimal model.
 */
function detectIntent(query) {
  const text = String(query || "").toLowerCase();

  // CODING: Programming, debugging, and code generation keywords
  const codingKeywords = ["code", "programming", "debug", "function", "script", "syntax", "develop", "api", "json", "html", "css", "javascript"];
  if (codingKeywords.some(kw => text.includes(kw)) || /`{3,}/.test(text)) {
    return "CODING";
  }

    // REASONING: Math, logic, step-by-step solving keywords
    const reasoningKeywords = ["math", "calculate", "solve", "logic", "reasoning", "prove", "derivation", "formula"];
    if (reasoningKeywords.some(kw => text.includes(kw)) || /[\d+\-*/=]{3,}/.test(text)) {
    return "REASONING";
  }

  // LONG_EXPLANATION: In-depth or long request markers
  const longExpKeywords = ["explain in detail", "long", "detailed", "comprehensive", "background", "history", "essay", "article", "thesis"];
  if (longExpKeywords.some(kw => text.includes(kw)) || text.length > 300) {
    return "LONG_EXPLANATION";
  }

  const greetings = ["hi", "hello", "thanks", "ok", "yes", "no"];
  if (text.length < 20 && greetings.includes(text.trim())) {
    return "FAST";
  }

  return "GENERAL";
}

/**
 * selectModel(intent)
 * Maps detected intent to the specific model string.
 */
function selectModel(intent) {
  return MODELS[intent] || MODELS.GENERAL;
}

function buildModelCandidates(selectedModel) {
  const ordered = [selectedModel, ...MODEL_FALLBACKS];
  return [...new Set(ordered.filter(Boolean))];
}

function getRandomIdentityResponse() {
  return IDENTITY_RESPONSES[Math.floor(Math.random() * IDENTITY_RESPONSES.length)];
}

function normalizeIdentityCacheKey(message) {
  return String(message || "").trim().toLowerCase();
}

function getCachedIdentityResult(message) {
  const key = normalizeIdentityCacheKey(message);
  if (!key) return null;
  const cachedItem = identityCache.get(key);
  if (!cachedItem) return null;
  if (Date.now() - cachedItem.timestamp > IDENTITY_CACHE_TTL_MS) {
    identityCache.delete(key);
    return null;
  }
  return cachedItem.value;
}

function setCachedIdentityResult(message, value) {
  const key = normalizeIdentityCacheKey(message);
  if (!key || typeof value !== "boolean") return;
  identityCache.set(key, { value, timestamp: Date.now() });
}

function quickIdentityCheck(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("who") ||
    text.includes("developer") ||
    text.includes("creator") ||
    text.includes("built") ||
    text.includes("made") ||
    text.includes("owner") ||
    text.includes("banaya") ||
    text.includes("kisne") ||
    text.includes("kaun") ||
    text.includes("develop kiya") ||
    text.includes("किसने") ||
    text.includes("कौन") ||
    text.includes("बनाया") ||
    text.includes("डेवलपर")
  );
}

async function isIdentityQuery(apiKey, userMessage) {
  const prompt = `
You are an intent classifier.

Return ONLY "YES" or "NO".

Return "YES" if the user is asking about:
- who created you
- who built you
- who developed you
- who owns you
- your creator or developer

This includes:
- English
- Hindi
- Hinglish (mixed language)

Examples:
- who made you -> YES
- who is your developer -> YES
- tumhe kisne banaya -> YES
- tumhara developer kaun hai -> YES
- who is elon musk -> NO

Message:
"${String(userMessage || "").slice(0, 1000)}"
`;

  try {
    const result = await fetchWithRetry(
      () => callAIModel(apiKey, IDENTITY_CLASSIFIER_MODEL, [{ role: "user", content: prompt }]),
      1
    );
    return String(result).trim().toUpperCase().includes("YES");
  } catch (error) {
    console.error("Identity detection failed:", error.message);
    return false;
  }
}

async function handleIdentityQuery(apiKey, userMessage) {
  if (!quickIdentityCheck(userMessage)) return null;

  const cached = getCachedIdentityResult(userMessage);
  if (cached === true) {
    return { text: getRandomIdentityResponse(), sources: [] };
  }
  if (cached === false) {
    return null;
  }

  const identityIntent = await isIdentityQuery(apiKey, userMessage);
  setCachedIdentityResult(userMessage, identityIntent);

  if (!identityIntent) return null;
  return { text: getRandomIdentityResponse(), sources: [] };
}

async function fetchWithRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) return fetchWithRetry(fn, retries - 1);
    throw error;
  }
}

async function callAIModel(apiKey, model, messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("Trying model:", model);
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://aadirishi.in/",
        "X-Title": "StudyMate AI"
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal
    });

    if (!response.ok) {
      const rawError = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${rawError}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenRouter");
    return String(content);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Caching System
 */
function normalizeMessage(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function generateCacheKey({ message, intent, userProfile, mode }) {
  const msg = normalizeMessage(message);
  const grade = userProfile?.grade || "N/A";
  const style = userProfile?.preferred_style || "N/A";
  return `MSG:${msg}|INT:${intent}|MODE:${mode}|G:${grade}|S:${style}`;
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCache(key, data) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
  responseCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

function extractQuiz(text) {
  if (!text) return null;
  const match = text.match(/Quiz:\s*(.*)/i);
  return match ? match[1].trim() : null;
}



function getRecentHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-5).map(msg => {
    let content = String(msg.content || "");
    if (content.length > 300) {
      content = content.substring(0, 300) + "...";
    }
    return {
      role: msg.role === "user" ? "user" : "assistant",
      content
    };
  });
}

function buildContextLayer({ userProfile, intent, doubt }) {
  const grade = userProfile?.grade || "Unknown";
  const goal = userProfile?.goal || "General Learning";
  const style = userProfile?.preferred_style || "Simple";
  
  return `
STUDENT CONTEXT:
- Level: ${grade}
- Goal: ${goal}
- Style: ${style}
- Intent: ${intent}
- Doubt Mode: ${doubt ? "ON" : "OFF"}

INSTRUCTION: Adapt to student level, align with goal, and follow preferred style.
`.trim();
}

/**
 * Prompt Builder
 */
function buildPrompt({ message, intent, userProfile, externalContext, doubt, mode }) {
  const contextLayer = buildContextLayer({ userProfile, intent, doubt });
  const doubtInstructions = doubt ? PROMPT_TEMPLATES.DOUBT.trim() : "";
  const modeInstructions = mode === "exam" ? PROMPT_TEMPLATES.EXAM.trim() : "";
  const base = (intent === "FAST" || mode === "coding") ? "" : PROMPT_TEMPLATES.BASE.trim();
  const specific = PROMPT_TEMPLATES[intent] || PROMPT_TEMPLATES.GENERAL;
  
  return `You are StudyMate AI, a smart and friendly tutor.

${THINKING_PROMPT.trim()}

${contextLayer}

${modeInstructions ? `MODE INSTRUCTIONS:\n${modeInstructions}\n\n` : ""}${doubtInstructions ? `IMPORTANT: ${doubtInstructions}\n\n` : ""}${base ? `${base}\n\n` : ""}Additional Context: ${externalContext || "No additional data."}

User Question:
${message}

Task: ${specific}

Final Rule: Always teach clearly and simply. Use step-by-step logic.`;
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && typeof messages[i]?.content === "string") {
      return messages[i].content;
    }
  }
  return "";
}

function isRealtimeQuery(userMessage) {
  return REALTIME_QUERY_REGEX.test(String(userMessage || ""));
}

function getCachedRealtimeContext(query) {
  const cacheKey = String(query || "").trim().toLowerCase();
  if (!cacheKey) return { text: "", sources: [] };
  const cachedItem = realtimeCache.get(cacheKey);
  if (!cachedItem) return { text: "", sources: [] };
  if (Date.now() - cachedItem.timestamp > REALTIME_CACHE_TTL_MS) {
    realtimeCache.delete(cacheKey);
    return { text: "", sources: [] };
  }
  return cachedItem.value;
}

function setCachedRealtimeContext(query, value) {
  const cacheKey = String(query || "").trim().toLowerCase();
  if (!cacheKey || !value?.text) return;
  realtimeCache.set(cacheKey, { value, timestamp: Date.now() });
}

async function fetchRealtimeContext(query) {
  const cached = getCachedRealtimeContext(query);
  if (cached.text) return cached;

  const [newsDataResult, ddgResult] = await Promise.allSettled([
    fetchNewsData(query),
    fetchSearchResults(query)
  ]);

  if (newsDataResult.status === "rejected") {
    console.error("[Realtime] NewsData failed:", newsDataResult.reason);
  }
  if (ddgResult.status === "rejected") {
    console.error("[Realtime] DuckDuckGo failed:", ddgResult.reason);
  }

  const newsSources = newsDataResult.status === "fulfilled" && Array.isArray(newsDataResult.value?.sources)
    ? newsDataResult.value.sources
    : [];
  const ddgSources = ddgResult.status === "fulfilled" && Array.isArray(ddgResult.value?.sources)
    ? ddgResult.value.sources
    : [];
  const combinedSources = dedupeSources([...newsSources, ...ddgSources]).slice(0, 5);
  const externalText = combinedSources.map((src) => `- ${src.title}`).join("\n");

  const context = {
    text: externalText,
    sources: combinedSources
  };
  if (context.text || context.sources.length > 0) {
    setCachedRealtimeContext(query, context);
  }
  return context;
}

async function fetchSearchResults(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`, {
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo request failed with status ${res.status}`);
    }

    const data = await res.json();
    const sources = collectDuckDuckGoSources(data?.RelatedTopics).slice(0, 5);
    const text = sources.map((source) => source.title).join("\n");

    return {
      text,
      sources
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function collectDuckDuckGoSources(relatedTopics) {
  if (!Array.isArray(relatedTopics)) return [];
  const flatItems = [];
  for (const item of relatedTopics) {
    if (item?.FirstURL && item?.Text) {
      flatItems.push(item);
      continue;
    }
    if (Array.isArray(item?.Topics)) {
      for (const nested of item.Topics) {
        if (nested?.FirstURL && nested?.Text) {
          flatItems.push(nested);
        }
      }
    }
  }
  return flatItems.map((item) => ({
    title: item.Text,
    url: item.FirstURL
  })).filter((item) => /^https?:\/\//i.test(item.url));
}

function dedupeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.filter((src, index, self) => (
    index === self.findIndex((s) => String(s?.url || "").trim() === String(src?.url || "").trim())
  ));
}

async function fetchNewsData(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const apiKey = process.env.NEWSDATA_API_KEY;
    if (!apiKey) return { text: "", sources: [] };

    const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&q=${encodeURIComponent(query)}&language=en`;
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      throw new Error(`NewsData request failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data?.results) || data.results.length === 0) {
      return { text: "", sources: [] };
    }

    const now = new Date();
    const freshArticles = data.results.filter((article) => {
      if (!article?.pubDate || !article?.link || !article?.title) return false;
      if (!/^https?:\/\//i.test(article.link)) return false;

      const published = new Date(article.pubDate);
      if (Number.isNaN(published.getTime())) return false;

      const diffHours = (now - published) / (1000 * 60 * 60);
      return diffHours >= 0 && diffHours <= 24;
    });

    if (freshArticles.length === 0) {
      return { text: "", sources: [] };
    }

    const articles = freshArticles.slice(0, 5);

    const sources = articles.map((article) => ({
      title: article.title,
      url: article.link
    }));
    const text = articles.map((article) => article.title).join("\n");

    return {
      text,
      sources
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`StudyMate AI Backend running on http://localhost:${PORT}`);
});
