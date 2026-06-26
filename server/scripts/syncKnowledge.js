const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Ensure you have FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS
try {
  admin.initializeApp();
} catch (e) {
  console.error("❌ CRITICAL: Failed to initialize Firebase Admin. Set GOOGLE_APPLICATION_CREDENTIALS.");
  process.exit(1);
}

const db = admin.firestore();
const kbDir = path.join(__dirname, '../knowledge');

async function syncKnowledge() {
  console.log("Starting Knowledge Base Sync to Firestore...");
  
  if (!fs.existsSync(kbDir)) {
    console.error("❌ Knowledge directory not found.");
    process.exit(1);
  }

  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
  let totalEntries = 0;

  for (const file of files) {
    console.log(`Processing ${file}...`);
    try {
      const raw = fs.readFileSync(path.join(kbDir, file), 'utf8');
      const data = JSON.parse(raw);
      const category = data.category;

      if (!data.entries || !Array.isArray(data.entries)) continue;

      const batch = db.batch();
      
      for (const entry of data.entries) {
        const docRef = db.collection("knowledge").doc(entry.id);
        batch.set(docRef, {
          ...entry,
          category,
          sourceFile: file,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        totalEntries++;
      }
      
      await batch.commit();
      console.log(`✅ Synced ${data.entries.length} entries from ${file}`);
    } catch(err) {
      console.error(`❌ Failed to process ${file}:`, err.message);
    }
  }

  console.log(`\n🎉 Successfully synced ${totalEntries} knowledge base entries to Firestore.`);
  process.exit(0);
}

syncKnowledge();
