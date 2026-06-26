const admin = require('firebase-admin');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

// Ensure Firebase is initialized exactly once to prevent 'App already exists' errors
let app;

try {
  // Use existing app if already initialized (handles Firebase Admin v12+)
  const getApps = admin.apps || (admin.app ? [admin.app()] : []);
  
  if (!Array.isArray(getApps) || getApps.length === 0) {
    app = admin.initializeApp();
    console.log("[Firebase Admin] Initialized successfully");
  } else {
    app = getApps[0];
  }
} catch (error) {
  console.error("[Firebase Admin] Initialization Error:", error);
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
