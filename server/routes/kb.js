const express = require('express');
const fs = require('fs');
const path = require('path');
const knowledgeService = require('../services/knowledgeService');

const router = express.Router();
const { kbDir } = require('../services/kbManager');

// Helper to save file
const saveFile = (filename, data) => {
  fs.writeFileSync(path.join(kbDir, filename), JSON.stringify(data, null, 2));
  knowledgeService.loadKB(); // Refresh in-memory service
};

// Get all KB categories
router.get('/', (req, res) => {
  try {
    const allData = knowledgeService.getAllKnowledge();
    res.json(allData);
  } catch (error) {
    console.error("[KB] API GET Error:", error);
    res.status(500).json({ error: 'Failed to load knowledge' });
  }
});

// Update or Add Entry
router.post('/entry', async (req, res) => {
  const { filename, entry } = req.body;
  if (!filename || !entry || !entry.id) {
    return res.status(400).json({ error: 'Missing filename or entry data' });
  }

  try {
    await knowledgeService.addOrUpdateEntry(filename, entry);
    res.json({ success: true, message: 'Entry saved' });
  } catch (e) {
    console.error("[KB] API POST Error:", e);
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

// Delete Entry
router.delete('/entry', async (req, res) => {
  const { filename, id } = req.body;
  if (!filename || !id) return res.status(400).json({ error: 'Missing parameters' });

  try {
    await knowledgeService.deleteEntry(filename, id);
    res.json({ success: true });
  } catch (e) {
    console.error("[KB] API DELETE Error:", e);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Sync to Firestore
router.post('/sync', async (req, res) => {
  try {
    const totalEntries = await knowledgeService.syncToFirestore();
    res.json({ success: true, count: totalEntries });
  } catch (err) {
    console.error("[KB] API SYNC Error:", err);
    res.status(500).json({ error: 'Firestore sync failed: ' + err.message });
  }
});

module.exports = router;
