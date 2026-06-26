const admin = require("firebase-admin");

// Initialize Firebase Admin gracefully
let db = null;
try {
  // If FIREBASE_SERVICE_ACCOUNT is present or default ADC is available
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
  db = admin.firestore();
  console.log("[KB Analytics] Successfully connected to Firestore.");
} catch (error) {
  console.warn("[KB Analytics] Warning: Firebase Admin not configured correctly. Analytics will be simulated in memory. Ensure GOOGLE_APPLICATION_CREDENTIALS is set.");
}

// In-memory fallback
const memoryAnalytics = {
  kbQueries: [],
  missingKnowledge: []
};

class KBAnalytics {
  
  async logQuery(question, category, confidence, answerFound, userId = "anonymous") {
    const data = {
      question,
      timestamp: new Date().toISOString(),
      userId,
      matchedCategory: category,
      confidenceScore: confidence,
      answerFound
    };

    if (db) {
      try {
        await db.collection("analytics").doc("kb").collection("kbQueries").add(data);
      } catch (e) {
        console.error("[KB Analytics] Firestore write failed:", e.message);
      }
    } else {
      memoryAnalytics.kbQueries.push(data);
    }
  }

  async logMissedQuery(question, category, confidence) {
    // Log the normal query first
    await this.logQuery(question, category, confidence, false);

    const docId = this._sanitizeId(question);
    
    if (db) {
      try {
        const ref = db.collection("analytics").doc("kb").collection("missingKnowledge").doc(docId);
        const doc = await ref.get();
        if (doc.exists) {
          await ref.update({
            frequency: admin.firestore.FieldValue.increment(1),
            lastAsked: new Date().toISOString()
          });
        } else {
          await ref.set({
            question,
            frequency: 1,
            lastAsked: new Date().toISOString()
          });
        }
      } catch (e) {
        console.error("[KB Analytics] Missing knowledge write failed:", e.message);
      }
    } else {
      const existing = memoryAnalytics.missingKnowledge.find(m => m.question === question);
      if (existing) {
        existing.frequency += 1;
        existing.lastAsked = new Date().toISOString();
      } else {
        memoryAnalytics.missingKnowledge.push({
          question,
          frequency: 1,
          lastAsked: new Date().toISOString()
        });
      }
    }
  }

  _sanitizeId(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 50);
  }
}

module.exports = new KBAnalytics();
