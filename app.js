import { auth, db } from "./firebase.js";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

// ---------------------------------------------------------------------------
// 1. Firebase Action Interceptor (Priority Handling)
// ---------------------------------------------------------------------------
// Extract params immediately to define isFirebaseAction globally
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

// Strict validation of the action link
const isFirebaseAction = !!(
  oobCode &&
  oobCode.length > 20 &&
  /^[a-zA-Z0-9_-]+$/.test(oobCode) &&
  ["resetPassword", "verifyEmail", "recoverEmail"].includes(mode)
);

// Global Interception Guard
(function () {
  if (isFirebaseAction && !window.__firebaseActionHandled) {
    window.__firebaseActionHandled = true;

    // Choose dynamic message/target
    let target = "";
    let message = "Processing account action...";
    if (mode === "resetPassword") { target = "reset.html"; message = "Preparing password reset..."; }
    else if (mode === "verifyEmail") { target = "verify.html"; message = "Verifying your account..."; }
    else if (mode === "recoverEmail") { target = "recover.html"; message = "Recovering your account..."; }

    // Intercept if not already on the target page
    if (!window.location.pathname.includes(target)) {
      // Inject high-priority loading UI
      const overlay = document.createElement("div");
      overlay.id = "priority-action-overlay";
      overlay.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:#020617; display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:9999; font-family:'Outfit',sans-serif; color:white; text-align:center;";
      overlay.innerHTML = `
        <div class="spinner" style="width:48px; height:48px; border:4px solid rgba(59,130,246,0.1); border-top:4px solid #3b82f6; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:20px;"></div>
        <div style="font-size:20px; font-weight:600;">${message}</div>
        <style>@keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }</style>
      `;
      document.body.appendChild(overlay);

      // Execute Immediate Redirect
      window.location.replace(`${target}?oobCode=${encodeURIComponent(oobCode)}`);

      // CRITICAL: Stop the rest of the script (bootstrap, auth guards, etc.) to prevent login redirection
      throw new Error("FIREBASE_ACTION_INTERCEPTED: Halting initialization for redirection.");
    }
  }
})();


import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  Timestamp,
  serverTimestamp,
  orderBy,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE_URL = window.location.hostname === "localhost"
  ? "http://localhost:3001"
  : "https://studymate-ms3l.onrender.com";

const page = document.body.dataset.page;
const FLASH_TOAST_KEY = "studymate_flash_toast";
const GUEST_QUESTION_LIMIT = 5;
const GUEST_USAGE_KEY = "studymate_guest_question_count";
const STORAGE_KEYS = { theme: "theme", defaultMode: "defaultMode", hinglishDefault: "hinglishDefault", defaultNotesMode: "defaultNotesMode" };
const AVAILABLE_MODES = ["General", "UPSC", "JEE", "NEET"];
const AVAILABLE_NOTES_MODES = ["normal", "bullet", "revision", "flashcards"];
const AVAILABLE_THEMES = ["dark", "light", "blue", "purple"];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  currentUser: null, chats: [], currentChatId: null, editingChatId: null,
  renameDraft: "", isSending: false, showTypingIndicator: false,
  editingMessageIndex: null, messageDraft: "", chatsUnsubscribe: null,
  preferredChatId: null, streamingResponse: null,
  trackerData: { questionsToday: 0, streakCount: 0 },
  isGuestMode: false,
  guestQuestionsUsed: 0
};

let ui = null;
const feedbackUi = {
  initialized: false, toastContainer: null, confirmModal: null,
  confirmLabel: null, confirmTitle: null, confirmMessage: null,
  confirmCancelBtn: null, confirmOkBtn: null, confirmResolver: null
};

marked.setOptions({
  gfm: true,
  breaks: true
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUserId() {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");
  return user.uid;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

applySavedTheme();
initializeFeedbackUi();
consumeFlashToast();
window.goToSettings = goToSettings;
bootstrap();

function bootstrap() {
  if (page === "login") return initLoginPage();
  if (page === "signup") return initSignupPage();
  if (page === "dashboard") return initDashboardPage();
  if (page === "settings") return initSettingsPage();
}

// ---------------------------------------------------------------------------
// Auth pages
// ---------------------------------------------------------------------------

function initLoginPage() {
  const loginForm = document.getElementById("loginForm");
  const authMessage = document.getElementById("authMessage");
  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  onAuthStateChanged(auth, (user) => {
    if (user && (user.emailVerified || user.providerData[0]?.providerId === 'google.com')) {
      window.location.replace("index.html");
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
      setFormMessage(authMessage, "Please enter your email and password.", "error");
      return;
    }

    try {
      setFormMessage(authMessage, "Logging in...", "success");
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Mandatory reload for real-time verification status
      await cred.user.reload();
      const updatedUser = auth.currentUser;

      const isGoogle = updatedUser.providerData[0]?.providerId === 'google.com';
      if (!updatedUser.emailVerified && !isGoogle) {
        // Not verified and not google
        await signOut(auth);
        showVerificationModal(updatedUser);
        setFormMessage(authMessage, "Please verify your email before logging in.", "error");
        return;
      }

      await ensureUserDocument(updatedUser);
      queueFlashToast("Logged in successfully.", "success");
      window.location.replace("index.html");
    } catch (err) {
      console.error("Login error:", err);
      setFormMessage(authMessage, "Invalid email or password.", "error");
      showToast("Invalid email or password.", "error");
    }
  });

  if (forgotPasswordLink) {
    const forgotModal = document.getElementById("forgotModal");
    const resetEmailInput = document.getElementById("resetEmail");
    const sendResetBtn = document.getElementById("sendResetBtn");
    const resetStatus = document.getElementById("resetStatus");
    const closeModalBtn = document.getElementById("closeModal");

    forgotPasswordLink.addEventListener("click", () => {
      if (forgotModal) forgotModal.classList.add("show");
      if (resetEmailInput) {
        resetEmailInput.value = document.getElementById("loginEmail").value.trim();
        resetEmailInput.focus();
      }
    });

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        if (forgotModal) forgotModal.classList.remove("show");
        if (resetStatus) resetStatus.textContent = "";
      });
    }

    if (forgotModal) {
      forgotModal.addEventListener("click", (e) => {
        if (e.target === forgotModal) {
          forgotModal.classList.remove("show");
          if (resetStatus) resetStatus.textContent = "";
        }
      });
    }

    if (sendResetBtn) {
      sendResetBtn.addEventListener("click", async () => {
        const email = resetEmailInput.value.trim();
        if (!email) {
          resetStatus.textContent = "Please enter an email address.";
          resetStatus.className = "form-message error";
          return;
        }

        try {
          sendResetBtn.disabled = true;
          sendResetBtn.textContent = "Sending...";
          await sendPasswordResetEmail(auth, email, {
            url: window.location.origin
          });

          // Store for auto-login on reset page
          localStorage.setItem("resetEmail", email);

          resetStatus.textContent = "If an account exists, a reset link has been sent.";
          resetStatus.className = "form-message success";

          setTimeout(() => {
            if (forgotModal) forgotModal.classList.remove("show");
            sendResetBtn.disabled = false;
            sendResetBtn.textContent = "Send Reset Link";
            resetStatus.textContent = "";
          }, 4000);

        } catch (err) {
          console.error("Password reset error:", err);
          // Generic error for security
          resetStatus.textContent = "If an account exists, a reset link has been sent.";
          resetStatus.className = "form-message success";
          sendResetBtn.disabled = false;
          sendResetBtn.textContent = "Send Reset Link";
        }
      });
    }

    const closeResetCardBtn = document.getElementById("closeResetCard");
    if (closeResetCardBtn) {
      closeResetCardBtn.addEventListener("click", () => {
        const resetCard = document.getElementById("resetCard");
        if (resetCard) resetCard.classList.add("hidden");
      });
    }
  }

  googleLoginBtn.addEventListener("click", loginWithGoogle);
}

const blockedDomains = new Set([
  "tempmail.com", "10minutemail.com", "mailinator.com", "guerrillamail.com", "yopmail.com",
  "dispostable.com", "tempmailaddress.com", "getnada.com", "temp-mail.org"
]);

