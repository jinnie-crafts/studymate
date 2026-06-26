const fs = require('fs');
const path = require('path');

const { kbDir } = require('../services/kbManager');
const rootDir = path.join(__dirname, '../../');

function buildPublicDocs() {
  console.log("Building public SEO knowledge files...");

  if (!fs.existsSync(kbDir)) {
    console.error("❌ Knowledge directory not found.");
    process.exit(1);
  }

  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
  const allKnowledge = [];
  const faqList = [];
  const featuresList = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(kbDir, file), 'utf8');
    const data = JSON.parse(raw);
    
    if (!data.entries) continue;

    for (const entry of data.entries) {
      const pubEntry = { question: entry.question, answer: entry.answer };
      allKnowledge.push({ category: data.category, ...pubEntry });
      
      if (file === 'faq.json') faqList.push(pubEntry);
      if (file === 'features.json') featuresList.push(pubEntry);
    }
  }

  // Write full knowledge dump
  fs.writeFileSync(path.join(rootDir, 'knowledge.json'), JSON.stringify(allKnowledge, null, 2));
  console.log("✅ Created knowledge.json");

  // Write FAQ
  fs.writeFileSync(path.join(rootDir, 'faq.json'), JSON.stringify(faqList, null, 2));
  console.log("✅ Created faq.json");

  // Write Features
  fs.writeFileSync(path.join(rootDir, 'features.json'), JSON.stringify(featuresList, null, 2));
  console.log("✅ Created features.json");

  console.log("🎉 Public docs built successfully.");
}

buildPublicDocs();
