import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { sendAdminNotification } from "./services/notificationService.js";

// â”€â”€ DOM Elements â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dom = {
  body: document.body,
  authLoader: document.getElementById("authLoader"),
  form: document.getElementById("adminNotifForm"),
  titleInput: document.getElementById("notifTitle"),
  messageInput: document.getElementById("notifMessage"),
  typeSelect: document.getElementById("notifType"),
  targetInputs: document.getElementsByName("targetType"),
  targetCards: document.querySelectorAll(".target-card"),
  singleUserGroup: document.getElementById("singleUserGroup"),
  targetUidInput: document.getElementById("targetUid"),
  sendBtn: document.getElementById("sendBtn"),
  previewSlot: document.getElementById("previewSlot"),
  titleCounter: document.getElementById("titleCounter"),
  messageCounter: document.getElementById("messageCounter"),
  titleError: document.getElementById("titleError"),
  messageError: document.getElementById("messageError"),
  uidError: document.getElementById("uidError"),
  toastContainer: document.getElementById("toastContainer")
};

const NOTIFICATION_TYPE_ICONS = {
  info: "â„¹ï¸",
  success: "âœ…",
  warning: "âš ï¸"
};

// â”€â”€ Authorization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const initAuth = () => {
  // Wait for auth state
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    unsubscribe(); // Only check once on load

    const startTime = Date.now();
    const skeleton = document.getElementById("adminSkeleton");
    const content = document.getElementById("adminContent");

    const showDashboard = () => {
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 300 - elapsed);
      setTimeout(() => {
        if (skeleton) skeleton.style.display = "none";
        if (content) content.style.display = "block";
        document.body.style.opacity = "1";
        document.body.style.pointerEvents = "auto";
      }, delay);
    };

    if (user) {
      try {
        const tokenResult = await user.getIdTokenResult(true);
        if (tokenResult.claims.admin) {
          setupUI();
          showDashboard();
        } else {
          window.location.replace("index.html");
        }
      } catch (err) {
        console.error("Auth error:", err);
        window.location.replace("index.html");
      }
    } else {
      window.location.replace("index.html");
    }
    unsubscribe(); // Stop listening after first check
  });
};

const setupUI = () => {
  // Hide loader and show body
  if (dom.authLoader) dom.authLoader.style.display = "none";
  dom.body.classList.add("ready");
  
  // Initialize dynamic listeners
  bindEvents();
  updatePreview(); // Initial preview
  dom.titleInput.focus();
};

// â”€â”€ Live Preview & Debounce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let debounceTimer;
const debounce = (callback, delay) => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(callback, delay);
};

const updatePreview = () => {
  const title = dom.titleInput.value.trim() || "Notification Title";
  const message = dom.messageInput.value.trim() || "Your message will appear here precisely as users will see it in their dashboard.";
  const type = dom.typeSelect.value;
  const icon = NOTIFICATION_TYPE_ICONS[type] || "â„¹ï¸";

  dom.previewSlot.innerHTML = `
    <div class="notification-root">
      <div class="notification-item unread">
        <div class="notification-icon type-${type}">${icon}</div>
        <div class="notification-body">
          <p class="notification-title">${escapeHtml(title)}</p>
          <p class="notification-message">${escapeHtml(message)}</p>
          <span class="notification-time">Just now</span>
        </div>
      </div>
    </div>
  `;
};

// â”€â”€ Form Handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const bindEvents = () => {
  // Real-time preview with debounce
  dom.titleInput.addEventListener("input", () => {
    updateCounters();
    debounce(updatePreview, 150);
  });
  dom.messageInput.addEventListener("input", () => {
    updateCounters();
    debounce(updatePreview, 150);
  });
  dom.typeSelect.addEventListener("change", updatePreview);

  // Target radio handling
  dom.targetCards.forEach(card => {
    card.addEventListener("click", () => {
      const radio = card.querySelector('input[type="radio"]');
      radio.checked = true;
      
      // Update visual active state
      dom.targetCards.forEach(c => c.classList.remove("active"));
      card.classList.add("active");

      // Toggle UID input visibility
      const hideUid = radio.value === "broadcast";
      dom.singleUserGroup.classList.toggle("hidden", hideUid);
      
      if (!hideUid) dom.targetUidInput.focus();
    });
  });

  dom.form.addEventListener("submit", handleSubmit);
};

const updateCounters = () => {
  dom.titleCounter.textContent = `${dom.titleInput.value.length} / 100`;
  dom.messageCounter.textContent = `${dom.messageInput.value.length} / 300`;
};

const validateForm = () => {
  let isValid = true;
  const title = dom.titleInput.value.trim();
  const message = dom.messageInput.value.trim();
  const targetType = [...dom.targetInputs].find(r => r.checked)?.value;
  const targetUid = dom.targetUidInput.value.trim();

  // Reset errors
  dom.titleError.classList.remove("show");
  dom.messageError.classList.remove("show");
  dom.uidError.classList.remove("show");

  if (title.length < 3) {
    dom.titleError.classList.add("show");
    isValid = false;
  }
  if (message.length < 5) {
    dom.messageError.classList.add("show");
    isValid = false;
  }
  if (targetType === "single" && !targetUid) {
    dom.uidError.classList.add("show");
    isValid = false;
  }

  return isValid;
};

const handleSubmit = async (e) => {
  e.preventDefault();
  
  if (!validateForm()) return;

  const targetType = [...dom.targetInputs].find(r => r.checked)?.value;
  const isBroadcast = targetType === "broadcast";
  
  // HIGH IMPACT: Broadcast confirmation
  if (isBroadcast) {
    const confirmed = confirm("âš ï¸ Are you sure you want to broadcast this notification to ALL users?");
    if (!confirmed) return;
  }

  const payload = {
    title: dom.titleInput.value.trim(),
    message: dom.messageInput.value.trim(),
    type: dom.typeSelect.value
  };

  if (!isBroadcast) {
    payload.targetUid = dom.targetUidInput.value.trim();
  }

  // Loading state
  setLoading(true);

  try {
    const result = await sendAdminNotification(payload);

    if (!result?.success) {
      throw new Error(result?.detail || "Failed to dispatch notification.");
    }

    showToast("Notification dispatched successfully!", "success");
    dom.form.reset();
    updateCounters();
    updatePreview();
    // Reset target to broadcast visual
    dom.targetCards[0].click();
  } catch (err) {
    console.error("Submission error:", err);
    console.error("  → Error code:", err?.code);
    console.error("  → Error cause:", err?.cause);
    showToast(getErrorMessage(err), "error");
  } finally {
    setLoading(false);
  }
};

const setLoading = (loading) => {
  dom.sendBtn.disabled = loading;
  dom.sendBtn.innerHTML = loading 
    ? `<div class="spinner-ring" style="width:18px; height:18px; border-width:2px;"></div> Sending...`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
      <span>Dispatch Notification</span>`;
};

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const showToast = (message, type = "success") => {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  if (dom.toastContainer) {
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  } else {
    alert(`${type.toUpperCase()}: ${message}`);
  }
};

const escapeHtml = (unsafe) => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const getErrorMessage = (err) => {
  if (!err) return "An error occurred during dispatch.";
  if (typeof err.message === "string" && err.message.trim()) return err.message;
  if (typeof err.detail === "string" && err.detail.trim()) return err.detail;
  return "An error occurred during dispatch.";
};

// â”€â”€ Startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
initAuth();
