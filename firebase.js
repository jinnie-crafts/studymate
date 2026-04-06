import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDljS0leq2NDd0el5daQkUK-MvMsPwk9MM",
  authDomain: "studymate-ai-bc65e.firebaseapp.com",
  projectId: "studymate-ai-bc65e",
  storageBucket: "studymate-ai-bc65e.firebasestorage.app",
  messagingSenderId: "320860002411",
  appId: "1:320860002411:web:1f02c4140623920facb92e"
};

// Firebase client config is public-safe.
// All security is enforced by Firestore Security Rules on the server side.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "asia-south1");

export { auth, db, functions };