function initSignupPage() {
  const signupForm = document.getElementById("signupForm");
  const authMessage = document.getElementById("authMessage");
  const googleLoginBtn = document.getElementById("googleLoginBtn");

  onAuthStateChanged(auth, (user) => {
    if (user && user.emailVerified) window.location.replace("index.html");
  });

  let isSubmitting = false;
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;

    if (!email || !password) {
      setFormMessage(authMessage, "Please fill in all fields.", "error");
      return;
    }

    const domain = email.split("@")[1]?.toLowerCase();
    if (blockedDomains.has(domain)) {
      setFormMessage(authMessage, "Temporary/Disposable emails are not allowed.", "error");
      showToast("Please use a permanent email address.", "error");
      return;
    }

    try {
      isSubmitting = true;
      const submitBtn = signupForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      setFormMessage(authMessage, "Creating your secure account...", "success");

      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        console.log("User created:", user.email);

        // SEND VERIFICATION EMAIL
        try {
          console.log("Sending verification email...");
          await sendEmailVerification(user, {
            url: window.location.origin
          });
          console.log("Verification email sent");
        } catch (emailError) {
          console.error("Email send failed:", emailError);
        }

        // ENSURE FIRESTORE SYNC
        await ensureUserDocument(user);

        // SHOW SUCCESS MESSAGE (Specific)
        setFormMessage(authMessage, "Verification email sent. Please check your inbox and spam folder.", "success");

        // SIGN OUT (IMPORTANT: must verify before full session)
        await signOut(auth);

        // TRIGGER MODAL
        showVerificationModal(user);

      } catch (err) {
        console.error("Signup error:", err.code);
        if (err.code === "auth/email-already-in-use") {
          setFormMessage(authMessage, "Account already exists. Please login.", "error");
        } else {
          setFormMessage(authMessage, "Signup failed. Please try again.", "error");
        }
      }

    } catch (err) {
      console.error("Critical Signup error:", err);
      setFormMessage(authMessage, "An error occurred. Please try again.", "error");
      showToast(err.message, "error");
    } finally {
      isSubmitting = false;
      const submitBtn = signupForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  if (googleLoginBtn) googleLoginBtn.addEventListener("click", loginWithGoogle);
}

function showVerificationModal(user) {
  const modal = document.getElementById("verifyModal");
  if (!modal) return;

  modal.classList.add("show");

  const resendBtn = document.getElementById("resendVerifyBtn");
  const statusEl = document.getElementById("verifyStatus");
  const closeBtn = document.getElementById("closeVerifyModal");

  let cooldown = 0;
  let timerInterval = null;

  const startCooldown = () => {
    const timestamp = Date.now();
    localStorage.setItem("lastResendTimestamp", timestamp);
    resendBtn.classList.add("disabled");
    resendBtn.disabled = true;

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - timestamp) / 1000);
      cooldown = 60 - elapsed;
      resendBtn.textContent = `Resend available in ${cooldown}s`;
      if (cooldown <= 0) {
        clearInterval(timerInterval);
        resendBtn.classList.remove("disabled");
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend Email";
        localStorage.removeItem("lastResendTimestamp");
      }
    }, 1000);
  };

  // Check for existing cooldown on modal open
  const savedTimestamp = localStorage.getItem("lastResendTimestamp");
  if (savedTimestamp) {
    const elapsed = Math.floor((Date.now() - parseInt(savedTimestamp)) / 1000);
    if (elapsed < 60) {
      startCooldown();
    }
  }

  resendBtn.onclick = async () => {
    try {
      statusEl.textContent = "Sending verification...";
      statusEl.className = "verify-status waiting";

      // If user is signed out, we might need them to sign in again or just use the link
      // But Firebase allows sending toCurrentUser if they just signed up
      console.log("Resending verification email to:", user.email || (auth.currentUser ? auth.currentUser.email : "Unknown"));
      await sendEmailVerification(auth.currentUser || user, {
        url: window.location.origin
      });

      statusEl.textContent = "New verification link sent!";
      statusEl.className = "verify-status success";
      startCooldown();
    } catch (err) {
      statusEl.textContent = "Failed to resend. Please try again later.";
      statusEl.className = "verify-status error";
    }
  };

  closeBtn.onclick = () => {
    modal.classList.remove("show");
    if (timerInterval) clearInterval(timerInterval);
  };
}

async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    await ensureUserDocument(result.user);
    queueFlashToast("Signed in with Google.", "success");
    window.location.replace("index.html");
  } catch (err) { console.error("Google login error:", err); showToast(err.message, "error"); }
}

// ---------------------------------------------------------------------------
// Firestore user document
// ---------------------------------------------------------------------------

async function ensureUserDocument(user) {
  if (!user) return;
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || "User",
        email: user.email || "",
        photoURL: user.photoURL || "",
        onboardingDone: false,
        createdAt: serverTimestamp()
      });
      state.userOnboardingDone = false;
    } else {
      const data = snap.data();
      state.userOnboardingDone = data.onboardingDone || false;
      await updateDoc(userRef, {
        name: user.displayName || data.name || "User",
        email: user.email || data.email || "",
        photoURL: user.photoURL || snap.data().photoURL || ""
      });
    }
  } catch (error) {
    console.error(error);
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  }
}

async function loadTrackerData() {
  if (!state.currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", state.currentUser.uid));
    if (!snap.exists()) return;
    const data = snap.data();
    const today = todayString();
    if (data.lastActiveDate !== today) {
      state.trackerData.questionsToday = 0;
    } else {
      state.trackerData.questionsToday = data.questionsToday || 0;
    }
    state.trackerData.streakCount = data.streakCount || 0;
    renderTracker();
  } catch (err) { console.error("loadTrackerData error:", err); }
}

async function incrementStudyTracker() {
  if (!state.currentUser) return;
  try {
    const userRef = doc(db, "users", state.currentUser.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const today = todayString();
    const yesterday = yesterdayString();
    let questionsToday = data.questionsToday || 0;
    let streakCount = data.streakCount || 0;

    if (data.lastActiveDate === today) {
      questionsToday += 1;
    } else {
      questionsToday = 1;
      if (data.lastActiveDate === yesterday) { streakCount += 1; }
      else { streakCount = 1; }
    }

    await updateDoc(userRef, { questionsAsked: (data.questionsAsked || 0) + 1, questionsToday, lastActiveDate: today, streakCount });
    state.trackerData.questionsToday = questionsToday;
    state.trackerData.streakCount = streakCount;
    renderTracker();
  } catch (err) { console.error("incrementStudyTracker error:", err); }
}

function renderTracker() {
  const qtEl = document.getElementById("questionsToday");
  const skEl = document.getElementById("streakCount");
  if (qtEl) qtEl.textContent = state.trackerData.questionsToday;
  if (skEl) skEl.textContent = state.trackerData.streakCount;
}

function todayString() { return new Date().toISOString().slice(0, 10); }
function yesterdayString() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function initDashboardPage() {
  ui = {
    body: document.body,
    newChatBtn: document.getElementById("newChatBtn"),
    chatHistoryList: document.getElementById("chatHistoryList"),
    chatTitle: document.getElementById("chatTitle"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    userInput: document.getElementById("userInput"),
    sendBtn: document.getElementById("sendBtn"),
    modeDropdown: document.getElementById("modeDropdown"),
    selectedMode: document.getElementById("selectedMode"),
    dropdownOptions: document.getElementById("dropdownOptions"),
    notesDropdown: document.getElementById("notesDropdown"),
    notesSelected: document.getElementById("notesSelected"),
    notesDropdownOptions: document.getElementById("notesDropdownOptions"),
    hinglishToggle: document.getElementById("hinglishToggle"),
    profileBtn: document.getElementById("profileBtn"),
    profileDropdown: document.getElementById("profileDropdown"),
    userShortName: document.getElementById("userShortName"),
    userAvatar: document.getElementById("userAvatar"),
    dropdownAvatar: document.getElementById("dropdownAvatar"),
    dropdownUserName: document.getElementById("userName"),
    dropdownUserEmail: document.getElementById("userEmail"),
    settingsBtn: document.getElementById("settingsBtn"),
    editNameBtn: document.getElementById("editNameBtn"),
    editNameModal: document.getElementById("editNameModal"),
    newNameInput: document.getElementById("newNameInput"),
    saveNameBtn: document.getElementById("saveNameBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    menuToggleBtn: document.getElementById("menuToggleBtn"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    guestLimitModal: document.getElementById("guestLimitModal"),
    guestLimitText: document.getElementById("guestLimitText"),
    guestLoginBtn: document.getElementById("guestLoginBtn"),
    guestSignupBtn: document.getElementById("guestSignupBtn"),
    guestLaterBtn: document.getElementById("guestLaterBtn")
  };

  bindDashboardEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user && !isFirebaseAction) {
      initializeGuestDashboard();
      return;
    }
    if (!user) return;

    // Mandatory reload for real-time verification status
    await user.reload();
    const updatedUser = auth.currentUser;

    // Check for email verification, skip if Google user
    const isGoogle = updatedUser.providerData[0]?.providerId === 'google.com';
    if (!updatedUser.emailVerified && !isGoogle && !isFirebaseAction) {
      window.location.replace("login.html");
      return;
    }

    closeGuestLimitModal();
    cleanupChatSubscription();
    state.isGuestMode = false;
    state.currentUser = null;
    state.chats = [];
    state.currentChatId = null;
    state.preferredChatId = null;
    state.editingChatId = null;
    state.renameDraft = "";
    state.guestQuestionsUsed = loadGuestQuestionUsage();
    if (ui.logoutBtn) ui.logoutBtn.textContent = "Logout";
    if (ui.editNameBtn) {
      ui.editNameBtn.disabled = false;
      ui.editNameBtn.removeAttribute("title");
    }

    state.currentUser = updatedUser;
    await ensureUserDocument(updatedUser);
    displayUserProfile(updatedUser.displayName || "User", updatedUser.email || "No email found", updatedUser.photoURL || "");

    // Check for onboarding (Firestore sync)
    if (state.userOnboardingDone === false) {
      showOnboardingOverlay();
    }

    loadChats();
    loadTrackerData();
  });
}

