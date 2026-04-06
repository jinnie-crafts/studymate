import { 
  subscribeToNotifications, 
  markAsRead, 
  markAllAsRead, 
  getUnreadCount, 
  formatNotificationTime 
} from "./services/notificationService.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * Premium Notification System Component (Vanilla JS)
 * Handles real-time updates, UI rendering, and user interactions.
 */

// ── State ──────────────────────────────────────────────────────────────────
let notifications = [];
let unsubscribe = null;
let lastUnreadCount = 0;
let currentFilter = "all";
let prevIds = ""; // Lightweight ID-based diffing
let currentUserId = null;
let closeAnimTimer = null;
let hasLoadedOnce = false;
let firstSnapshotTimeoutId = null;
let authReadyUnsubscribe = null;

const FIRST_SNAPSHOT_TIMEOUT_MS = 12000;

// ── DOM References ─────────────────────────────────────────────────────────
const ui = {
  get bellBtn() { return document.getElementById("notificationBtn"); },
  get badge() { return document.getElementById("notificationBadge"); },
  get ping() { return document.getElementById("notificationPing"); },
  get panel() { return document.getElementById("notificationPanel"); },
  get overlay() { return document.getElementById("notificationOverlay"); },
  get list() { return document.getElementById("notificationList"); },
  get markAllBtn() { return document.getElementById("markAllReadBtn"); },
  get footerLabel() { return document.getElementById("notificationCountLabel"); },
  get unreadFilterBadge() { return document.getElementById("unreadFilterBadge"); },
  get filterBtns() { return document.querySelectorAll(".notif-filter"); }
};

const ICONS = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️"
};

// ── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the notification system for a user.
 * @param {string} userId - Firebase UID
 */
export function initNotifications(userId) {
  const resolvedUserId =
    typeof userId === "string" && userId.trim()
      ? userId.trim()
      : auth.currentUser?.uid || null;

  if (!resolvedUserId) {
    waitForAuthThenInit();
    return;
  }

  if (typeof authReadyUnsubscribe === "function") {
    authReadyUnsubscribe();
    authReadyUnsubscribe = null;
  }

  currentUserId = resolvedUserId;

  // Ensure single listener
  stopNotifications();

  // Bind static UI events once
  bindStaticEvents();

  hasLoadedOnce = false;

  // Start with skeleton UI and wait for first snapshot before showing states
  renderSkeletons();
  startFirstSnapshotTimeout();
  const startTime = Date.now();

  // Start real-time listener
  try {
    unsubscribe = subscribeToNotifications(
      resolvedUserId,
      (newNotifs) => {
        const firstSnapshot = !hasLoadedOnce;
        if (firstSnapshot) {
          hasLoadedOnce = true;
          clearFirstSnapshotTimeout();
        }

        // Lightweight ID-based differentiation (ID + readStatus)
        const currentIds = newNotifs.map(n => n.id + n.isRead).join(",");
        if (!firstSnapshot && currentIds === prevIds) return; // Skip re-render if unchanged
        prevIds = currentIds;

        notifications = newNotifs.slice(0, 20); // Limit to latest 20 for performance
        
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, 300 - elapsed);
        
        setTimeout(() => handleUpdate(), delay);
      },
      (err) => {
        clearFirstSnapshotTimeout();
        console.error("[NotificationBell] Listener error:", err);
        if (!hasLoadedOnce) {
          renderError(getFriendlyNotificationErrorMessage(err));
        }
      }
    );
  } catch (err) {
    clearFirstSnapshotTimeout();
    console.error("[NotificationBell] Init error:", err);
    if (!hasLoadedOnce) {
      renderError(getFriendlyNotificationErrorMessage(err));
    }
  }
}

/**
 * Stop listeners and clear UI.
 */
export function stopNotifications() {
  if (typeof unsubscribe === "function") {
    unsubscribe();
    unsubscribe = null;
  }
  if (typeof authReadyUnsubscribe === "function") {
    authReadyUnsubscribe();
    authReadyUnsubscribe = null;
  }
  clearFirstSnapshotTimeout();
  hasLoadedOnce = false;
  notifications = [];
  lastUnreadCount = 0;
  prevIds = "";
  clearUI();
}

