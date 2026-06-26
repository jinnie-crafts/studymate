const express = require('express');
const fs = require('fs');
const path = require('path');
const knowledgeService = require('../services/knowledgeService');

const router = express.Router();
const kbDir = path.join(__dirname, '../knowledge');

// Helper to save file
const saveFile = (filename, data) => {
  fs.writeFileSync(path.join(kbDir, filename), JSON.stringify(data, null, 2));
  knowledgeService.loadKB(); // Refresh in-memory service
};

// Get all KB categories
router.get('/', (req, res) => {
  if (!fs.existsSync(kbDir)) return res.json([]);
  
  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
  const allData = files.map(file => {
    const raw = fs.readFileSync(path.join(kbDir, file), 'utf8');
    try {
      const parsed = JSON.parse(raw);
      return { filename: file, category: parsed.category, entries: parsed.entries || [] };
    } catch(e) {
      return null;
    }
  }).filter(Boolean);

  res.json(allData);
});

// Update or Add Entry
router.post('/entry', (req, res) => {
  const { filename, entry } = req.body;
  if (!filename || !entry || !entry.id) {
    return res.status(400).json({ error: 'Missing filename or entry data' });
  }

  const filePath = path.join(kbDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Category file not found' });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const existingIndex = data.entries.findIndex(e => e.id === entry.id);
    
    if (existingIndex >= 0) {
      data.entries[existingIndex] = entry; // Update
    } else {
      data.entries.push(entry); // Add
    }

    data.lastUpdated = new Date().toISOString().split('T')[0];
    saveFile(filename, data);
    
    res.json({ success: true, message: 'Entry saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

// Delete Entry
router.delete('/entry', (req, res) => {
  const { filename, id } = req.body;
  if (!filename || !id) return res.status(400).json({ error: 'Missing parameters' });

  const filePath = path.join(kbDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.entries = data.entries.filter(e => e.id !== id);
    data.lastUpdated = new Date().toISOString().split('T')[0];
    saveFile(filename, data);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Sync to Firestore
router.post('/sync', async (req, res) => {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      try {
        admin.initializeApp();
      } catch(e) {
        return res.status(500).json({ error: 'Firebase Admin SDK failed to initialize: ' + e.message });
      }
    }
    const db = admin.firestore();

    if (!fs.existsSync(kbDir)) {
      return res.status(404).json({ error: 'Knowledge directory not found' });
    }

    const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
    let totalEntries = 0;

    for (const file of files) {
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
    }

    res.json({ success: true, count: totalEntries });
  } catch (err) {
    console.error("Firestore Sync Error:", err);
    res.status(500).json({ error: 'Firestore sync failed: ' + err.message });
  }
});

module.exports = router;