function initializeGuestDashboard() {
  closeGuestLimitModal();
  cleanupChatSubscription();
  state.isGuestMode = true;
  state.currentUser = null;
  state.chats = [];
  state.currentChatId = null;
  state.preferredChatId = null;
  state.editingChatId = null;
  state.renameDraft = "";
  state.editingMessageIndex = null;
  state.messageDraft = "";
  state.showTypingIndicator = false;
  state.guestQuestionsUsed = loadGuestQuestionUsage();

  displayUserProfile("Guest", "Login to save chat history", "");
  if (ui.logoutBtn) ui.logoutBtn.textContent = "Login";
  if (ui.editNameBtn) {
    ui.editNameBtn.disabled = true;
    ui.editNameBtn.title = "Please log in to edit your profile";
  }

  setSelectedMode(getSavedDefaultMode());
  setSelectedNotesMode(getSavedDefaultNotesMode());
  ui.hinglishToggle.checked = getSavedHinglishDefault();

  renderHistory();
  renderMessages();
}

function loadGuestQuestionUsage() {
  const raw = localStorage.getItem(GUEST_USAGE_KEY);
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function saveGuestQuestionUsage(count) {
  localStorage.setItem(GUEST_USAGE_KEY, String(Math.max(0, count)));
}

function isGuestUsageLimitReached() {
  return state.isGuestMode && state.guestQuestionsUsed >= GUEST_QUESTION_LIMIT;
}

function incrementGuestQuestionUsage() {
  if (!state.isGuestMode) return;
  state.guestQuestionsUsed += 1;
  saveGuestQuestionUsage(state.guestQuestionsUsed);
}

function showGuestLimitModal() {
  if (!ui?.guestLimitModal) return;
  if (ui.guestLimitText) {
    const remaining = Math.max(0, GUEST_QUESTION_LIMIT - state.guestQuestionsUsed);
    ui.guestLimitText.textContent = remaining > 0
      ? `You have ${remaining} guest question${remaining === 1 ? "" : "s"} left.`
      : `You have reached the ${GUEST_QUESTION_LIMIT}-question guest limit.`;
  }
  ui.guestLimitModal.classList.add("show");
  ui.guestLimitModal.setAttribute("aria-hidden", "false");
}

function closeGuestLimitModal() {
  if (!ui?.guestLimitModal) return;
  ui.guestLimitModal.classList.remove("show");
  ui.guestLimitModal.setAttribute("aria-hidden", "true");
}

function createGuestMessage(role, content) {
  return {
    id: `guest-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Timestamp.now()
  };
}

function showOnboardingOverlay() {
  const overlay = document.getElementById("onboarding");
  const startBtn = document.getElementById("startBtn");
  if (!overlay || !startBtn) return;

  overlay.classList.remove("hidden");

  // Highlight New Chat briefly
  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) {
    newChatBtn.style.boxShadow = "0 0 20px #3b82f6";
    setTimeout(() => { if (newChatBtn) newChatBtn.style.boxShadow = ""; }, 3000);
  }

  startBtn.onclick = async () => {
    try {
      startBtn.disabled = true;
      startBtn.textContent = "Setting up...";

      // Persistence: Update Firestore
      const userRef = doc(db, "users", state.currentUser.uid);
      await updateDoc(userRef, { onboardingDone: true });
      state.userOnboardingDone = true;

      overlay.classList.add("hidden");

      // Welcome message in chat (Prevention of duplicates)
      if (ui.chatMessages && !sessionStorage.getItem("welcomeMessageSent")) {
        const welcomeMsg = document.createElement("div");
        welcomeMsg.className = "message ai-message";
        welcomeMsg.innerHTML = `<p>Hi! I'm StudyMate AI 👋 What would you like to learn today? I can help with UPSC, JEE, NEET subjects or any other study topic!</p>`;
        ui.chatMessages.appendChild(welcomeMsg);
        scrollMessagesToBottom();
        sessionStorage.setItem("welcomeMessageSent", "true");
      }

      // Auto focus input
      if (ui.userInput) {
        ui.userInput.placeholder = "Ask anything... (e.g. Explain photosynthesis)";
        ui.userInput.focus();
      }
    } catch (err) {
      console.error("Onboarding setup error:", err);
      overlay.classList.add("hidden"); // Proceed anyway but log error
    }
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function initSettingsPage() {
  ui = {
    themeSelector: document.getElementById("themeSelector"),
    defaultModeSelect: document.getElementById("defaultModeSelect"),
    defaultNotesModeSelect: document.getElementById("defaultNotesModeSelect"),
    defaultHinglishToggle: document.getElementById("defaultHinglishToggle"),
    settingsUserName: document.getElementById("settingsUserName"),
    settingsUserEmail: document.getElementById("settingsUserEmail"),
    resetSettingsBtn: document.getElementById("resetSettingsBtn"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn")
  };

  bindSettingsEvents();
  renderSettingsPreferences();

  onAuthStateChanged(auth, async (user) => {
    if (!user && !isFirebaseAction) { window.location.replace("login.html"); return; }
    if (!user) return;

    const isGoogle = user.providerData[0]?.providerId === 'google.com';
    if (!user.emailVerified && !isGoogle && !isFirebaseAction) {
      window.location.replace("login.html");
      return;
    }

    state.currentUser = user;
    renderSettingsAccount(user);
  });
}

// ---------------------------------------------------------------------------
// Dashboard events
// ---------------------------------------------------------------------------

function bindDashboardEvents() {
  ui.newChatBtn.addEventListener("click", handleNewChat);
  ui.logoutBtn.addEventListener("click", handleLogout);
  bindModeDropdown();
  bindNotesDropdown();

  ui.chatForm.addEventListener("submit", async (e) => { e.preventDefault(); await handleSendMessage(); });
  ui.userInput.addEventListener("input", () => autoResizeTextarea(ui.userInput));
  ui.userInput.addEventListener("keydown", async (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await handleSendMessage(); } });
  ui.hinglishToggle.addEventListener("change", async () => await saveActiveChatSettings());

  ui.profileBtn.addEventListener("click", (e) => { e.stopPropagation(); closeModeDropdown(); closeNotesDropdown(); ui.profileDropdown.classList.toggle("show"); });
  if (ui.settingsBtn) ui.settingsBtn.addEventListener("click", () => goToSettings());
  ui.editNameBtn.addEventListener("click", () => openEditNameModal());
  ui.cancelBtn.addEventListener("click", () => closeEditNameModal());
  ui.saveNameBtn.addEventListener("click", async () => await saveDisplayName());
  ui.newNameInput.addEventListener("keydown", async (e) => { if (e.key === "Enter") { e.preventDefault(); await saveDisplayName(); } if (e.key === "Escape") closeEditNameModal(); });

  ui.chatHistoryList.addEventListener("click", async (e) => {
    const o = e.target.closest("[data-open-chat]"), r = e.target.closest("[data-rename-chat]"),
      d = e.target.closest("[data-delete-chat]"), s = e.target.closest("[data-save-rename]"),
      c = e.target.closest("[data-cancel-rename]");
    if (o) return openChat(o.dataset.openChat);
    if (r) return startRename(r.dataset.renameChat);
    if (d) return await deleteChat(d.dataset.deleteChat);
    if (s) return await saveRename(s.dataset.saveRename);
    if (c) return cancelRename();
  });
  ui.chatHistoryList.addEventListener("input", (e) => { if (e.target.matches(".rename-input")) state.renameDraft = e.target.value; });
  ui.chatHistoryList.addEventListener("keydown", async (e) => { if (!e.target.matches(".rename-input")) return; if (e.key === "Enter") { e.preventDefault(); await saveRename(e.target.dataset.chatId); } if (e.key === "Escape") cancelRename(); });

  ui.chatMessages.addEventListener("click", async (e) => {
    const cp = e.target.closest("[data-copy-message]");
    const rg = e.target.closest("[data-regenerate-message]");
    if (cp) return await copyMessageContent(Number(cp.dataset.copyMessage));
    if (rg) return await regenerateAiMessage(Number(rg.dataset.regenerateMessage));
  });

  ui.menuToggleBtn.addEventListener("click", toggleSidebar);
  ui.sidebarOverlay.addEventListener("click", closeSidebar);
  if (ui.guestLoginBtn) ui.guestLoginBtn.addEventListener("click", () => window.location.assign("login.html"));
  if (ui.guestSignupBtn) ui.guestSignupBtn.addEventListener("click", () => window.location.assign("signup.html"));
  if (ui.guestLaterBtn) ui.guestLaterBtn.addEventListener("click", closeGuestLimitModal);
  if (ui.guestLimitModal) {
    ui.guestLimitModal.addEventListener("click", (e) => {
      if (e.target === ui.guestLimitModal) closeGuestLimitModal();
    });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".profile-wrap") && ui.profileDropdown.classList.contains("show")) ui.profileDropdown.classList.remove("show");
    if (!e.target.closest("#modeDropdown")) closeModeDropdown();
    if (!e.target.closest("#notesDropdown")) closeNotesDropdown();
  });
  ui.editNameModal.addEventListener("click", (e) => { if (e.target === ui.editNameModal) closeEditNameModal(); });
}

