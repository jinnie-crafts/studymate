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
      return { 
        filename: file, 
        category: parsed.category || 'Uncategorized', 
        entries: Array.isArray(parsed.entries) ? parsed.entries : [] 
      };
    } catch(e) {
      console.error(`[KB] Error parsing ${file}:`, e);
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
    if (!Array.isArray(data.entries)) {
      data.entries = [];
    }
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
    if (!Array.isArray(data.entries)) {
      data.entries = [];
    }
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
  console.log("Knowledge sync started");
  try {
    console.log("Payload:", req.body);
    const { db, FieldValue } = require('../services/firebaseAdmin');

    if (!fs.existsSync(kbDir)) {
      return res.status(404).json({ error: 'Knowledge directory not found' });
    }

    const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
    let totalEntries = 0;
    
    let allCategories = [];

    for (const file of files) {
      const raw = fs.readFileSync(path.join(kbDir, file), 'utf8');
      const data = JSON.parse(raw);
      const category = data.category;
      
      allCategories.push(category);

      console.log("Knowledge:", data);

      if (!data.entries || !Array.isArray(data.entries)) {
        console.log(`Skipping file ${file}: entries is not an array.`);
        continue;
      }
      
      const entries = data.entries;
      console.log("Entries:", entries);

      const batch = db.batch();
      
      for (const entry of data.entries) {
        const docRef = db.collection("knowledge").doc(entry.id);
        batch.set(docRef, {
          ...entry,
          category,
          sourceFile: file,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        totalEntries++;
      }
      
      await batch.commit();
    }
    
    console.log("Categories:", allCategories);

    console.log("Knowledge sync completed");
    res.json({ success: true, count: totalEntries });
  } catch (err) {
    console.error("Knowledge sync failed");
    console.error("Firestore Sync Error:", err);
    res.status(500).json({ error: 'Firestore sync failed: ' + err.message });
  }
});

module.exports = router;
