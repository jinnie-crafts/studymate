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

const DEFAULT_MODELS = [
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-small:free",
  "qwen/qwen-3-coder:free"
];

const TECHNICAL_MODELS = [
  "qwen/qwen-3-coder:free",
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-small:free"
];

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
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

    // Build system message
    const systemMessage = buildSystemMessage(mode, hinglish, notesMode);
    const conversationMessages = limitedMessages.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : msg.role,
      content: msg.content
    }));

    const finalMessages = [
      { role: "system", content: systemMessage },
      ...conversationMessages
    ];

    // Determine model priority based on context (JEE/NEET prioritize Coder)
    const isTechnical = ["jee", "neet"].includes(String(mode || "").toLowerCase());
    const modelList = isTechnical ? TECHNICAL_MODELS : DEFAULT_MODELS;

    // Fallback Loop
    for (const model of modelList) {
      // 1 Retry per model (Total 2 attempts per model)
      for (let attempt = 1; attempt <= 2; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s Timeout

        try {
          console.log(`[AI Attempt] Model: ${model} | Attempt: ${attempt}`);
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://studymate-ai.onrender.com",
              "X-Title": "StudyMate AI"
            },
            body: JSON.stringify({ model, messages: finalMessages }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            if (content) {
              console.log(`[AI Success] Using model: ${model}`);
              return res.json({ reply: content });
            }
          } else {
            const errorData = await response.json().catch(() => ({}));
            console.warn(`[AI Warn] ${model} attempt ${attempt} failed:`, errorData.error?.message || response.statusText);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          console.error(`[AI Error] ${model} attempt ${attempt} failed:`, error.name === 'AbortError' ? 'Timeout' : error.message);
        }
      }
    }

    // If all models and retries fail
    return res.status(503).json({ error: "AI is busy right now. Please try again." });

  } catch (error) {
    console.error("POST /api/chat error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemMessage(mode, hinglish, notesMode) {
  let base = "";
  const normalizedMode = String(mode || "General").toLowerCase();

  if (normalizedMode === "upsc") {
    base = "You are an expert UPSC teacher. Explain with deep analysis, real-world examples, and structured reasoning.";
  } else if (normalizedMode === "jee") {
    base = "You are a JEE teacher. Solve problems step-by-step with clear formulas and derivations.";
  } else if (normalizedMode === "neet") {
    base = "You are a NEET biology teacher. Explain concepts simply with biology-focused examples.";
  } else {
    base = "You are a helpful study assistant. Explain clearly and simply.";
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

  return base;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`StudyMate AI Backend running on http://localhost:${PORT}`);
});