// ---------------------------------------------------------------------------
// Settings events
// ---------------------------------------------------------------------------

function bindSettingsEvents() {
  if (ui.themeSelector) {
    ui.themeSelector.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-theme]");
      if (!btn) return;
      setTheme(btn.dataset.theme);
      renderSettingsPreferences();
    });
  }
  if (ui.defaultModeSelect) ui.defaultModeSelect.addEventListener("change", () => saveDefaultMode(ui.defaultModeSelect.value));
  if (ui.defaultNotesModeSelect) ui.defaultNotesModeSelect.addEventListener("change", () => saveDefaultNotesMode(ui.defaultNotesModeSelect.value));
  if (ui.defaultHinglishToggle) ui.defaultHinglishToggle.addEventListener("change", () => saveHinglishDefault(ui.defaultHinglishToggle.checked));
  if (ui.resetSettingsBtn) ui.resetSettingsBtn.addEventListener("click", () => resetPreferences());
  if (ui.clearHistoryBtn) ui.clearHistoryBtn.addEventListener("click", async () => await clearCurrentUserChats());
}

// ---------------------------------------------------------------------------
// Logout / profile
// ---------------------------------------------------------------------------

async function handleLogout() {
  if (state.isGuestMode) {
    window.location.replace("login.html");
    return;
  }
  try { cleanupChatSubscription(); await signOut(auth); queueFlashToast("Logged out successfully.", "success"); window.location.replace("login.html"); }
  catch (err) { console.error("Logout error:", err); showToast(err.message, "error"); }
}

function cleanupChatSubscription() {
  if (typeof state.chatsUnsubscribe === "function") { state.chatsUnsubscribe(); state.chatsUnsubscribe = null; }
  if (typeof window.messagesUnsubscribe === "function") { window.messagesUnsubscribe(); window.messagesUnsubscribe = null; }
}

function displayUserProfile(name, email, photo) {
  const avatarUrl = photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
  const shortName = getShortName(name);
  ui.userAvatar.src = avatarUrl; ui.userAvatar.alt = `${name} avatar`;
  ui.dropdownAvatar.src = avatarUrl; ui.dropdownAvatar.alt = `${name} avatar`;
  ui.userShortName.textContent = shortName;
  ui.dropdownUserName.innerText = name; ui.dropdownUserEmail.innerText = email;
}

function renderSettingsAccount(user) {
  ui.settingsUserName.textContent = user.displayName || "User";
  ui.settingsUserEmail.textContent = user.email || "No email found";
}

function openEditNameModal() {
  if (state.isGuestMode) {
    showToast("Please log in to edit your profile.", "info");
    return;
  }
  const currentName = auth.currentUser?.displayName || "User";
  ui.profileDropdown.classList.remove("show");
  ui.newNameInput.value = currentName; ui.editNameModal.classList.add("show");
  requestAnimationFrame(() => { ui.newNameInput.focus(); ui.newNameInput.select(); });
}

function closeEditNameModal() { ui.editNameModal.classList.remove("show"); }

async function saveDisplayName() {
  const newName = ui.newNameInput.value.trim();
  if (!newName) { showToast("Name cannot be empty.", "error"); return; }
  const user = auth.currentUser;
  if (!user) { showToast("No user is currently logged in.", "error"); return; }
  try {
    await updateProfile(user, { displayName: newName });
    await updateDoc(doc(db, "users", user.uid), { name: newName });
    displayUserProfile(newName, user.email || "No email found", user.photoURL || "");
    closeEditNameModal(); showToast("Name updated successfully.", "success");
  } catch (err) { console.error("Failed to update name:", err); showToast("Failed to update name.", "error"); }
}

// ---------------------------------------------------------------------------
// Chat CRUD
// ---------------------------------------------------------------------------

async function handleNewChat() {
  state.currentChatId = null;
  state.preferredChatId = null;
  state.editingChatId = null;
  state.renameDraft = "";
  state.editingMessageIndex = null;
  state.messageDraft = "";
  if (state.streamingResponse) stopStreamingResponse();

  const defaultMode = getSavedDefaultMode();
  const defaultHinglish = getSavedHinglishDefault();
  const defaultNotesMode = getSavedDefaultNotesMode();

  setSelectedMode(defaultMode);
  setSelectedNotesMode(defaultNotesMode);
  ui.hinglishToggle.checked = defaultHinglish;

  ui.chatTitle.textContent = "New Chat";
  ui.userInput.value = "";
  autoResizeTextarea(ui.userInput);

  renderHistory();
  renderMessages();

  ui.userInput.focus();
  closeSidebar();
}

