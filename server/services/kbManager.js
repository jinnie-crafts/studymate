const fs = require('fs');
const path = require('path');

// By resolving from __dirname (which is server/services), we guarantee
// an absolute path to server/knowledge regardless of process.cwd().
const kbDir = path.resolve(__dirname, '../knowledge');

const REQUIRED_FILES = [
  'studymate-kb.json',
  'company.json',
  'features.json',
  'faq.json',
  'technology.json',
  'privacy.json',
  'support.json',
  'future-features.json'
];

function initKnowledgeBase() {
  console.log(`[KB Manager] Initializing Knowledge Base at: ${kbDir}`);

  if (!fs.existsSync(kbDir)) {
    console.log(`[KB Manager] Creating missing knowledge directory: ${kbDir}`);
    fs.mkdirSync(kbDir, { recursive: true });
  }

  REQUIRED_FILES.forEach(filename => {
    const filePath = path.join(kbDir, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`[KB Manager] Creating missing required file: ${filename}`);
      
      const categoryName = filename.replace('.json', '').replace(/-/g, ' ');
      const defaultContent = {
        category: categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
        version: "1.0",
        lastUpdated: new Date().toISOString().split('T')[0],
        entries: [
          {
            id: `${categoryName.replace(/\s+/g, '-')}-1`,
            question: `What is the default entry for ${categoryName}?`,
            answer: `This is the default auto-generated entry for the ${categoryName} category.`,
            keywords: ["default", categoryName]
          }
        ]
      };
      
      fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
    }
  });

  console.log(`[KB Manager] Verified all required knowledge files.`);
}

module.exports = {
  kbDir,
  initKnowledgeBase
};
