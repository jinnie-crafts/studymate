const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

require('dotenv').config();

// Helper to determine project ID
function getProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || 
         process.env.GCLOUD_PROJECT || 
         process.env.FIREBASE_PROJECT_ID ||
         "";
}

let app;

try {
  const getApps = admin.apps || (admin.app ? [admin.app()] : []);
  
  if (!Array.isArray(getApps) || getApps.length === 0) {
    let credential = undefined;
    let projectId = getProjectId();
    
    // Check if GOOGLE_APPLICATION_CREDENTIALS is set and valid
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const fs = require('fs');
      if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        try {
          const serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
          
          if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
             throw new Error("Service account is missing required fields (project_id, client_email, private_key)");
          }
          
          if (!projectId) projectId = serviceAccount.project_id;
          credential = cert(serviceAccount);
        } catch(e) {
          throw new Error(`Invalid service account file: ${e.message}`);
        }
      } else {
        throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found at: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
      }
    }
    
    if (!projectId && !credential) {
      throw new Error("Unable to detect a Project Id. Set FIREBASE_PROJECT_ID or GOOGLE_APPLICATION_CREDENTIALS.");
    }
    
    const initOptions = {};
    if (credential) initOptions.credential = credential;
    if (projectId) initOptions.projectId = projectId;
    
    app = admin.initializeApp(initOptions);
    console.log(`[Firebase Admin - Functions] Initialized successfully. Project ID: ${projectId || "unknown"}`);
  } else {
    app = getApps[0];
  }
} catch (error) {
  console.error("\n❌ [Firebase Admin - Functions] Initialization Error:");
  console.error(error.message || error);
  console.error("Please configure your Firebase Admin credentials correctly.\n");
  process.exit(1); // Fail fast
}

// Initialize services using modular APIs where applicable
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

module.exports = {
  admin,
  app,
  db,
  auth,
  storage,
  FieldValue,
  Timestamp
};