async function createNewChatDocument() {
  const userId = getCurrentUserId();
  const defaultMode = getSavedDefaultMode();
  const defaultHinglish = getSavedHinglishDefault();
  const defaultNotesMode = getSavedDefaultNotesMode();

  const docRef = await addDoc(collection(db, "chats"), {
    userId: userId,
    title: "New Chat",
    mode: defaultMode,
    hinglish: defaultHinglish,
    notesMode: defaultNotesMode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const newChat = {
    id: docRef.id, userId: userId, title: "New Chat",
    mode: defaultMode, hinglish: defaultHinglish, notesMode: defaultNotesMode,
    messages: [], createdAt: null, updatedAt: null
  };

  state.chats = [newChat, ...state.chats.filter((c) => c.id !== docRef.id)];
  state.currentChatId = docRef.id;

  loadChats(docRef.id);
  loadMessages(docRef.id);

  return newChat;
}

function createGuestChatDocument() {
  const defaultMode = getSavedDefaultMode();
  const defaultHinglish = getSavedHinglishDefault();
  const defaultNotesMode = getSavedDefaultNotesMode();
  const guestChat = {
    id: `guest-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: "guest",
    title: "New Chat",
    mode: defaultMode,
    hinglish: defaultHinglish,
    notesMode: defaultNotesMode,
    messages: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };
  state.chats = [guestChat, ...state.chats.filter((c) => c.id !== guestChat.id)];
  state.currentChatId = guestChat.id;
  syncHeaderWithActiveChat();
  renderHistory();
  renderMessages();
  return guestChat;
}

function loadChats(preferredChatId = state.currentChatId) {
  try {
    const userId = getCurrentUserId();
    if (preferredChatId) state.preferredChatId = preferredChatId;
    if (state.chatsUnsubscribe) { syncHeaderWithActiveChat(); renderHistory(); renderMessages(); return; }

    const chatsQuery = query(collection(db, "chats"), where("userId", "==", userId));
    state.chatsUnsubscribe = onSnapshot(chatsQuery, (snapshot) => {
      const messagesMap = state.chats.reduce((acc, chat) => {
        acc[chat.id] = chat.messages || [];
        return acc;
      }, {});

      state.chats = snapshot.docs.map((d) => {
        const data = d.data({ serverTimestamps: "estimate" });
        return {
          id: d.id, userId: data.userId, title: data.title || "New Chat",
          mode: data.mode || "General", hinglish: Boolean(data.hinglish),
          notesMode: data.notesMode || "normal",
          messages: messagesMap[d.id] || [],
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || data.createdAt || null
        };
      }).sort((a, b) => getTimestampValue(b.updatedAt) - getTimestampValue(a.updatedAt));

      syncStateWithLatestChats(); syncHeaderWithActiveChat(); renderHistory();
      if (state.currentChatId && state.chats.some(c => c.id === state.currentChatId) && !window.messagesUnsubscribe) {
        loadMessages(state.currentChatId);
      }
      renderMessages();
    }, (error) => {
      console.error(error);
      if (error.code === "permission-denied") {
        showToast("Access denied");
      } else {
        showToast("Something went wrong");
      }
    });
  } catch (error) {
    console.error(error);
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  }
}

window.messagesUnsubscribe = null;

function loadMessages(chatId) {
  try {
    const userId = getCurrentUserId();
    if (window.messagesUnsubscribe) {
      window.messagesUnsubscribe();
      window.messagesUnsubscribe = null;
    }

    if (!chatId) return;

    const messagesQuery = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("createdAt", "asc")
    );

    window.messagesUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const activeChat = getChatById(chatId);
      if (!activeChat) return;

      activeChat.messages = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data({ serverTimestamps: "estimate" })
      }));

      activeChat.messages.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeA - timeB;
      });

      if (state.currentChatId === chatId) {
        renderMessages();
      }
    }, (error) => {
      console.error(error);
      if (error.code === "permission-denied") {
        showToast("Access denied");
      } else {
        showToast("Something went wrong");
      }
    });
  } catch (error) {
    console.error(error);
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  }
}

function renderHistory() {
  if (!state.chats.length) { ui.chatHistoryList.innerHTML = `<div class="history-empty">Start a new conversation &#128640;</div>`; return; }
  const ordered = [...state.chats].sort((a, b) => getTimestampValue(b.updatedAt) - getTimestampValue(a.updatedAt));
  ui.chatHistoryList.innerHTML = ordered.map((chat) => {
    const isActive = chat.id === state.currentChatId ? "active" : "";
    if (chat.id === state.editingChatId) {
      return `<article class="history-card ${isActive}"><div class="rename-form"><input class="rename-input" data-chat-id="${chat.id}" type="text" maxlength="50" value="${escapeAttribute(state.renameDraft)}" placeholder="Rename chat" /><div class="rename-actions"><button class="rename-btn" data-save-rename="${chat.id}" type="button">Save</button><button class="rename-btn" data-cancel-rename type="button">Cancel</button></div></div></article>`;
    }
    return `<article class="history-card ${isActive}"><button class="history-open" data-open-chat="${chat.id}" type="button"><span class="history-title">${escapeHtml(chat.title)}</span><span class="history-meta">${escapeHtml(chat.mode || "General")}${chat.hinglish ? " | Hinglish" : ""}</span><span class="history-meta">${formatSidebarDate(chat.updatedAt)}</span></button><div class="history-actions"><button class="history-action" data-rename-chat="${chat.id}" type="button">Rename</button><button class="history-action danger" data-delete-chat="${chat.id}" type="button">Delete</button></div></article>`;
  }).join("");
  focusRenameInput();
}

function syncStateWithLatestChats() {
  if (state.preferredChatId && state.chats.some((c) => c.id === state.preferredChatId)) state.currentChatId = state.preferredChatId;
  else if (state.currentChatId && state.chats.some((c) => c.id === state.currentChatId)) { /* keep */ }
  else state.currentChatId = null;
  state.preferredChatId = null;
  if (!state.chats.some((c) => c.id === state.editingChatId)) { state.editingChatId = null; state.renameDraft = ""; }
  const activeChat = getCurrentChat();
  if (!activeChat || state.editingMessageIndex == null) { state.editingMessageIndex = null; state.messageDraft = ""; }
  else if (!activeChat.messages[state.editingMessageIndex] || activeChat.messages[state.editingMessageIndex].role !== "user") { state.editingMessageIndex = null; state.messageDraft = ""; }
  if (state.streamingResponse && state.streamingResponse.chatId !== activeChat?.id) stopStreamingResponse();
}

// ---------------------------------------------------------------------------
// Messages rendering
// ---------------------------------------------------------------------------

function renderMessages() {
  const activeChat = getCurrentChat();
  const showTyping = Boolean(state.showTypingIndicator);

  if (!activeChat || (activeChat.messages.length === 0 && !showTyping && !(state.streamingResponse && state.streamingResponse.chatId === activeChat.id))) {
    ui.chatTitle.textContent = activeChat?.title || "New Chat";
    ui.chatMessages.innerHTML = `<div class="empty-state"><h3>Start a new conversation &#128640;</h3><p>Create a chat from the sidebar and ask your first question.</p></div>`;
    return;
  }
  ui.chatTitle.textContent = activeChat?.title || "New Chat";

  const messageMarkup = activeChat.messages.map((message, index) => {
    const roleLabel = message.role === "user" ? "You" : "StudyMate AI";
    const contentMarkup = `<div class="message-content" data-message-content="${index}">${formatMessage(message.content, message.role)}</div>`;
    const actionMarkup = renderMessageActions(activeChat.messages, message, index);
    return `<div class="message-row ${message.role}"><div class="message-bubble"><div class="message-meta"><strong>${roleLabel}</strong></div>${contentMarkup}${actionMarkup}</div></div>`;
  }).join("");

  const streamingMarkup = (state.streamingResponse && state.streamingResponse.chatId === activeChat.id)
    ? `<div class="message-row ai"><div class="message-bubble"><div class="message-meta"><strong>StudyMate AI</strong></div><div class="message-content" data-stream-content>${formatMessage(state.streamingResponse.visibleText, "ai")}</div></div></div>`
    : "";

  const typingMarkup = showTyping ? `<div class="message-row ai"><div class="message-bubble"><div class="message-meta"><strong>StudyMate AI</strong></div><div class="message-content loading-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div></div>` : "";

  ui.chatMessages.innerHTML = `${messageMarkup}${streamingMarkup}${typingMarkup}`;
  focusMessageEditor();
  scrollMessagesToBottom();
}

function openChat(chatId) {
  if (state.streamingResponse && state.streamingResponse.chatId !== chatId) stopStreamingResponse();
  state.currentChatId = chatId; state.editingChatId = null; state.renameDraft = "";
  state.editingMessageIndex = null; state.messageDraft = "";
  if (!state.isGuestMode) loadMessages(chatId);
  syncHeaderWithActiveChat(); renderHistory(); renderMessages(); closeSidebar();
}

// ---------------------------------------------------------------------------
// Send message → backend proxy
// ---------------------------------------------------------------------------

async function handleSendMessage() {
  try {
    if (state.isSending) return;
    const content = ui.userInput.value.trim();
    if (!content) return;
    if (state.isGuestMode && isGuestUsageLimitReached()) {
      showGuestLimitModal();
      showToast("Guest question limit reached. Please log in to continue.", "info");
      return;
    }

    if (!state.currentChatId) {
      if (state.isGuestMode) createGuestChatDocument();
      else await createNewChatDocument();
    }
    const activeChat = getCurrentChat();
    if (!activeChat) { showToast("Unable to open a chat session.", "error"); return; }

    ui.userInput.value = ""; autoResizeTextarea(ui.userInput);

    if (state.isGuestMode) {
      incrementGuestQuestionUsage();
      activeChat.messages.push(createGuestMessage("user", content));
      activeChat.updatedAt = Timestamp.now();
      renderHistory();
      renderMessages();
    } else {
      await addDoc(collection(db, "chats", activeChat.id, "messages"), {
        role: "user",
        content: content,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, "chats", activeChat.id), { updatedAt: serverTimestamp() });
    }

    await generateAssistantReply({ chat: activeChat, userContent: content, titleSource: content });
  } catch (error) {
    console.error(error);
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  }
}

async function fetchWithRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) return fetchWithRetry(fn, retries - 1);
    throw err;
  }
}

