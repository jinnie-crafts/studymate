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
// POST /api/chat — proxy to OpenRouter
// ---------------------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  try {
    // ------ validate env key ------
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is not set in environment variables.");
      return res.status(500).json({ error: "Server not responding.." });
    }

    // ------ validate request body ------
    const { messages, mode, hinglish, notesMode, userId } = req.body;

    if (userId) console.log(`[AI Request] User: ${userId} | Mode: ${mode || "General"}`);

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] is required and must not be empty." });
    }

    // Ensure every message has role + content
    for (const msg of messages) {
      if (!msg.role || typeof msg.content !== "string" || !msg.content.trim()) {
        return res.status(400).json({ error: "Each message must have a role and non-empty content." });
      }
    }

    // ------ build system prompt ------
    const systemMessage = buildSystemMessage(mode, hinglish, notesMode);

    // ------ build conversation payload ------
    const conversationMessages = messages.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : msg.role,
      content: msg.content
    }));

    // ------ call OpenRouter ------
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://studymate-ai.onrender.com",
        "X-Title": "StudyMate AI"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3-8b-instruct",
        messages: [
          { role: "system", content: systemMessage },
          ...conversationMessages
        ]
      })
    });

    const data = await orResponse.json().catch(() => ({}));

    if (!orResponse.ok) {
      console.error("OpenRouter error:", data);
      return res.status(orResponse.status).json({
        error: data.error?.message || "AI service returned an error."
      });
    }

    const reply = data.choices?.[0]?.message?.content || "No response from AI";

    return res.json({ reply });
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

  // Mode-specific instruction
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
