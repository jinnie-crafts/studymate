const fs = require('fs');
const path = require('path');

class KnowledgeService {
  constructor() {
    this.kbPath = path.join(__dirname, '../knowledge');
    this.entries = [];
    this.synonyms = {
      "built": ["created", "made", "developed", "programmed", "coded"],
      "cost": ["price", "free", "premium", "pay", "subscription", "money", "tier"],
      "secure": ["safe", "privacy", "protect", "encryption", "encrypted"],
      "help": ["support", "contact", "email", "ticket", "issue", "problem", "bug"],
      "future": ["roadmap", "upcoming", "next", "soon", "planning"],
      "notes": ["notebook", "save", "download", "document"],
      "chat": ["assistant", "bot", "talk", "speak"]
    };
    this.loadKB();
    this.watchKB();
  }

  loadKB() {
    this.entries = [];
    if (!fs.existsSync(this.kbPath)) return;

    const files = fs.readdirSync(this.kbPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.kbPath, file), 'utf8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.entries)) {
          data.entries.forEach(entry => {
            this.entries.push({
              id: entry.id,
              category: data.category,
              question: entry.question || "",
              answer: entry.answer || "",
              keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
              version: data.version,
              lastUpdated: data.lastUpdated,
              source: "StudyMate AI Knowledge Base"
            });
          });
        }
      } catch (e) {
        console.error(`[KnowledgeService] Failed to load ${file}:`, e.message);
      }
    }
    console.log("Knowledge Base loaded");
    console.log(`[KnowledgeService] Loaded ${this.entries.length} knowledge entries into memory.`);
  }

  watchKB() {
    if (!fs.existsSync(this.kbPath)) return;
    fs.watch(this.kbPath, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        console.log(`[KnowledgeService] File ${filename} changed. Reloading KB...`);
        this.loadKB();
      }
    });
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w && w.length > 2); // Ignore very short stop words
  }

  expandSynonyms(tokens) {
    const expanded = new Set(tokens);
    for (const token of tokens) {
      for (const [key, syns] of Object.entries(this.synonyms)) {
        if (token === key || syns.includes(token)) {
          expanded.add(key);
          syns.forEach(s => expanded.add(s));
        }
      }
    }
    return Array.from(expanded);
  }

  search(query) {
    if (!query || this.entries.length === 0) return { bestMatch: null, confidence: 0 };

    const rawQuery = query.toLowerCase().trim();
    const queryTokens = this.tokenize(query);
    const expandedTokens = this.expandSynonyms(queryTokens);

    let bestMatch = null;
    let highestScore = 0;

    for (const entry of this.entries) {
      let score = 0;

      // 1. Exact Question Match (Score: 1.0)
      if (entry.question.toLowerCase() === rawQuery) {
        return { bestMatch: entry, confidence: 1.0 };
      }

      // 2. Keyword matching
      const safeKeywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      const entryKeywords = this.expandSynonyms(safeKeywords.map(k => String(k).toLowerCase()));
      let keywordHits = 0;
      for (const token of expandedTokens) {
        if (entryKeywords.includes(token)) keywordHits++;
      }
      
      const keywordScore = (keywordHits / Math.max(expandedTokens.length, 1)) * 0.5;
      score += keywordScore;

      // 3. Question Token Overlap
      const qTokens = this.tokenize(entry.question);
      let qHits = 0;
      for (const token of expandedTokens) {
        if (qTokens.includes(token)) qHits++;
      }
      const qScore = (qHits / Math.max(qTokens.length, 1)) * 0.4;
      score += qScore;

      // 4. Boost for direct phrase match
      if (entryKeywords.some(k => rawQuery.includes(k))) {
        score += 0.2;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = entry;
      }
    }

    // Clamp score
    highestScore = Math.min(highestScore, 0.99);

    return {
      bestMatch,
      confidence: highestScore
    };
  }
}

// Singleton instance
const knowledgeService = new KnowledgeService();
module.exports = knowledgeService;
