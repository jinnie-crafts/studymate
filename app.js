import { auth, db } from "./firebase.js";
import { validateEmail, isDisposableEmailSync } from "./disposableEmailValidator.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  sendEmailVerification,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
  getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initNotifications, stopNotifications } from "./notificationBell.js";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/+esm";

// ---------------------------------------------------------------------------
// Network Layer Hardening (Safe Fetch Wrapper)
// ---------------------------------------------------------------------------

const DEBUG_FETCH = false;
const originalFetch = window.fetch;

window.fetch = async function (...args) {
  try {
    // 1. Safely extract URL (Handle string, Request object, and nulls)
    let url = "";
    if (typeof args[0] === "string") {
      url = args[0];
    } else if (args[0] instanceof Request) {
      url = args[0].url;
    } else {
      url = (args[0] && typeof args[0] === "object" && "url" in args[0]) ? args[0].url : String(args[0] || "");
    }

    // 2. Safe debugging
    if (DEBUG_FETCH && url.includes("/api/chat")) {
      console.log("[FETCH DEBUG] Intercepting AI request:", url);
    }

    // 3. Scoped Agent Logic (Strictly /api/chat only)
    if (url.includes("/api/chat")) {
      // Future agent logic goes here (Read-only for now)
      // Do NOT mutate headers or body at this stage
    }

    // 4. Transparent pass-through
    return await originalFetch(...args);
  } catch (err) {
    // 5. Fail-soft: Never block the request if the wrapper crashed
    console.error("[FETCH WRAPPER ERROR]", err);
    try {
      return await originalFetch(...args);
    } catch (criticalErr) {
      throw criticalErr; // Re-throw the actual network error if original fetch fails
    }
  }
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE_URL = window.location.hostname === "localhost"
  ? "http://localhost:3001"
  : "https://api.aadirishi.in";

const page = document.body.dataset.page;
const FLASH_TOAST_KEY = "studymate_flash_toast";
const WELCOME_SEEN_KEY = "hasSeenWelcome";
const GUEST_QUESTION_LIMIT = 5;
const GUEST_USAGE_KEY = "studymate_guest_question_count";
const STORAGE_KEYS = { theme: "theme", defaultMode: "defaultMode", hinglishDefault: "hinglishDefault", defaultNotesMode: "defaultNotesMode" };
const MODES = ["general", "exam", "coding"];
const MODE_LABELS = {
  general: "🧠 General",
  exam: "📚 Exam Mode",
  coding: "💻 Coding Mode"
};
const AVAILABLE_MODES = MODES;
const AVAILABLE_NOTES_MODES = ["normal", "bullet", "revision", "flashcards"];
const AVAILABLE_THEMES = ["dark", "light", "blue", "purple"];
const REALTIME_QUERY_REGEX = /(today|now|latest|news|current|recent|weather|price|score|stock|time)/i;
const STREAM_WORD_DELAY_MS = 20;

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
  guestQuestionsUsed: 0,
  currentQuestion: null,
  userSettings: { 
    aiModel: "auto", 
    aiStyle: "detailed", 
    aiTone: "professional", 
    autoQuestion: true, 
    fontSize: 16 
  }
};

let ui = null;
let isHandlingOnboardingStart = false;
let hasInitializedWelcomeBindings = false;
let hasEvaluatedOnboardingForUser = false;
let lastOnboardingEvalUid = null;
let dashboardInitStartedForUid = null;
const feedbackUi = {
  initialized: false, toastContainer: null, confirmModal: null,
  confirmLabel: null, confirmTitle: null, confirmMessage: null,
  confirmCancelBtn: null, confirmOkBtn: null, confirmResolver: null
};

const markdownRenderer = new marked.Renderer();

