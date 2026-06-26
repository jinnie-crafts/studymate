const admin = require('firebase-admin');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

// Ensure Firebase is initialized exactly once to prevent 'App already exists' errors
let app;

try {
  // Use existing app if already initialized
  const getApps = admin.apps || (admin.app ? [admin.app()] : []);
  
  if (!Array.isArray(getApps) || getApps.length === 0) {
    app = admin.initializeApp();
    console.log("[Firebase Admin - Functions] Initialized successfully");
  } else {
    app = getApps[0];
  }
} catch (error) {
  console.error("[Firebase Admin - Functions] Initialization Error:", error);
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