async function fetchAIResponse(messages, mode, hinglishEnabled, notesMode) {
  const requestPayload = {
    messages,
    mode,
    hinglish: hinglishEnabled,
    notesMode: notesMode || "normal",
    userId: state.currentUser?.uid || "guest"
  };

  try {
    return await fetchWithRetry(async () => {
      const controller = new AbortController();
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(new Error("AI request timed out."));
        }, 18000);
      });

      try {
        const response = await Promise.race([
          fetch(`${API_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify(requestPayload)
          }),
          timeoutPromise
        ]);

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "AI service is currently unavailable.");
        }
        return data.reply || "No response received.";
      } finally {
        window.clearTimeout(timeoutId);
      }
    }, 2);
  } catch (err) {
    console.error("Backend request failed:", err);
    if (err?.name === "AbortError" || /timed out/i.test(err?.message || "")) {
      return "AI response timed out after multiple retries. Please try again.";
    }
    return err?.message || "AI service is currently unavailable.";
  }
}

async function saveActiveChatSettings() {
  const activeChat = getCurrentChat();
  if (!activeChat) return;
  activeChat.mode = getSelectedMode();
  activeChat.hinglish = ui.hinglishToggle.checked;
  activeChat.notesMode = getSelectedNotesMode();
  activeChat.updatedAt = Timestamp.now();
  renderHistory();
  if (state.isGuestMode) return;
  try { await updateDoc(doc(db, "chats", activeChat.id), { mode: activeChat.mode, hinglish: activeChat.hinglish, notesMode: activeChat.notesMode, updatedAt: serverTimestamp() }); }
  catch (err) { console.error("Save mode error:", err); showToast(err.message, "error"); }
}

async function generateAssistantReply({ chat, apiMessages = null, userContent = null, titleSource = "", successMessage = "" }) {
  if (!chat || state.isSending) return;
  state.isSending = true; state.showTypingIndicator = true;
  state.editingMessageIndex = null; state.messageDraft = "";
  setComposerLoading(true);

  chat.mode = getSelectedMode();
  chat.hinglish = ui.hinglishToggle.checked;
  chat.notesMode = getSelectedNotesMode();
  renderHistory(); renderMessages();
  scrollMessagesToBottom(); // Centralized scroll after updating state

  let finalApiMessages = apiMessages || [...chat.messages].slice(-6);
  if (userContent && !finalApiMessages.some(m => m.content === userContent && m.role === "user")) {
    finalApiMessages.push({ role: "user", content: userContent });
  }

  try {
    const aiContent = await fetchAIResponse(finalApiMessages, chat.mode, chat.hinglish, chat.notesMode);

    state.showTypingIndicator = false;
    await streamAssistantMessage(chat.id, aiContent);

    if (state.isGuestMode) {
      chat.messages.push(createGuestMessage("ai", aiContent));
      chat.updatedAt = Timestamp.now();
      if (chat.title === "New Chat" && titleSource && finalApiMessages.filter((m) => m.role === "ai").length === 0) {
        chat.title = generateChatTitle(titleSource);
      }
    } else {
      await addDoc(collection(db, "chats", chat.id, "messages"), {
        role: "ai",
        content: aiContent,
        createdAt: serverTimestamp()
      });

      if (chat.title === "New Chat" && titleSource && finalApiMessages.filter((m) => m.role === "ai").length === 0) {
        const newTitle = generateChatTitle(titleSource);
        await updateDoc(doc(db, "chats", chat.id), { title: newTitle, updatedAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "chats", chat.id), { updatedAt: serverTimestamp() });
      }
    }

    if (!state.isGuestMode) await incrementStudyTracker();
    if (successMessage) showToast(successMessage, "success");

  } catch (error) {
    console.error(error);
    state.showTypingIndicator = false;
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  } finally {
    state.isSending = false;
    setComposerLoading(false);
    renderHistory();
    renderMessages();
  }
}

// ---------------------------------------------------------------------------
// Message editing / actions
// ---------------------------------------------------------------------------

// Edit functions removed to enforce strict append-only rules.

async function regenerateAiMessage(messageIndex) {
  try {
    if (state.isGuestMode && isGuestUsageLimitReached()) {
      showGuestLimitModal();
      showToast("Guest question limit reached. Please log in to continue.", "info");
      return;
    }

    const activeChat = getCurrentChat();
    if (!activeChat || state.isSending || !isLatestAiMessage(activeChat.messages, messageIndex)) return;
    const previousUserIndex = findPreviousUserMessageIndex(activeChat.messages, messageIndex);
    if (previousUserIndex === -1) { showToast("No user message found to regenerate from.", "error"); return; }

    const baseMessages = activeChat.messages.slice(0, messageIndex);
    if (state.isGuestMode) incrementGuestQuestionUsage();

    await generateAssistantReply({ chat: activeChat, apiMessages: baseMessages, successMessage: "Response regenerated." });
  } catch (error) {
    console.error(error);
    if (error.code === "permission-denied") {
      showToast("Access denied");
    } else {
      showToast("Something went wrong");
    }
  }
}

async function copyMessageContent(messageIndex) {
  const activeChat = getCurrentChat();
  const targetMessage = activeChat?.messages?.[messageIndex];
  if (!targetMessage) return;
  try { await navigator.clipboard.writeText(targetMessage.content); showToast("Copied!", "success"); }
  catch (err) { console.error("Copy message error:", err); showToast("Unable to copy right now.", "error"); }
}

async function streamAssistantMessage(chatId, text) {
  stopStreamingResponse();
  state.streamingResponse = { chatId, visibleText: "", intervalId: null };
  renderMessages();
  await new Promise((resolve) => {
    let cursor = 0;
    const intervalId = window.setInterval(() => {
      if (!state.streamingResponse || state.streamingResponse.chatId !== chatId) { window.clearInterval(intervalId); resolve(); return; }
      cursor += 1; state.streamingResponse.visibleText = text.slice(0, cursor);
      const contentNode = ui.chatMessages.querySelector(`[data-stream-content]`);
      if (contentNode) contentNode.innerHTML = formatMessage(state.streamingResponse.visibleText, "ai");
      scrollMessagesToBottom();
      if (cursor >= text.length) { stopStreamingResponse(); renderMessages(); resolve(); }
    }, 15);
    state.streamingResponse.intervalId = intervalId;
  });
}

function stopStreamingResponse() { if (state.streamingResponse?.intervalId) window.clearInterval(state.streamingResponse.intervalId); state.streamingResponse = null; }

function renderMessageActions(messages, message, messageIndex) {
  if (message.role === "user") return "";
  const regenerateButton = isLatestAiMessage(messages, messageIndex) ? `<button class="message-action-btn" data-regenerate-message="${messageIndex}" type="button" aria-label="Regenerate response" title="Regenerate">${getMessageActionIcon("regenerate")}<span class="sr-only">Regenerate</span></button>` : "";
  return `<div class="message-actions"><button class="message-action-btn" data-copy-message="${messageIndex}" type="button" aria-label="Copy response" title="Copy">${getMessageActionIcon("copy")}<span class="sr-only">Copy</span></button>${regenerateButton}</div>`;
}

function isLatestAiMessage(messages, messageIndex) { for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "ai") return i === messageIndex; } return false; }
function findPreviousUserMessageIndex(messages, messageIndex) { for (let i = messageIndex - 1; i >= 0; i--) { if (messages[i].role === "user") return i; } return -1; }
function findFirstUserMessageIndex(messages) { return messages.findIndex((m) => m.role === "user"); }

function getMessageActionIcon(type) {
  if (type === "edit") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1 9-9-3.5-3.5-9 9L4 20zM13.5 5.5l3.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>`;
  if (type === "copy") return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.5M20 4v7h-7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>`;
}

// ---------------------------------------------------------------------------
// Chat rename / delete
// ---------------------------------------------------------------------------

function startRename(chatId) { const chat = getChatById(chatId); if (!chat) return; state.editingChatId = chatId; state.renameDraft = chat.title; renderHistory(); }
function cancelRename() { state.editingChatId = null; state.renameDraft = ""; renderHistory(); }

async function saveRename(chatId) {
  const nextTitle = state.renameDraft.trim();
  if (!nextTitle) { showToast("Chat title cannot be empty.", "error"); return; }
  const chat = getChatById(chatId); if (!chat) return;
  chat.title = nextTitle; chat.updatedAt = Timestamp.now();
  if (state.isGuestMode) {
    state.editingChatId = null;
    state.renameDraft = "";
    renderHistory();
    renderMessages();
    return;
  }
  try { await updateDoc(doc(db, "chats", chatId), { title: chat.title, updatedAt: chat.updatedAt }); state.editingChatId = null; state.renameDraft = ""; renderHistory(); renderMessages(); }
  catch (err) { console.error("Rename error:", err); showToast(err.message, "error"); }
}

async function deleteChat(chatId) {
  const chat = getChatById(chatId); if (!chat) return;
  const confirmed = await showConfirm({ label: "Delete Chat", title: `Delete "${chat.title}"?`, message: "This chat will be removed permanently from your history.", confirmText: "Delete", type: "danger" });
  if (!confirmed) return;
  if (state.isGuestMode) {
    state.chats = state.chats.filter((c) => c.id !== chatId);
    if (state.currentChatId === chatId) state.currentChatId = state.chats[0]?.id || null;
    state.editingChatId = null;
    state.renameDraft = "";
    syncHeaderWithActiveChat();
    renderHistory();
    renderMessages();
    showToast("Chat deleted.", "success");
    return;
  }
  try { await deleteDoc(doc(db, "chats", chatId)); if (state.currentChatId === chatId) state.currentChatId = null; state.editingChatId = null; state.renameDraft = ""; showToast("Chat deleted.", "success"); }
  catch (err) { console.error("Delete chat error:", err); showToast(err.message, "error"); }
}

// ---------------------------------------------------------------------------
// Header sync / composer
// ---------------------------------------------------------------------------

function syncHeaderWithActiveChat() {
  const activeChat = getCurrentChat();
  if (!activeChat) { ui.chatTitle.textContent = "New Chat"; setSelectedMode(getSavedDefaultMode()); setSelectedNotesMode(getSavedDefaultNotesMode()); ui.hinglishToggle.checked = getSavedHinglishDefault(); return; }
  ui.chatTitle.textContent = activeChat.title || "New Chat";
  setSelectedMode(activeChat.mode || "General");
  setSelectedNotesMode(activeChat.notesMode || "normal");
  ui.hinglishToggle.checked = Boolean(activeChat.hinglish);
}

function setComposerLoading(isLoading) {
  ui.sendBtn.disabled = isLoading;
  ui.userInput.disabled = isLoading;
}
function getCurrentChat() { return state.chats.find((c) => c.id === state.currentChatId) || null; }
function getChatById(chatId) { return state.chats.find((c) => c.id === chatId) || null; }

function generateChatTitle(message) {
  const cleaned = message.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);
  const slice = words.slice(0, 5);
  if (slice.length === 0) return "New Chat";
  if (slice.length < 3) return words.slice(0, Math.min(3, words.length)).join(" ");
  return slice.join(" ");
}

function getShortName(name) { const t = String(name || "User").trim(); return t ? t.split(/\s+/)[0] : "User"; }

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const body = document.body;

  if (sidebar) sidebar.classList.toggle("open");
  if (overlay) overlay.classList.toggle("active");
  if (body) body.classList.toggle("sidebar-open");
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const body = document.body;

  if (sidebar) sidebar.classList.remove("open");
  if (overlay) overlay.classList.remove("active");
  if (body) body.classList.remove("sidebar-open");
}

function focusRenameInput() {
  if (!state.editingChatId) return;
  const renameInput = ui.chatHistoryList.querySelector(".rename-input");
  if (!renameInput) return;
  requestAnimationFrame(() => { renameInput.focus(); renameInput.select(); });
}

function focusMessageEditor() {
  if (state.editingMessageIndex == null) return;
  const messageEditor = ui.chatMessages.querySelector("[data-message-edit-input]");
  if (!messageEditor) return;
  requestAnimationFrame(() => { autoResizeTextarea(messageEditor); messageEditor.focus(); messageEditor.setSelectionRange(messageEditor.value.length, messageEditor.value.length); });
}

function scrollMessagesToBottom() {
  const el = document.querySelector(".chat-container");
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}
function autoResizeTextarea(textarea) { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; }

// ---------------------------------------------------------------------------
// Mode dropdown
// ---------------------------------------------------------------------------

function bindModeDropdown() {
  ui.selectedMode.addEventListener("click", (e) => { e.stopPropagation(); ui.profileDropdown.classList.remove("show"); closeNotesDropdown(); ui.modeDropdown.classList.toggle("open"); ui.selectedMode.setAttribute("aria-expanded", String(ui.modeDropdown.classList.contains("open"))); });
  ui.dropdownOptions.addEventListener("click", async (e) => { const option = e.target.closest(".option"); if (!option) return; setSelectedMode(option.dataset.value || option.textContent.trim()); closeModeDropdown(); await saveActiveChatSettings(); });
}

function setSelectedMode(mode) {
  const normalizedMode = normalizeMode(mode);
  ui.selectedMode.textContent = normalizedMode; ui.selectedMode.dataset.value = normalizedMode;
  ui.dropdownOptions.querySelectorAll(".option").forEach((o) => o.classList.toggle("active", o.dataset.value === normalizedMode));
}

function getSelectedMode() { return normalizeMode(ui.selectedMode.dataset.value || ui.selectedMode.textContent); }
function closeModeDropdown() { ui.modeDropdown.classList.remove("open"); ui.selectedMode.setAttribute("aria-expanded", "false"); }

// ---------------------------------------------------------------------------
// Notes mode dropdown
// ---------------------------------------------------------------------------

function bindNotesDropdown() {
  ui.notesSelected.addEventListener("click", (e) => { e.stopPropagation(); ui.profileDropdown.classList.remove("show"); closeModeDropdown(); ui.notesDropdown.classList.toggle("open"); ui.notesSelected.setAttribute("aria-expanded", String(ui.notesDropdown.classList.contains("open"))); });
  ui.notesDropdownOptions.addEventListener("click", async (e) => { const option = e.target.closest(".option"); if (!option) return; setSelectedNotesMode(option.dataset.value || "normal"); closeNotesDropdown(); await saveActiveChatSettings(); });
}

function setSelectedNotesMode(mode) {
  const normalized = normalizeNotesMode(mode);
  const labels = { normal: "Normal", bullet: "Bullet Notes", revision: "Revision Notes", flashcards: "Flashcards" };
  ui.notesSelected.textContent = labels[normalized] || "Normal"; ui.notesSelected.dataset.value = normalized;
  ui.notesDropdownOptions.querySelectorAll(".option").forEach((o) => o.classList.toggle("active", o.dataset.value === normalized));
}

function getSelectedNotesMode() { return normalizeNotesMode(ui.notesSelected.dataset.value || "normal"); }
function closeNotesDropdown() { ui.notesDropdown.classList.remove("open"); ui.notesSelected.setAttribute("aria-expanded", "false"); }

// ---------------------------------------------------------------------------
// Navigation / settings
// ---------------------------------------------------------------------------

function goToSettings() { window.location.href = "settings.html"; }

// ---------------------------------------------------------------------------
// Theme system (4 themes)
// ---------------------------------------------------------------------------

function applySavedTheme() {
  const savedTheme = getSavedTheme();
  document.body.classList.remove("light", "blue", "purple");
  if (savedTheme !== "dark") document.body.classList.add(savedTheme);
}

function setTheme(theme) {
  const normalized = AVAILABLE_THEMES.includes(theme) ? theme : "dark";
  document.body.classList.remove("light", "blue", "purple");
  if (normalized !== "dark") document.body.classList.add(normalized);
  localStorage.setItem(STORAGE_KEYS.theme, normalized);
}

function getSavedTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  return AVAILABLE_THEMES.includes(saved) ? saved : "dark";
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function saveDefaultMode(mode) { localStorage.setItem(STORAGE_KEYS.defaultMode, normalizeMode(mode)); }
function getSavedDefaultMode() { return normalizeMode(localStorage.getItem(STORAGE_KEYS.defaultMode)); }
function saveHinglishDefault(isEnabled) { localStorage.setItem(STORAGE_KEYS.hinglishDefault, String(Boolean(isEnabled))); }
function getSavedHinglishDefault() { return localStorage.getItem(STORAGE_KEYS.hinglishDefault) === "true"; }
function saveDefaultNotesMode(mode) { localStorage.setItem(STORAGE_KEYS.defaultNotesMode, normalizeNotesMode(mode)); }
function getSavedDefaultNotesMode() { return normalizeNotesMode(localStorage.getItem(STORAGE_KEYS.defaultNotesMode)); }
function normalizeMode(mode) { return AVAILABLE_MODES.includes(mode) ? mode : "General"; }
function normalizeNotesMode(mode) { return AVAILABLE_NOTES_MODES.includes(mode) ? mode : "normal"; }

function renderSettingsPreferences() {
  if (!ui) return;
  // Theme selector buttons
  if (ui.themeSelector) {
    const currentTheme = getSavedTheme();
    ui.themeSelector.querySelectorAll("[data-theme]").forEach((btn) => btn.classList.toggle("active", btn.dataset.theme === currentTheme));
  }
  if (ui.defaultModeSelect) ui.defaultModeSelect.value = getSavedDefaultMode();
  if (ui.defaultNotesModeSelect) ui.defaultNotesModeSelect.value = getSavedDefaultNotesMode();
  if (ui.defaultHinglishToggle) ui.defaultHinglishToggle.checked = getSavedHinglishDefault();
}

function resetPreferences() { setTheme("dark"); saveDefaultMode("General"); saveDefaultNotesMode("normal"); saveHinglishDefault(false); renderSettingsPreferences(); showToast("Settings have been reset.", "success"); }

async function clearCurrentUserChats() {
  if (!state.currentUser) { showToast("Please log in again to manage your chats.", "error"); return; }
  const confirmed = await showConfirm({ label: "Clear History", title: "Clear all chat history?", message: "This will permanently remove every saved chat for your account.", confirmText: "Clear History", type: "danger" });
  if (!confirmed) return;
  try {
    const chatsQuery = query(collection(db, "chats"), where("userId", "==", state.currentUser.uid));
    const snapshot = await getDocs(chatsQuery);
    await Promise.all(snapshot.docs.map((d) => deleteDoc(doc(db, "chats", d.id))));
    showToast("Chat history cleared.", "success");
  } catch (err) { console.error("Clear chat history error:", err); showToast(err.message, "error"); }
}

// ---------------------------------------------------------------------------
// Feedback UI (toasts + confirm modal)
// ---------------------------------------------------------------------------

function initializeFeedbackUi() {
  if (feedbackUi.initialized) return;
  feedbackUi.toastContainer = document.getElementById("toastContainer");
  feedbackUi.confirmModal = document.getElementById("confirmModal");
  feedbackUi.confirmLabel = document.getElementById("confirmModalLabel");
  feedbackUi.confirmTitle = document.getElementById("confirmModalTitle");
  feedbackUi.confirmMessage = document.getElementById("confirmModalMessage");
  feedbackUi.confirmCancelBtn = document.getElementById("confirmCancelBtn");
  feedbackUi.confirmOkBtn = document.getElementById("confirmOkBtn");
  if (feedbackUi.confirmCancelBtn) feedbackUi.confirmCancelBtn.addEventListener("click", () => closeConfirmModal(false));
  if (feedbackUi.confirmOkBtn) feedbackUi.confirmOkBtn.addEventListener("click", () => closeConfirmModal(true));
  if (feedbackUi.confirmModal) feedbackUi.confirmModal.addEventListener("click", (e) => { if (e.target === feedbackUi.confirmModal) closeConfirmModal(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && feedbackUi.confirmModal?.classList.contains("show")) closeConfirmModal(false); });
  feedbackUi.initialized = true;
}

function showToast(message, type = "info") {
  if (!message || !feedbackUi.toastContainer) return;
  const toast = document.createElement("div"); toast.className = `toast ${type}`; toast.textContent = message;
  feedbackUi.toastContainer.appendChild(toast);
  window.setTimeout(() => { toast.classList.add("leaving"); window.setTimeout(() => toast.remove(), 220); }, 3000);
}

function queueFlashToast(message, type = "info") { sessionStorage.setItem(FLASH_TOAST_KEY, JSON.stringify({ message, type })); }

function consumeFlashToast() {
  const raw = sessionStorage.getItem(FLASH_TOAST_KEY); if (!raw) return;
  sessionStorage.removeItem(FLASH_TOAST_KEY);
  try { const d = JSON.parse(raw); showToast(d.message, d.type); } catch (err) { console.error("Toast parse error:", err); }
}

function showConfirm({ label = "Please Confirm", title = "Are you sure?", message = "This action cannot be undone.", confirmText = "Confirm", cancelText = "Cancel", type = "info" } = {}) {
  if (!feedbackUi.confirmModal) return Promise.resolve(false);
  feedbackUi.confirmLabel.textContent = label; feedbackUi.confirmTitle.textContent = title;
  feedbackUi.confirmMessage.textContent = message; feedbackUi.confirmCancelBtn.textContent = cancelText;
  feedbackUi.confirmOkBtn.textContent = confirmText;
  feedbackUi.confirmOkBtn.classList.toggle("danger-btn", type === "danger");
  feedbackUi.confirmModal.classList.add("show"); feedbackUi.confirmModal.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => { feedbackUi.confirmResolver = resolve; });
}

function closeConfirmModal(result) {
  if (!feedbackUi.confirmModal) return;
  feedbackUi.confirmModal.classList.remove("show"); feedbackUi.confirmModal.setAttribute("aria-hidden", "true");
  feedbackUi.confirmOkBtn.classList.remove("danger-btn");
  if (feedbackUi.confirmResolver) { const resolve = feedbackUi.confirmResolver; feedbackUi.confirmResolver = null; resolve(result); }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setFormMessage(element, message, type) { element.textContent = message; element.className = `form-message ${type}`; }
function formatMessage(content, role = "ai") {
  const text = String(content ?? "");
  if (role !== "ai") return escapeHtml(text).replace(/\n/g, "<br>");
  try {
    const parsed = marked.parse(text);
    return sanitizeRenderedHtml(String(parsed));
  } catch (err) {
    console.error("Markdown render error:", err);
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
}
function formatSidebarDate(timestamp) { const date = timestamp?.toDate ? timestamp.toDate() : new Date(); return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function getTimestampValue(timestamp) { return timestamp?.toMillis ? timestamp.toMillis() : 0; }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value ?? ""; return div.innerHTML; }
function escapeAttribute(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function sanitizeRenderedHtml(rawHtml) {
  const template = document.createElement("template");
  template.innerHTML = rawHtml;
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) el.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}