markdownRenderer.code = (code, language) => {
  const rawCode = typeof code === "string" ? code : String(code?.text || "");
  const rawLanguage = typeof language === "string"
    ? language
    : String(code?.lang || "");
  const lang = rawLanguage.trim().split(/\s+/)[0].toLowerCase();

  // Handle Mermaid diagrams
  if (lang === "mermaid") {
    return `<div class="mermaid-container"><div class="mermaid">${escapeHtml(rawCode)}</div></div>`;
  }

  const hasLang = lang && hljs.getLanguage(lang);
  const highlighted = hasLang
    ? hljs.highlight(rawCode, { language: lang }).value
    : hljs.highlightAuto(rawCode).value;
  const label = escapeHtml(lang || "code");
  const langClass = lang ? ` language-${escapeAttribute(lang)}` : "";

  return `<div class="code-block"><div class="code-header"><span>${label}</span><button class="copy-btn" type="button" data-copy-code>Copy</button></div><pre><code class="hljs${langClass}">${highlighted}</code></pre></div>`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer: markdownRenderer
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUserId() {
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated");
  return user.uid;
}

// ---------------------------------------------------------------------------
// Auth pages
// ---------------------------------------------------------------------------

function initLoginPage() {
  const loginForm = document.getElementById("loginForm");
  const authMessage = document.getElementById("authMessage");
  const googleLoginBtn = document.getElementById("googleLoginBtn");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

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

async function validateSignupEmail(email) {
  // Uses the robust disposableEmailValidator.js utility
  // Performs local check (3000+ domains + suffix matching) + remote API fallback
  // Throws with user-friendly message if disposable
  await validateEmail(email);
}

function initSignupPage() {
  const signupForm = document.getElementById("signupForm");
  const authMessage = document.getElementById("authMessage");
  const googleLoginBtn = document.getElementById("googleLoginBtn");

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

    try {
      await validateSignupEmail(email);
    } catch (validationError) {
      const validationMessage = validationError?.message || "Signup failed";
      setFormMessage(authMessage, validationMessage, "error");
      showToast(validationMessage, "error");
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
        hasSeenWelcome: false,
        createdAt: serverTimestamp()
      });
      state.userOnboardingDone = false;
      // Fire-and-forget welcome notification for new users
      sendWelcomeNotification(user.uid);
    } else {
      const data = snap.data();
      const hasSeenWelcome = Boolean(data.hasSeenWelcome ?? data.onboardingDone ?? false);
      state.userOnboardingDone = hasSeenWelcome;
      const profilePatch = {
        name: user.displayName || data.name || "User",
        email: user.email || data.email || "",
        photoURL: user.photoURL || snap.data().photoURL || ""
      };
      if (data.hasSeenWelcome === undefined) {
        profilePatch.hasSeenWelcome = hasSeenWelcome;
      }
      await updateDoc(userRef, {
        ...profilePatch
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

  hideOnboardingOverlay();
  bindDashboardEvents();
  
  if (state.isGuestMode) {
    initializeGuestDashboard();
  }
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

function createGuestMessage(role, content, sources = []) {
  return {
    id: `guest-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    sources: normalizeSources(sources),
    createdAt: Timestamp.now()
  };
}

function showOnboardingOverlay() {
  const overlay = document.querySelector(".welcome-modal") || document.getElementById("onboarding");
  const startBtn = document.getElementById("getStartedBtn") || document.getElementById("startBtn");
  if (!overlay || !startBtn) return;

  const uid = state.currentUser?.uid || "";
  if (getLocalWelcomeSeen(uid) === "true") {
    hideOnboardingOverlay();
    state.userOnboardingDone = true;
    return;
  }

  overlay.classList.remove("hidden");
  overlay.classList.add("open");
  overlay.style.display = "flex";
  overlay.style.pointerEvents = "auto";
  overlay.setAttribute("aria-hidden", "false");
  startBtn.disabled = false;
  startBtn.textContent = "Get Started";

  // Highlight New Chat briefly
  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) {
    newChatBtn.style.boxShadow = "0 0 20px #3b82f6";
    setTimeout(() => { if (newChatBtn) newChatBtn.style.boxShadow = ""; }, 3000);
  }

  bindOnboardingStartButton();
}

function hideOnboardingOverlay() {
  const overlay = document.querySelector(".welcome-modal") || document.getElementById("onboarding");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.classList.remove("open");
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.pointerEvents = "none";
  document.body.style.pointerEvents = "";
}

function initWelcomeModalBindings() {
  if (hasInitializedWelcomeBindings) return;
  hasInitializedWelcomeBindings = true;

  if (shouldSkipOnboardingModal()) return;

  const overlay = document.querySelector(".welcome-modal") || document.getElementById("onboarding");
  const startBtn = document.getElementById("getStartedBtn");
  if (!overlay || !startBtn) return;

  bindOnboardingStartButton();
  const hasSeen = getLocalWelcomeSeen(state.currentUser?.uid || "");
  console.log("hasSeenWelcome:", hasSeen);
  if (hasSeen === "true") {
    hideOnboardingOverlay();
  }
}

function bindOnboardingStartButton() {
  const startBtn = document.getElementById("getStartedBtn");
  if (startBtn && startBtn.dataset.onboardingBound !== "true") {
    startBtn.dataset.onboardingBound = "true";
    startBtn.setAttribute("type", "button");
    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleStart();
    };
    startBtn.addEventListener("click", handleClick);
  }
}

function shouldSkipOnboardingModal() {
  if (page !== "dashboard") return true;
  const path = window.location.pathname.toLowerCase();
  return path.includes("login.html");
}

function getWelcomeSeenStorageKey(uid = "") {
  return uid ? `${WELCOME_SEEN_KEY}:${uid}` : WELCOME_SEEN_KEY;
}

function getLocalWelcomeSeen(uid = "") {
  const key = getWelcomeSeenStorageKey(uid);
  return localStorage.getItem(key);
}

function persistLocalWelcomeSeen(uid, seen = true) {
  const value = seen ? "true" : "false";
  localStorage.setItem(WELCOME_SEEN_KEY, value);
  if (uid) {
    localStorage.setItem(getWelcomeSeenStorageKey(uid), value);
  }
}

function startDashboardApp(user) {
  const uid = user?.uid;
  if (!uid || dashboardInitStartedForUid === uid) return;
  dashboardInitStartedForUid = uid;
  loadChats();
  loadTrackerData();
  initNotifications(uid);
}

async function maybeHandleOnboardingForUser(user) {
  const uid = user?.uid;
  if (!uid || shouldSkipOnboardingModal()) return true;

  if (lastOnboardingEvalUid !== uid) {
    lastOnboardingEvalUid = uid;
    hasEvaluatedOnboardingForUser = false;
    dashboardInitStartedForUid = null;
  }
  if (hasEvaluatedOnboardingForUser) {
    return state.userOnboardingDone === true;
  }

  const localHasSeen = getLocalWelcomeSeen(uid) === "true";
  let firestoreHasSeen = false;
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const userData = userSnap.data();
      firestoreHasSeen = Boolean(userData.hasSeenWelcome ?? userData.onboardingDone ?? false);
    }
  } catch (error) {
    console.error("Onboarding status read error:", error);
  }

  const hasSeenWelcome = firestoreHasSeen || localHasSeen;
  console.log("hasSeenWelcome:", String(hasSeenWelcome));
  state.userOnboardingDone = hasSeenWelcome;

  if (hasSeenWelcome) {
    persistLocalWelcomeSeen(uid, true);
    hideOnboardingOverlay();
    hasEvaluatedOnboardingForUser = true;
    return true;
  }

  showOnboardingOverlay();
  hasEvaluatedOnboardingForUser = true;
  return false;
}

async function handleStart() {
  const overlay = document.querySelector(".welcome-modal") || document.getElementById("onboarding");
  const startBtn = document.getElementById("getStartedBtn") || document.getElementById("startBtn");
  if (!overlay || !startBtn) return;
  if (isHandlingOnboardingStart) return;
  isHandlingOnboardingStart = true;

  const activeUser = state.currentUser;
  const activeUid = activeUser?.uid || "";

  try {
    console.log("Get Started clicked");
    startBtn.disabled = true;
    startBtn.textContent = "Setting up...";
    persistLocalWelcomeSeen(activeUid, true);
    hasEvaluatedOnboardingForUser = true;
    state.userOnboardingDone = true;
    hideOnboardingOverlay();

    try {
      // Persistence: Update Firestore
      if (activeUid) {
        const userRef = doc(db, "users", activeUid);
        await updateDoc(userRef, {
          onboardingDone: true,
          hasSeenWelcome: true
        });
      }
    } catch (err) {
      console.error("Onboarding setup error:", err);
    }

    // Welcome message in chat (Prevention of duplicates)
    if (ui.chatMessages && !sessionStorage.getItem("welcomeMessageSent")) {
      const welcomeMsg = document.createElement("div");
      welcomeMsg.className = "message ai-message";
      welcomeMsg.innerHTML = `<p>Hi! I'm StudyMate AI 👋 What would you like to learn today? I can help with General, Exam, or Coding topics!</p>`;
      ui.chatMessages.appendChild(welcomeMsg);
      scrollMessagesToBottom();
      sessionStorage.setItem("welcomeMessageSent", "true");
    }

    // Auto focus input
    if (ui.userInput) {
      ui.userInput.placeholder = "Ask anything... (e.g. Explain photosynthesis)";
      ui.userInput.focus();
    }

    if (activeUser) {
      startDashboardApp(activeUser);
    }
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Get Started";
    isHandlingOnboardingStart = false;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function initSettingsPage() {
  ui = {
    settingsNameInput: document.getElementById("settingsNameInput"),
    settingsEmailInput: document.getElementById("settingsEmailInput"),
    settingsAvatarUrlInput: document.getElementById("settingsAvatarUrlInput"),
    settingsAvatarPreview: document.getElementById("settingsAvatarPreview"),
    settingsDisplayHeader: document.getElementById("settingsDisplayHeader"),
    settingsEmailHeader: document.getElementById("settingsEmailHeader"),
    saveAccountBtn: document.getElementById("saveAccountBtn"),
    
    changePasswordBtn: document.getElementById("changePasswordBtn"),
    logoutAllSessionsBtn: document.getElementById("logoutAllSessionsBtn"),
    
    aiModelSelect: document.getElementById("aiModelSelect"),
    aiStyleSelect: document.getElementById("aiStyleSelect"),
    aiToneSelect: document.getElementById("aiToneSelect"),
    autoQuestionToggle: document.getElementById("autoQuestionToggle"),
    
    statsTotalRequests: document.getElementById("statsTotalRequests"),
    statsTokensUsed: document.getElementById("statsTokensUsed"),
    
    themeSelector: document.getElementById("themeSelector"),
    appLanguageSelect: document.getElementById("appLanguageSelect"),
    fontSizeRange: document.getElementById("fontSizeRange"),
    
    fullLogoutBtn: document.getElementById("fullLogoutBtn"),
    clearAllHistoryBtn: document.getElementById("clearAllHistoryBtn"),
    downloadDataBtn: document.getElementById("downloadDataBtn"),
    deleteAccountBtn: document.getElementById("deleteAccountBtn"),
    googleAccountStatus: document.getElementById("googleAccountStatus")
  };

  bindSettingsEvents();
  renderSettingsPreferences();

  // Initialize Category Navigation Logic
  const nav = document.getElementById("settingsNav");
  if (nav) {
    const navItems = nav.querySelectorAll(".nav-item");
    const sections = document.querySelectorAll(".settings-card");

    navItems.forEach(item => {
      item.addEventListener("click", () => {
        const target = item.dataset.section;
        
        // Update nav active state
        navItems.forEach(i => i.classList.remove("active"));
        item.classList.add("active");

        // Toggle sections visibility
        sections.forEach(sec => {
          if (sec.id === target + "-section") {
            sec.classList.remove("hidden");
          } else {
            sec.classList.add("hidden");
          }
        });

        // Scroll to top on navigation (especially important for mobile)
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }
}

function bindSettingsEvents() {
  if (ui.saveAccountBtn) ui.saveAccountBtn.addEventListener("click", () => saveAccountProfile());
  if (ui.changePasswordBtn) ui.changePasswordBtn.addEventListener("click", () => handlePasswordResetRequest());
  if (ui.logoutAllSessionsBtn) ui.logoutAllSessionsBtn.addEventListener("click", () => confirmLogoutAll());
  if (ui.fullLogoutBtn) ui.fullLogoutBtn.addEventListener("click", () => confirmLogoutAll());
  
  if (ui.aiModelSelect) ui.aiModelSelect.addEventListener("change", () => saveUserSettings());
  if (ui.aiStyleSelect) ui.aiStyleSelect.addEventListener("change", () => saveUserSettings());
  if (ui.aiToneSelect) ui.aiToneSelect.addEventListener("change", () => saveUserSettings());
  if (ui.autoQuestionToggle) ui.autoQuestionToggle.addEventListener("change", () => saveUserSettings());
  
  if (ui.themeSelector) {
    ui.themeSelector.addEventListener("click", (e) => {
      const btn = e.target.closest(".theme-btn-card");
      if (!btn) return;
      setTheme(btn.dataset.theme);
      renderSettingsPreferences();
    });
  }
  
  if (ui.appLanguageSelect) ui.appLanguageSelect.addEventListener("change", () => saveUserSettings());
  if (ui.fontSizeRange) {
    ui.fontSizeRange.addEventListener("input", (e) => applyFontSize(e.target.value));
    ui.fontSizeRange.addEventListener("change", () => saveUserSettings());
  }

  if (ui.clearAllHistoryBtn) ui.clearAllHistoryBtn.addEventListener("click", () => clearCurrentUserChats());
  if (ui.downloadDataBtn) ui.downloadDataBtn.addEventListener("click", () => exportUserData());
  if (ui.deleteAccountBtn) ui.deleteAccountBtn.addEventListener("click", () => handleDeleteAccount());
}

async function loadUserSettings() {
  if (!state.currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", state.currentUser.uid));
    if (snap.exists()) {
      const data = snap.data();
      const settings = data.settings || {};
      
      state.userSettings = {
        aiModel: settings.aiModel || "auto",
        aiStyle: settings.aiStyle || "detailed",
        aiTone: settings.aiTone || "professional",
        autoQuestion: settings.autoQuestion !== false,
        language: settings.language || "en",
        fontSize: settings.fontSize || 16
      };
      
      if (ui.aiModelSelect) ui.aiModelSelect.value = state.userSettings.aiModel;
      if (ui.aiStyleSelect) ui.aiStyleSelect.value = state.userSettings.aiStyle;
      if (ui.aiToneSelect) ui.aiToneSelect.value = state.userSettings.aiTone;
      if (ui.autoQuestionToggle) ui.autoQuestionToggle.checked = state.userSettings.autoQuestion;
      if (ui.appLanguageSelect) ui.appLanguageSelect.value = state.userSettings.language;
      if (ui.fontSizeRange) {
        ui.fontSizeRange.value = state.userSettings.fontSize;
        applyFontSize(state.userSettings.fontSize);
      }
    }
  } catch (err) {
    console.error("Load settings error:", err);
  }
}

async function saveUserSettings() {
  if (!state.currentUser) return;
  const settings = {
    aiModel: ui.aiModelSelect?.value || "auto",
    aiStyle: ui.aiStyleSelect?.value || "detailed",
    aiTone: ui.aiToneSelect?.value || "professional",
    autoQuestion: ui.autoQuestionToggle?.checked ?? true,
    language: ui.appLanguageSelect?.value || "en",
    fontSize: Number(ui.fontSizeRange?.value || 16)
  };
  
  state.userSettings = settings;
  
  try {
    await updateDoc(doc(db, "users", state.currentUser.uid), { 
      settings,
      updatedAt: serverTimestamp() 
    });
    localStorage.setItem("appSettings", JSON.stringify(settings));
    showToast("Preferences updated", "success");
  } catch (err) {
    console.error("Save settings error:", err);
    showToast("Failed to sync settings", "error");
  }
}

async function saveAccountProfile() {
  if (!state.currentUser) return;
  const newName = ui.settingsNameInput.value.trim();
  const newPhoto = ui.settingsAvatarUrlInput.value.trim();
  
  try {
    ui.saveAccountBtn.disabled = true;
    ui.saveAccountBtn.textContent = "Saving...";
    
    await updateProfile(state.currentUser, {
      displayName: newName,
      photoURL: newPhoto
    });
    
    await updateDoc(doc(db, "users", state.currentUser.uid), {
      displayName: newName,
      photoURL: newPhoto,
      updatedAt: serverTimestamp()
    });
    
    if (ui.settingsDisplayHeader) ui.settingsDisplayHeader.textContent = newName;
    if (ui.settingsAvatarPreview && newPhoto) ui.settingsAvatarPreview.src = newPhoto;
    
    showToast("Profile updated successfully", "success");
  } catch (err) {
    console.error("Profile update error:", err);
    showToast("Error updating profile", "error");
  } finally {
    ui.saveAccountBtn.disabled = false;
    ui.saveAccountBtn.textContent = "Save Profile";
  }
}

async function loadUsageStats() {
  if (!state.currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", state.currentUser.uid));
    if (snap.exists()) {
      const data = snap.data();
      if (ui.statsTotalRequests) ui.statsTotalRequests.textContent = data.questionsAsked || 0;
      if (ui.statsTokensUsed) ui.statsTokensUsed.textContent = `~${(data.questionsAsked || 0) * 150}`; // Estimated tokens
    }
  } catch (err) {
    console.error("Stats load error:", err);
  }
}

function applyFontSize(size) {
  document.documentElement.style.setProperty("--app-font-size", `${size}px`);
  // If we were using raw CSS for font sizes, we'd adjust body/html
  document.body.style.fontSize = `${size}px`;
}

async function handlePasswordResetRequest() {
  const confirmed = await showConfirm({
    label: "Security",
    title: "Reset Password?",
    message: "We will send a password reset link to your email address.",
    confirmText: "Send Link"
  });
  if (!confirmed) return;
  
  try {
    await sendPasswordResetEmail(auth, state.currentUser.email);
    showToast("Reset link sent to your email", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function exportUserData() {
  try {
    const userDoc = await getDoc(doc(db, "users", state.currentUser.uid));
    const chatsQuery = query(collection(db, "chats"), where("userId", "==", state.currentUser.uid));
    const chatsSnap = await getDocs(chatsQuery);
    
    const chats = [];
    for (const d of chatsSnap.docs) {
      const chatData = d.data();
      const msgsSnap = await getDocs(collection(db, "chats", d.id, "messages"));
      chatData.messages = msgsSnap.docs.map(m => m.data());
      chats.push(chatData);
    }
    
    const exportData = {
      profile: userDoc.data(),
      chats,
      exportedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studymate_data_export_${state.currentUser.uid}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Data export successful", "success");
  } catch (err) {
    console.error("Export error:", err);
    showToast("Export failed", "error");
  }
}

async function handleDeleteAccount() {
  const step1 = await showConfirm({
    label: "Danger Zone",
    title: "Delete Account Forever?",
    message: "This will permanently delete your profile, all chats, and settings. This cannot be undone.",
    confirmText: "Continue",
    type: "danger"
  });
  if (!step1) return;
  
  const step2 = await showConfirm({
    label: "Last Warning",
    title: "Are you absolutely sure?",
    message: "This is your LAST chance to go back. ALL data will be wiped.",
    confirmText: "DELETE EVERYTHING",
    type: "danger"
  });
  if (!step2) return;

  try {
    // 1. Delete Firestore Chats
    const chatsQuery = query(collection(db, "chats"), where("userId", "==", state.currentUser.uid));
    const snapshot = await getDocs(chatsQuery);
    for (const d of snapshot.docs) {
      await deleteDoc(doc(db, "chats", d.id));
    }
    
    // 2. Delete User Doc
    await deleteDoc(doc(db, "users", state.currentUser.uid));
    
    // 3. Delete Auth Account
    await state.currentUser.delete();
    
    window.location.replace("signup.html");
  } catch (err) {
    console.error("Delete error:", err);
    showToast("Error during deletion. Try logging in again first.", "error");
  }
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
    const cb = e.target.closest("[data-copy-code]");
    const cp = e.target.closest("[data-copy-message]");
    const rg = e.target.closest("[data-regenerate-message]");
    if (cb) return await window.copyCode(cb);
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


// ---------------------------------------------------------------------------
// Logout / profile
// ---------------------------------------------------------------------------

async function confirmLogoutAll() {
  const confirmed = await showConfirm({
    label: "Confirm Logout",
    title: "Log out from devices?",
    message: "Are you sure you want to log out of your current session?",
    confirmText: "Log Out",
    type: "danger"
  });
  if (confirmed) await handleLogout();
}

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
  if (!ui) return;
  const avatarUrl = photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
  const shortName = getShortName(name);
  if (ui.userAvatar) { ui.userAvatar.src = avatarUrl; ui.userAvatar.alt = `${name} avatar`; }
  if (ui.dropdownAvatar) { ui.dropdownAvatar.src = avatarUrl; ui.dropdownAvatar.alt = `${name} avatar`; }
  if (ui.userShortName) ui.userShortName.textContent = shortName;
  if (ui.dropdownUserName) ui.dropdownUserName.innerText = name;
  if (ui.dropdownUserEmail) ui.dropdownUserEmail.innerText = email;
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
          mode: normalizeMode(data.mode), hinglish: Boolean(data.hinglish),
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

      const isFirstLoad = activeChat.messages.length === 0 && snapshot.docs.length > 0;

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
        // If this was the initial load, scroll to bottom
        if (isFirstLoad) {
          setTimeout(() => scrollMessagesToBottom(true), 50);
        }
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
    return `<article class="history-card ${isActive}"><button class="history-open" data-open-chat="${chat.id}" type="button"><span class="history-title">${escapeHtml(chat.title)}</span><span class="history-meta">${MODE_LABELS[chat.mode] || MODE_LABELS.general}${chat.hinglish ? " | Hinglish" : ""}</span><span class="history-meta">${formatSidebarDate(chat.updatedAt)}</span></button><div class="history-actions"><button class="history-action" data-rename-chat="${chat.id}" type="button">Rename</button><button class="history-action danger" data-delete-chat="${chat.id}" type="button">Delete</button></div></article>`;
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
  const isStreaming = state.streamingResponse && state.streamingResponse.chatId === activeChat?.id;

  if (!activeChat || (activeChat.messages.length === 0 && !showTyping && !isStreaming)) {
    ui.chatTitle.textContent = activeChat?.title || "New Chat";
    ui.chatMessages.innerHTML = `<div class="empty-state"><h3>Start a new conversation &#128640;</h3><p>Create a chat from the sidebar and ask your first question.</p></div>`;
    return;
  }
  ui.chatTitle.textContent = activeChat?.title || "New Chat";

  const messageMarkup = activeChat.messages.map((message, index) => {
    const roleLabel = message.role === "user" ? "You" : "StudyMate AI";
    const contentMarkup = `<div class="message-content" data-message-content="${index}">${formatMessage(message.content, message.role, message.intent, message.doubt)}</div>`;
    const sourcesMarkup = renderMessageSources(message);
    const actionMarkup = renderMessageActions(activeChat.messages, message, index);
    return `<div class="message-row ${message.role}"><div class="message-bubble"><div class="message-meta"><strong>${roleLabel}</strong></div>${contentMarkup}${sourcesMarkup}${actionMarkup}</div></div>`;
  }).join("");

  let assistantBubbleMarkup = "";
  if (isStreaming || showTyping) {
    const text = isStreaming ? state.streamingResponse.visibleText : "";
    const content = text 
      ? formatMessage(text, "ai") 
      : `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
    
    assistantBubbleMarkup = `
      <div class="message-row ai">
        <div class="message-bubble">
          <div class="message-meta"><strong>StudyMate AI</strong></div>
          <div class="message-content" data-stream-content>${content}</div>
        </div>
      </div>
    `.trim();
  }

  ui.chatMessages.innerHTML = `${messageMarkup}${assistantBubbleMarkup}`;
  renderMermaidDiagrams();
  focusMessageEditor();
  // Removed global auto-scroll from renderMessages to avoid jumping during streaming
}

function openChat(chatId) {
  if (state.streamingResponse && state.streamingResponse.chatId !== chatId) stopStreamingResponse();
  state.currentChatId = chatId; state.editingChatId = null; state.renameDraft = "";
  state.editingMessageIndex = null; state.messageDraft = "";
  
  if (!state.isGuestMode) {
    loadMessages(chatId);
  } else {
    syncHeaderWithActiveChat(); 
    renderHistory(); 
    renderMessages(); 
    // Force scroll to bottom on initial load
    setTimeout(() => scrollMessagesToBottom(true), 100);
  }
  
  closeSidebar();
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
    userId: state.currentUser?.uid || "guest",
    currentQuestion: state.currentQuestion,
    stream: true, // Enable Real-Time Streaming
    autoQuestion: state.userSettings.autoQuestion ?? true,
    userProfile: {
      preferred_style: state.userSettings.aiStyle || "detailed",
      preferred_tone: state.userSettings.aiTone || "professional",
      model_choice: state.userSettings.aiModel || "auto"
    }
  };

  try {
    const controller = new AbortController();
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "AI service is currently unavailable.");
    }

    // Check if it's a stream
    const contentType = response.headers.get("Content-Type");
    if (contentType && contentType.includes("text/event-stream")) {
      return { body: response.body, isStream: true, controller };
    }

    // Fallback for non-streaming response
    const data = await response.json();
    return { 
      text: data.reply || data.text, 
      sources: data.sources || [], 
      intent: data.intent || "GENERAL", 
      doubt: data.doubt || false,
      metadata: data
    };
  } catch (err) {
    console.error("Backend request failed:", err);
    throw err;
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
  state.isSending = true; 
  state.showTypingIndicator = true;
  state.editingMessageIndex = null; 
  state.messageDraft = "";
  setComposerLoading(true);

  chat.mode = getSelectedMode();
  chat.hinglish = ui.hinglishToggle.checked;
  chat.notesMode = getSelectedNotesMode();
  renderHistory(); 
  renderMessages();
  scrollMessagesToBottom(true); // Initial scroll

  let finalApiMessages = apiMessages || [...chat.messages].slice(-6);
  if (userContent && !finalApiMessages.some(m => m.content === userContent && m.role === "user")) {
    finalApiMessages.push({ role: "user", content: userContent });
  }

  try {
    const aiResult = await fetchAIResponse(finalApiMessages, chat.mode, chat.hinglish, chat.notesMode);
    
    let finalContent = "";
    let finalMetadata = null;

    if (aiResult.isStream) {
      // HANDLE REAL STREAMING
      const streamData = await streamAssistantMessage(chat.id, aiResult.body, aiResult.controller);
      finalContent = streamData.text;
      finalMetadata = streamData.metadata;
    } else {
      // HANDLE LEGACY/SYNC RESPONSE
      state.showTypingIndicator = false;
      finalContent = aiResult.text;
      finalMetadata = aiResult.metadata;
      await streamAssistantMessage(chat.id, finalContent); // Fallback to simulated stream for sync responses
    }

    const aiSources = normalizeSources(finalMetadata?.sources || aiResult.sources);
    const aiIntent = finalMetadata?.intent || aiResult.intent || "GENERAL";
    const aiDoubt = finalMetadata?.doubt || aiResult.doubt || false;

    if (finalMetadata?.ui) {
      if (finalMetadata.ui.syncState?.currentQuestion) {
        state.currentQuestion = finalMetadata.ui.syncState.currentQuestion;
      }
    }

    if (finalMetadata?.success === false || aiResult?.metadata?.success === false) {
      showToast("AI is temporarily busy. Showing fallback response.", "error");
    }

    if (state.isGuestMode) {
      const msg = createGuestMessage("ai", finalContent, aiSources);
      msg.intent = aiIntent;
      msg.doubt = aiDoubt;
      chat.messages.push(msg);
      chat.updatedAt = Timestamp.now();
      if (chat.title === "New Chat" && titleSource && finalApiMessages.filter((m) => m.role === "ai").length === 0) {
        chat.title = generateChatTitle(titleSource);
      }
    } else {
      await addDoc(collection(db, "chats", chat.id, "messages"), {
        role: "ai",
        content: finalContent,
        sources: aiSources,
        intent: aiIntent,
        doubt: aiDoubt,
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

  } catch (err) {
    console.error("Reply error:", err);
    state.showTypingIndicator = false;
    showToast(err.message || "Failed to get AI response", "error");
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

async function streamAssistantMessage(chatId, source, controller = null) {
  stopStreamingResponse();
  state.streamingResponse = { chatId, visibleText: "", isCancelled: false };
  
  if (typeof source === "string") {
    // Legacy simulated streaming
    const words = source.split(" ");
    let current = "";
    for (let i = 0; i < words.length; i++) {
       if (!state.streamingResponse || state.streamingResponse.isCancelled) return;
       current += (i === 0 ? words[i] : ` ${words[i]}`);
       state.streamingResponse.visibleText = current;
       updateStreamUI(current);
       await delay(STREAM_WORD_DELAY_MS);
    }
    stopStreamingResponse();
    return { text: source };
  }

  // Real Multi-Model Streaming
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let accumulatedText = "";
  let metadata = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (state.streamingResponse?.isCancelled) {
        controller?.abort();
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine.startsWith("data: ")) continue;
        const dataStr = cleanLine.slice(6);
        if (dataStr === "[DONE]") break;

        try {
          const data = JSON.parse(dataStr);
          if (data.content) {
            if (state.showTypingIndicator) state.showTypingIndicator = false; 
            accumulatedText += data.content;
            state.streamingResponse.visibleText = accumulatedText;
            updateStreamUI(accumulatedText);
            // Auto-scroll removed during streaming loop as per strict request
          } else if (data.metadata) {
            metadata = data.metadata;
          }
        } catch (e) {}
      }
    }
  } finally {
    stopStreamingResponse();
    // Handle graceful completion if stream was empty or broken
    if (!accumulatedText || accumulatedText.length < 10) {
      accumulatedText = (accumulatedText || "") + "\n\n" + generateSafeFallbackReply();
    }
    renderMessages();
    renderMermaidDiagrams();
  }

  return { text: accumulatedText, metadata };
}

function stopStreamingResponse() {
  if (state.streamingResponse) state.streamingResponse.isCancelled = true;
  state.streamingResponse = null;
}

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
  if (!activeChat) {
    ui.chatTitle.textContent = "New Chat";
    setSelectedMode(getSavedDefaultMode());
    setSelectedNotesMode(getSavedDefaultNotesMode());
    ui.hinglishToggle.checked = getSavedHinglishDefault();
    return;
  }
  const currentMode = normalizeMode(activeChat.mode);
  ui.chatTitle.textContent = `${MODE_LABELS[currentMode]} | ${activeChat.title || "New Chat"}`;
  setSelectedMode(currentMode);
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

function autoResizeTextarea(textarea) { textarea.style.height = "auto"; textarea.style.height = `${textarea.scrollHeight}px`; }

// ---------------------------------------------------------------------------
// Mode dropdown
// ---------------------------------------------------------------------------

function bindModeDropdown() {
  ui.selectedMode.addEventListener("click", (e) => { e.stopPropagation(); ui.profileDropdown.classList.remove("show"); closeNotesDropdown(); ui.modeDropdown.classList.toggle("open"); ui.selectedMode.setAttribute("aria-expanded", String(ui.modeDropdown.classList.contains("open"))); });
  ui.dropdownOptions.addEventListener("click", async (e) => { const option = e.target.closest(".option"); if (!option) return; setSelectedMode(option.dataset.value || option.textContent.trim()); closeModeDropdown(); await saveActiveChatSettings(); });
}

function setSelectedMode(mode) {
  const normalized = normalizeMode(mode);
  ui.selectedMode.textContent = MODE_LABELS[normalized];
  ui.selectedMode.dataset.value = normalized;
  ui.dropdownOptions.querySelectorAll(".option").forEach((o) => o.classList.toggle("active", o.dataset.value === normalized));
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
function normalizeMode(mode) {
  const m = String(mode || "").toLowerCase();
  return MODES.includes(m) ? m : "general";
}
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

function resetPreferences() { setTheme("dark"); saveDefaultMode("general"); saveDefaultNotesMode("normal"); saveHinglishDefault(false); renderSettingsPreferences(); showToast("Settings have been reset.", "success"); }

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

window.copyCode = async function copyCode(button) {
  const codeNode = button?.closest(".code-block")?.querySelector("pre code");
  if (!codeNode) return;
  const codeText = codeNode.innerText || codeNode.textContent || "";

  try {
    await navigator.clipboard.writeText(codeText);
    const originalText = button.textContent;
    button.textContent = "Copied!";
    window.setTimeout(() => {
      button.textContent = originalText || "Copy";
    }, 1500);
  } catch (error) {
    console.error("Code copy failed:", error);
    showToast("Unable to copy code right now.", "error");
  }
};

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

/**
 * Send a welcome notification when a user first creates their account.
 * Called from ensureUserDocument when a new user doc is created.
 */
async function sendWelcomeNotification(userId) {
  try {
    await createNotification(
      userId,
      "Welcome to StudyMate AI! 🎉",
      "Start a new chat and ask your first question. We support General, Exam, and Coding modes!",
      "success"
    );
  } catch (err) {
    console.error("Welcome notification error:", err);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setFormMessage(element, message, type) { element.textContent = message; element.className = `form-message ${type}`; }
function delay(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function getLatestUserMessageFromPayload(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && typeof messages[i]?.content === "string") return messages[i].content;
  }
  return "";
}
function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((src) => src && typeof src.url === "string" && typeof src.title === "string")
    .map((src) => ({ title: src.title.trim(), url: src.url.trim() }))
    .filter((src) => src.title && /^https?:\/\//i.test(src.url))
    .slice(0, 5);
}
function renderMessageSources(message) {
  if (message?.role !== "ai") return "";
  const sources = normalizeSources(message?.sources);
  if (!sources.length) return "";
  const linksMarkup = sources.map((src) => (
    `<a href="${escapeAttribute(src.url)}" target="_blank" rel="noopener noreferrer">` +
    `&#128279; ${escapeHtml(src.title)}` +
    `</a>`
  )).join("");
  return `<div class="sources"><p>Sources:</p>${linksMarkup}</div>`;
}
function formatMessage(content, role = "ai", intent = "GENERAL", doubt = false) {
  let text = String(content ?? "").trim();
  if (role !== "ai") return escapeHtml(text).replace(/\n/g, "<br>");

  // 1. Remove "Quiz:" if present in the raw text (backend safety)
  text = text.replace(/Quiz:\s*.*$/is, "").trim();

  // 2. Parse main content
  let html = "";
  try {
    html = sanitizeRenderedHtml(String(marked.parse(text)));
  } catch (err) {
    console.error("Markdown render error:", err);
    html = escapeHtml(text).replace(/\n/g, "<br>");
  }

  // 3. Append Reactive UI buttons only if explicitly invited by AI
  if (text.includes("Want a quiz on this?")) {
    const buttonHtml = `
      <div class="followup-box">
        <span class="followup-arrow">➤</span>
        <button class="quiz-trigger-btn" onclick="window.startQuizInteractive(this)">✍️ Take Quiz</button>
      </div>
    `.trim();
    html += buttonHtml;
  }

  return html;
}

/**
 * renderMermaidDiagrams()
 * Force Mermaid to re-scan the DOM for new .mermaid blocks.
 */
async function renderMermaidDiagrams() {
  if (typeof mermaid === "undefined") return;
  try {
    await mermaid.run({
      nodes: document.querySelectorAll(".mermaid")
    });
  } catch (err) {
    console.error("Mermaid rendering failed:", err);
    // Fallback: If mermaid fails, wrap it in a pre/code block for readability
    document.querySelectorAll(".mermaid:not([data-processed])").forEach(node => {
      node.style.whiteSpace = "pre";
      node.style.fontFamily = "monospace";
      node.style.color = "var(--text-soft)";
    });
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

window.startQuizInteractive = function(button) {
  // 1. Set mode to quiz
  const quizModeBtn = document.querySelector('.mode-btn[data-mode="quiz"]');
  if (quizModeBtn) {
    quizModeBtn.click();
  } else {
    state.currentMode = 'quiz';
    renderDashboard();
  }
  
  // 2. Clear current question state for a fresh start
  state.currentQuestion = null;
  
  // 3. Send a message to get the first question
  ui.userInput.value = "Start the quiz please!";
  handleSendMessage();
};

// ---------------------------------------------------------------------------
// Initialization & Boot Sequence
// ---------------------------------------------------------------------------

/**
 * initAuth()
 * Centralized Firebase Auth listener that serves as the primary gatekeeper.
 */
async function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      state.currentUser = user;
      const currentPage = document.body.dataset.page;
      const isAuthPage = ["login", "signup", "forgot"].includes(currentPage);
      const isProtectedPage = ["dashboard", "settings"].includes(currentPage);

      if (!user) {
        if (isProtectedPage) {
          window.location.replace("login.html");
          return;
        }
        resolve(null);
        return;
      }

      // User is logged in
      if (isAuthPage) {
        window.location.replace("index.html");
        return;
      }

      // Initialize Protected App Context for dashboard/settings
      await initApp(user);
      resolve(user);
    });
  });
}

/**
 * initApp(user)
 * Setup shared services for authenticated users.
 */
async function initApp(user) {
  try {
    await ensureUserDocument(user);
    
    // Core Shared Init
    const page = document.body.dataset.page;
    if (page === "dashboard" || page === "settings") {
      await loadUserSettings();
    }

    if (page === "dashboard") {
      populateUserInfo(user);
      await maybeHandleOnboardingForUser(user);
      startDashboardApp(user);
    }

    if (page === "settings") {
      populateUserInfo(user);
      await loadUsageStats();
    }
  } catch (err) {
    console.error("App Initialization Error:", err);
  }
}

/**
 * populateUserInfo(user)
 * Safely populates user-specific UI elements across different pages.
 */
function populateUserInfo(user) {
  if (!user || !ui) return;
  const name = user.displayName || "User";
  const email = user.email || "No emailFound";
  const photo = user.photoURL || "";
  const isGoogle = user.providerData[0]?.providerId === 'google.com';

  // Dashboard elements
  if (document.body.dataset.page === "dashboard") {
    displayUserProfile(name, email, photo);
  }

  // Settings elements
  if (ui.settingsEmailInput) ui.settingsEmailInput.value = email;
  if (ui.settingsNameInput) ui.settingsNameInput.value = name;
  if (ui.settingsAvatarUrlInput) ui.settingsAvatarUrlInput.value = photo;
  if (ui.settingsDisplayHeader) ui.settingsDisplayHeader.textContent = name;
  if (ui.settingsEmailHeader) ui.settingsEmailHeader.textContent = email;
  if (ui.settingsAvatarPreview && photo) ui.settingsAvatarPreview.src = photo;
  if (ui.googleAccountStatus) ui.googleAccountStatus.textContent = isGoogle ? "Linked (Google)" : "Not Linked";
}

/**
 * bootstrap()
 * The main entry point. Runs basic UI setup then hands off to Auth.
 */
async function bootstrap() {
  try {
    // 1. Basic UI & Theme (Safe to run before auth)
    initializeFeedbackUi();
    applySavedTheme();
    consumeFlashToast();

    // 2. Initialize Mermaid (Lazy)
    if (typeof mermaid !== "undefined") {
      mermaid.initialize({
        startOnLoad: false,
        theme: document.body.classList.contains("light") ? "default" : "dark",
        securityLevel: "loose",
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" }
      });
    }
    
    // 3. Initialize Page-Specific UI Bindings
    const page = document.body.dataset.page;
    if (page === "login") initLoginPage();
    if (page === "signup") initSignupPage();
    if (page === "settings") initSettingsPage();
    if (page === "dashboard") initDashboardPage();

    // 4. Auth Gatekeeper (Handles redirects and initApp)
    await initAuth();
    
  } catch (err) {
    console.error("StudyMate Bootstrap Error:", err);
  }
}

// ---------------------------------------------------------------------------
// Consolidated Page & Stream Utilities
// ---------------------------------------------------------------------------

function updateStreamUI(text) {
  const streamContainer = document.querySelector("[data-stream-content]");
  if (!streamContainer) return;
  
  // Directly update inner HTML of the active stream bubble
  streamContainer.innerHTML = formatMessage(text, "ai");
  renderMermaidDiagrams();
}

function generateSafeFallbackReply() {
  return "I'm currently experiencing a high volume of requests, but I've processed your input. Please try refreshing or rephrasing your question if the response above seems incomplete.";
}

function scrollMessagesToBottom(force = false) {
  const container = document.querySelector(".chat-container") || ui?.chatMessages;
  if (!container) return;

  // Strict: Only scroll if forced or if user is already at bottom
  // However, user requested: "Only scroll on chat open. Do NOT scroll on chunks."
  // So we only force scroll when specifically asked (force=true)
  if (!force) return;

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// Global start
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