// ── UI Logic ───────────────────────────────────────────────────────────────

function handleUpdate() {
  const unreadCount = getUnreadCount(notifications);
  
  // Update badge and ping
  updateBadge(unreadCount);
  
  // Render the list
  renderList();
  
  lastUnreadCount = unreadCount;
}

function renderSkeletons() {
  if (!ui.list) return;
  ui.list.innerHTML = Array(3).fill(0).map(() => `
    <div class="notification-item skeleton-pulse" style="pointer-events:none; opacity:0.6;">
      <div class="notification-icon skeleton"></div>
      <div class="notification-body">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    </div>
  `).join("");
}

function renderError(message = "Failed to load notifications") {
  if (!ui.list) return;
  ui.list.innerHTML = `
    <div class="error-state">
      <svg class="error-state-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>${escapeHtml(message)}</p>
      <button class="retry-btn" id="retryNotifBtn">Try Again</button>
    </div>
  `;
  document.getElementById("retryNotifBtn")?.addEventListener("click", () => {
    const activeUid = auth.currentUser?.uid || currentUserId;
    if (activeUid) initNotifications(activeUid);
  });
}

function getFriendlyNotificationErrorMessage(error) {
  const code = String(error?.code || "");
  const rawMessage = String(error?.message || "").toLowerCase();

  if (
    code.includes("failed-precondition")
    && (rawMessage.includes("requires an index") || rawMessage.includes("query requires an index"))
  ) {
    return "Notifications are setting up. Please try again shortly.";
  }

  if (code.includes("permission-denied")) {
    return "You do not have permission to load notifications right now.";
  }

  return "Failed to load notifications";
}

function updateBadge(count) {
  if (!ui.badge || !ui.bellBtn) return;

  if (count > 0) {
    ui.badge.textContent = count > 99 ? "99+" : String(count);
    ui.badge.classList.remove("hidden");
    ui.bellBtn.classList.add("has-unread");

    // Pulse animation ONLY if unread count increased
    if (count > lastUnreadCount) {
      triggerPing();
    }
  } else {
    ui.badge.classList.add("hidden");
    ui.bellBtn.classList.remove("has-unread");
    if (ui.ping) ui.ping.classList.add("hidden");
  }

  // Update footer and filter badges
  if (ui.footerLabel) {
    ui.footerLabel.textContent = `${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`;
  }
  if (ui.unreadFilterBadge) {
    if (count > 0) {
      ui.unreadFilterBadge.textContent = count;
      ui.unreadFilterBadge.style.display = "inline-block";
    } else {
      ui.unreadFilterBadge.style.display = "none";
    }
  }
}

function renderList() {
  if (!ui.list) return;

  const filtered = currentFilter === "unread" 
    ? notifications.filter(n => !n.isRead) 
    : notifications;

  if (filtered.length === 0) {
    ui.list.innerHTML = `
      <div class="notification-empty">
        <div class="notification-empty-icon">🔔</div>
        <p>No ${currentFilter === 'unread' ? 'unread ' : ''}notifications yet</p>
        <span>We'll notify you when something arrives</span>
      </div>
    `;
    return;
  }

  // Simple re-render with stagger entry
  ui.list.innerHTML = "";
  
  filtered.forEach((n, index) => {
    const item = document.createElement("div");
    item.className = `notification-item ${!n.isRead ? "unread" : ""}`;
    item.style.animationDelay = `${index * 0.03}s`;
    
    const timeStr = formatNotificationTime(n.createdAt);
    const icon = ICONS[n.type] || "ℹ️";

    item.innerHTML = `
      <div class="notification-icon type-${n.type || "info"}">${icon}</div>
      <div class="notification-body">
        <p class="notification-title">${escapeHtml(n.title)}</p>
        <p class="notification-message">${escapeHtml(n.message)}</p>
        <span class="notification-time">${escapeHtml(timeStr)}</span>
      </div>
    `;

    item.addEventListener("click", () => {
      if (!n.isRead) {
        item.classList.remove("unread");
        markAsRead(n.id).catch(err => {
          item.classList.add("unread");
          console.error("Mark read error:", err);
        });
      }
    });

    ui.list.appendChild(item);
  });
}

