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
const DEFAULT_MODEL = "meta-llama/llama-3-8b-instruct";
const IDENTITY_CLASSIFIER_MODEL = "meta-llama/llama-3-8b-instruct";
const IDENTITY_RESPONSES = [
  "I was created by Harsh Maurya, the developer of StudyMate AI. The UI is designed by Komal Sharma",
  "StudyMate AI was built by Harsh Maurya and Komal Sharma",
  "I’m a project developed by Harsh Maurya and designed by Komal Sharma to help students learn better.",
  "Harsh Maurya and Komal Sharma are the creators behind me.",
  "I was designed by Komal Sharma and developed by Harsh Maurya."
];
const REALTIME_CACHE_TTL_MS = 5 * 60 * 1000;
const IDENTITY_CACHE_TTL_MS = 30 * 60 * 1000;
const realtimeCache = new Map();
const identityCache = new Map();

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
  "deepseek/deepseek-chat",
  "mistralai/mistral-small",
  "qwen/qwen-2.5-72b-instruct"
];

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    console.log("API KEY:", apiKey ? "Loaded (sk-or-v1...)" : "UNDEFINED");
    
    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is not set.");
      return res.status(500).json({ error: "AI Service is currently unavailable." });
    }

    const { messages, mode, hinglish, notesMode, userId } = req.body;
    if (userId) console.log(`[AI Request] User: ${userId} | Mode: ${mode || "General"}`);

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "No messages provided." });
    }

    // Performance: Limit history to last 10 messages
    const limitedMessages = messages.slice(-10);
    const latestUserMessage = getLatestUserMessage(limitedMessages);

    const identityResponse = await handleIdentityQuery(apiKey, latestUserMessage);
    if (identityResponse) {
      return res.json({
        text: identityResponse.text,
        reply: identityResponse.text,
        sources: identityResponse.sources
      });
    }

    let externalContext = "";
    let sources = [];
    const realtimeRequested = isRealtimeQuery(latestUserMessage);
    const isNewsQuery = NEWS_QUERY_REGEX.test(latestUserMessage);
    const enhancedQuery = `${latestUserMessage} latest today news current`;
    const selectedModel = selectModelForQuery(latestUserMessage);

    if (realtimeRequested || isNewsQuery) {
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

    console.log({
      query: latestUserMessage,
      enhancedQuery,
      sourcesCount: sources.length,
      isNewsQuery,
      sourceType: isNewsQuery ? "news/hybrid" : "normal",
      model: selectedModel,
      realtime: realtimeRequested,
      timestamp: new Date().toISOString()
    });

    // Build system message
    const systemMessage = buildSystemMessage(mode, hinglish, notesMode, externalContext);
    const conversationMessages = limitedMessages.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : msg.role,
      content: msg.content
    }));

    const finalMessages = [
      { role: "system", content: systemMessage },
      ...conversationMessages
    ];
    const modelCandidates = buildModelCandidates(selectedModel);
    let aiResponse = "";
    let modelUsed = "";

    // Retry wrapper + model fallback chain
    for (const model of modelCandidates) {
      try {
        aiResponse = await fetchWithRetry(
          () => callAIModel(apiKey, model, finalMessages),
          1
        );
        modelUsed = model;
        break;
      } catch (error) {
        console.error(`[AI Error] ${model} failed after retries:`, error.message);
      }
    }

    if (!aiResponse) {
      return res.status(503).json({ error: "AI is busy right now. Please try again." });
    }

    if (externalContext && String(aiResponse || "").trim().length < 20) {
      aiResponse = `Here are the latest updates:\n\n${externalContext}`;
    }

    if (!aiResponse || aiResponse.trim().length < 5) {
      return res.json({
        text: "Sorry, I couldn't generate a proper response. Please try again.",
        reply: "Sorry, I couldn't generate a proper response. Please try again.",
        sources: []
      });
    }

    const answerBody = String(aiResponse).trim();
    const sourcesNotice = sources.length > 0 ? "\n\n### 🔗 Sources available below" : "";
    aiResponse = `### 📌 Answer\n\n${answerBody}${sourcesNotice}`;
    if (externalContext) {
      aiResponse += "\n\n⚠️ This answer is based on available data and may not reflect the latest updates.";
    }

    console.log(`[AI Success] Using model: ${modelUsed}`);
    const responseSources = externalContext ? sources : [];
    return res.json({ text: aiResponse, reply: aiResponse, sources: responseSources || [] });

  } catch (error) {
    console.error("POST /api/chat error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectModelForQuery(userMessage) {
  const query = String(userMessage || "");
  if (CODE_QUERY_REGEX.test(query)) return "deepseek/deepseek-coder";
  if (MATH_QUERY_REGEX.test(query)) return "google/gemma-7b-it";
  return DEFAULT_MODEL;
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
    console.log("Trying model:", model);
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

function buildSystemMessage(mode, hinglish, notesMode, externalContext = "") {
  let base = "You are StudyMate AI, a high-quality AI assistant.";
  const normalizedMode = String(mode || "General").toLowerCase();

  if (normalizedMode === "upsc") {
    base += " You are also an expert UPSC teacher. Explain with deep analysis, real-world examples, and structured reasoning.";
  } else if (normalizedMode === "jee") {
    base += " You are also a JEE teacher. Solve problems step-by-step with clear formulas and derivations.";
  } else if (normalizedMode === "neet") {
    base += " You are also a NEET biology teacher. Explain concepts simply with biology-focused examples.";
  } else {
    base += " Explain clearly and simply.";
  }

  // Notes mode modifiers
  const normalizedNotes = String(notesMode || "normal").toLowerCase();

  if (normalizedNotes === "bullet") {
    base += " Respond using concise bullet points. Keep each point short and clear.";
  } else if (normalizedNotes === "revision") {
    base += " Respond as structured revision notes with clear headings, key points, and a brief summary at the end.";
  } else if (normalizedNotes === "flashcards") {
    base += " Respond as flashcards. Use the format: Q: [question] / A: [answer] for each card. Create 5-10 flashcards covering the topic.";
  }

  // Hinglish modifier
  if (hinglish) {
    base += "\n\nIMPORTANT: You MUST respond in natural Hinglish (Hindi + English mix). Never reply in pure English or pure Hindi. Mix both naturally like a real conversation. Example style: \"Photosynthesis ek process hai jisme plants sunlight use karke apna food banate hain...\"";
  }

  base += `

Current date: ${new Date().toDateString()}

Instructions:
- Answer clearly and in a structured format.
- Use headings and bullet points where useful.
- Keep answers concise but informative.
- Base your answer on provided context if available.
- Do NOT hallucinate.
- If unsure or data may be outdated, clearly mention it.

Tone:
- Professional
- Helpful
- Clean and easy to read

Context:
${externalContext || "No real-time data was fetched for this request."}
`;

  return base;
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
