/**
 * Central Agent Runner for StudyMate AI
 * Orchestrates AI, Backend, and UI agents.
 */

const IDENTITY_RESPONSES = [
  "StudyMate-AI is developed by Rishu Maurya.",
  "This application was created by Rishu Maurya.",
  "Rishu Maurya is the developer behind StudyMate-AI.",
  "StudyMate-AI was built by Rishu Maurya."
];

class AgentRunner {
  constructor() {
    this.agents = {
      identity: new IdentityAgent(),
      intent: new IntentAgent(),
      quiz: new QuizAgent(),
      ui: new UIAgent()
    };
  }

  /**
   * Run pre-processing agents (before AI call)
   */
  async preProcess(context) {
    console.log("[AgentRunner] Starting pre-processing...");
    
    // 1. Intent Agent
    const intent = await this.agents.intent.execute(context);
    context.intent = intent;

    // 2. Identity Agent (Can bypass AI)
    const identityResult = await this.agents.identity.execute(context);
    if (identityResult) {
      console.log("[AgentRunner] IdentityAgent triggered bypass.");
      return { bypass: true, response: identityResult };
    }

    // 3. Prompt Decoration (Skills/Styles)
    context.promptDecoration = this.buildPromptDecoration(context);

    return { bypass: false };
  }

  buildPromptDecoration(context) {
    const { intent, mode, message } = context;
    let decoration = "";

    if (intent === "CODING" || mode === "coding") {
      decoration += "\n[CRITICAL: Provide complete, working code with syntax highlighting.]";
    }

    if (intent === "DIAGRAM") {
      decoration += "\n[CRITICAL: Use Mermaid syntax ( ```mermaid ) for visualizations.]";
    }

    // QuizAgent logic for follow-ups
    if (this.agents.quiz.shouldSuggestQuiz("", intent)) {
      decoration += "\n[Follow-up: Ask exactly ONE natural, engaging question to deepen the conversation. No generic 'Want a quiz?' text.]";
    }

    return decoration;
  }

  /**
   * Run post-processing agents (after AI call)
   */
  async postProcess(context, aiResponse) {
    console.log("[AgentRunner] Starting post-processing...");
    
    let processedResponse = { ...aiResponse };

    // 1. Quiz Agent
    const quizResult = await this.agents.quiz.execute(context, processedResponse);
    processedResponse = { ...processedResponse, ...quizResult };

    // 2. UI Agent (Metadata for frontend)
    const uiMetadata = await this.agents.ui.execute(context, processedResponse);
    processedResponse.ui = uiMetadata;

    console.log("[AgentRunner] Post-processing complete.");
    return processedResponse;
  }
}

class IdentityAgent {
  async execute(context) {
    const { message } = context;
    const text = String(message || "").toLowerCase();
    
    const identityKeywords = [
      "who made", "who created", "who built", "who developed", "who coded", 
      "who is the owner", "who is the creator", "your developer", "your owner", 
      "who built this app", "anthropic", "openai", "google", "meta"
    ];

    const isMatch = identityKeywords.some(kw => text.includes(kw));
    
    if (isMatch) {
      console.log("[IdentityAgent] Detected identity query. Providing hardcoded response.");
      const responseText = IDENTITY_RESPONSES[Math.floor(Math.random() * IDENTITY_RESPONSES.length)];
      return {
        text: responseText,
        reply: responseText,
        intent: "identity"
      };
    }
    return null;
  }
}

class IntentAgent {
  async execute(context) {
    const { message, mode } = context;
    const text = String(message || "").toLowerCase();
    
    console.log(`[IntentAgent] Classifying intent for mode: ${mode}`);

    const DIAGRAM_QUERY_REGEX = /diagram|chart|graph|flow|flowchart|structure|architecture/i;
    const CODE_QUERY_REGEX = /code|program|example|debug|script|function|snippet|coding/i;

    if (DIAGRAM_QUERY_REGEX.test(text)) return "DIAGRAM";
    if (CODE_QUERY_REGEX.test(text) || mode === "coding") return "CODING";

    const explanationKeywords = ["explain", "how", "why", "what is", "define", "concept", "theory"];
    if (explanationKeywords.some(kw => text.includes(kw))) return "EXPLANATION";

    return "GENERAL";
  }
}

class QuizAgent {
  async execute(context, response) {
    const { intent } = context;
    const text = response.text || "";
    
    console.log("[QuizAgent] Evaluating response for quiz/follow-up potential.");

    const quizContent = this.extractQuiz(text);
    const suggestQuiz = this.shouldSuggestQuiz(text, intent);

    // Ensure ChatGPT-style follow-up logic
    let finalReply = text;
    if (suggestQuiz && !text.toLowerCase().includes("?")) {
      // If we should suggest something but haven't asked a question yet
      console.log("[QuizAgent] Adding contextual follow-up suggestion.");
      // This is dynamic, but for now we just mark it
    }

    return {
      quiz: quizContent,
      suggestQuiz: suggestQuiz
    };
  }

  extractQuiz(text) {
    if (!text) return null;
    const match = text.match(/Quiz:\s*(.*)/i);
    return match ? match[1].trim() : null;
  }

  shouldSuggestQuiz(text, intent) {
    // Fixed: Now allows suggestions for educational intents
    if (intent === "identity" || intent === "system_error") return false;
    
    const educationalIntents = ["EXPLANATION", "CODING", "DIAGRAM", "GENERAL"];
    const hasEnoughContent = text.length > 100; // Only suggest for substantial answers
    
    return educationalIntents.includes(intent) && hasEnoughContent;
  }
}

class UIAgent {
  async execute(context, response) {
    console.log("[UIAgent] Preparing UI sync metadata.");
    return {
      action: response.quiz ? "SHOW_QUIZ_PROMPT" : "NONE",
      syncState: {
        currentQuestion: context.currentQuestion || null
      }
    };
  }
}

module.exports = new AgentRunner();