function clearUI() {
  if (closeAnimTimer) {
    clearTimeout(closeAnimTimer);
    closeAnimTimer = null;
  }
  if (ui.badge) ui.badge.classList.add("hidden");
  if (ui.ping) ui.ping.classList.add("hidden");
  if (ui.list) ui.list.innerHTML = "";
  if (ui.unreadFilterBadge) ui.unreadFilterBadge.style.display = "none";
  if (ui.panel) {
    ui.panel.classList.remove("open", "closing");
    ui.panel.setAttribute("aria-hidden", "true");
  }
  if (ui.bellBtn) ui.bellBtn.setAttribute("aria-expanded", "false");
  if (ui.overlay) ui.overlay.classList.remove("show");
}

// ── Interactions ───────────────────────────────────────────────────────────

function bindStaticEvents() {
  // Prevent duplicate binding
  if (window._notifEventsBound) return;
  window._notifEventsBound = true;

  ui.bellBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  ui.overlay?.addEventListener("click", closePanel);

  // Close when clicking outside both the bell and panel.
  document.addEventListener("click", (e) => {
    if (!ui.panel?.classList.contains("open")) return;
    if (!(e.target instanceof Element)) return;
    if (e.target.closest("#notificationPanel") || e.target.closest("#notificationBtn")) return;
    closePanel();
  });
  
  ui.markAllBtn?.addEventListener("click", async () => {
    if (!currentUserId) return;
    try {
      await markAllAsRead(currentUserId);
    } catch (err) {
      console.error("Mark all read error:", err);
    }
  });

  ui.filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      ui.filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.panel?.classList.contains("open")) closePanel();
  });
}

function togglePanel() {
  if (!ui.panel) return;
  const isOpen = ui.panel.classList.contains("open");
  if (isOpen) {
    closePanel();
  } else {
    if (closeAnimTimer) {
      clearTimeout(closeAnimTimer);
      closeAnimTimer = null;
    }
    ui.panel.classList.remove("closing");
    ui.panel.classList.add("open");
    ui.panel.setAttribute("aria-hidden", "false");
    if (ui.bellBtn) ui.bellBtn.setAttribute("aria-expanded", "true");
    if (ui.overlay) ui.overlay.classList.add("show");
  }
}

function closePanel() {
  if (!ui.panel) return;
  if (!ui.panel.classList.contains("open")) return;
  if (closeAnimTimer) clearTimeout(closeAnimTimer);
  ui.panel.classList.remove("open");
  ui.panel.classList.add("closing");
  ui.panel.setAttribute("aria-hidden", "true");
  if (ui.bellBtn) ui.bellBtn.setAttribute("aria-expanded", "false");
  if (ui.overlay) ui.overlay.classList.remove("show");
  closeAnimTimer = setTimeout(() => {
    ui.panel?.classList.remove("closing");
    closeAnimTimer = null;
  }, 220);
}

function waitForAuthThenInit() {
  if (typeof authReadyUnsubscribe === "function") return;
  authReadyUnsubscribe = onAuthStateChanged(auth, (user) => {
    if (!user?.uid) return;
    const uid = user.uid;
    if (typeof authReadyUnsubscribe === "function") {
      authReadyUnsubscribe();
      authReadyUnsubscribe = null;
    }
    initNotifications(uid);
  });
}

function startFirstSnapshotTimeout() {
  clearFirstSnapshotTimeout();
  firstSnapshotTimeoutId = setTimeout(() => {
    if (!hasLoadedOnce) {
      renderError("Notifications are taking longer than expected. Please try again.");
    }
  }, FIRST_SNAPSHOT_TIMEOUT_MS);
}

function clearFirstSnapshotTimeout() {
  if (!firstSnapshotTimeoutId) return;
  clearTimeout(firstSnapshotTimeoutId);
  firstSnapshotTimeoutId = null;
}

function triggerPing() {
  if (!ui.ping) return;
  ui.ping.classList.remove("hidden");
  setTimeout(() => {
    if (ui.ping) ui.ping.classList.add("hidden");
  }, 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
