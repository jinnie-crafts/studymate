const admin = require('firebase-admin');
const { cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

require('dotenv').config();

// Helper to determine project ID
function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID || "";
}

let app;

try {
  const getApps = admin.apps || (admin.app ? [admin.app()] : []);
  
  if (!Array.isArray(getApps) || getApps.length === 0) {
    const projectId = getProjectId();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    const missingVars = [];
    if (!projectId) missingVars.push('FIREBASE_PROJECT_ID');
    if (!clientEmail) missingVars.push('FIREBASE_CLIENT_EMAIL');
    if (!privateKey) missingVars.push('FIREBASE_PRIVATE_KEY');

    if (missingVars.length > 0) {
      throw new Error(`Missing required Firebase environment variables: ${missingVars.join(', ')}`);
    }

    // Convert escaped newlines to actual newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
    
    const credential = cert({
      projectId,
      clientEmail,
      privateKey
    });
    
    const initOptions = {
      credential,
      projectId
    };
    
    app = admin.initializeApp(initOptions);
    console.log(`[Firebase Admin] Firebase initialized`);
    console.log(`[Firebase Admin] Project ID: ${projectId}`);
    console.log(`[Firebase Admin] Authentication ready`);
  } else {
    app = getApps[0];
  }
} catch (error) {
  console.error("\n❌ [Firebase Admin] Initialization Error:");
  console.error(error.message || error);
  console.error("Please configure your Firebase Admin credentials correctly.\n");
  process.exit(1); // Fail fast
}

// Initialize services using modular APIs where applicable
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Only log once during initial require
if (!global.__FIREBASE_ADMIN_LOGGED) {
  console.log("[Firebase Admin] Firestore connected");
  global.__FIREBASE_ADMIN_LOGGED = true;
}

module.exports = {
  admin,
  app,
  db,
  auth,
  storage,
  FieldValue,
  Timestamp
};
