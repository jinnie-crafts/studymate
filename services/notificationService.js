// ---------------------------------------------------------------------------
// notificationService.js — Firestore-backed notification system for StudyMate AI
// ---------------------------------------------------------------------------
// Collection: notifications/
// Document schema:
//   {
//     userId:    string,
//     title:     string,
//     message:   string,
//     type:      "info" | "success" | "warning",
//     isRead:    boolean,
//     createdAt: Firestore Timestamp
//   }
//
// Security: All queries filter by userId so Firestore rules can enforce
//           `request.auth.uid == resource.data.userId`.
// ---------------------------------------------------------------------------

import { db, functions } from "../firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Constants ──────────────────────────────────────────────────────────────
const COLLECTION_NAME = "notifications";
const VALID_TYPES = new Set(["info", "success", "warning"]);
const MAX_NOTIFICATIONS = 50; // Max fetched per user at a time

function isMissingIndexError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code.includes("failed-precondition")
    && (message.includes("requires an index") || message.includes("query requires an index"));
}

function createdAtToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => createdAtToMillis(b.createdAt) - createdAtToMillis(a.createdAt));
}

// ── Admin Functions ────────────────────────────────────────────────────────

/**
 * Execute the backend Cloud Function to securely send or broadcast a notification.
 * Requires the acting user to possess the `{ admin: true }` custom claim.
 * 
 * @param {Object} data 
 * @param {string} data.title - Notification title
 * @param {string} data.message - Notification message
 * @param {"info"|"success"|"warning"} data.type - Notification type
 * @param {string} [data.targetUid] - Specific user UID. If absent, broadcasts to all.
 * @returns {Promise<{success: boolean, detail?: string}>}
 */
export async function sendAdminNotification(data) {
  try {
    const sendFn = httpsCallable(functions, "sendNotification");
    console.log("[NotificationService] Calling sendNotification with:", data);
    const result = await sendFn(data);
    console.log("[NotificationService] sendNotification response:", result?.data);
    return result?.data ?? { success: true };
  } catch (error) {
    console.error("[NotificationService] Admin send error:", error);
    console.error("[NotificationService]   → code:", error?.code);
    console.error("[NotificationService]   → message:", error?.message);
    console.error("[NotificationService]   → details:", error?.details);

    // Map Firebase error codes to actionable user-friendly messages
    const code = String(error?.code || "").toLowerCase();
    let detail;

    if (code.includes("not-found") || code.includes("internal")) {
      detail =
        "Cloud Function not reachable. Please ensure 'sendNotification' is deployed " +
        "(run: firebase deploy --only functions) and the region matches (asia-south1).";
    } else if (code.includes("unauthenticated")) {
      detail = "You must be logged in to send notifications.";
    } else if (code.includes("permission-denied")) {
      detail =
        (typeof error?.message === "string" && error.message) ||
        "Admin privileges required. Run: node scripts/setAdmin.js <YOUR_UID>";
    } else if (code.includes("invalid-argument")) {
      detail =
        (typeof error?.details === "string" && error.details) ||
        (typeof error?.message === "string" && error.message) ||
        "Invalid input provided.";
    } else {
      detail =
        (typeof error?.details === "string" && error.details) ||
        (typeof error?.message === "string" && error.message) ||
        "Failed to send notification.";
    }

    const normalizedError = new Error(detail);
    normalizedError.code = error?.code || "unknown";
    normalizedError.cause = error;
    throw normalizedError;
  }
}

// ── Create ─────────────────────────────────────────────────────────────────

/**
 * Create a new notification for a given user.
 *
 * @param {string}   userId  - Firebase Auth UID
 * @param {string}   title   - Short notification title
 * @param {string}   message - Notification body
 * @param {"info"|"success"|"warning"} type - Notification type
 * @returns {Promise<string>} Firestore document ID of the new notification
 */
export async function createNotification(userId, title, message, type = "info") {
  if (!userId || typeof userId !== "string") {
    throw new Error("[NotificationService] userId is required.");
  }
  if (!title || typeof title !== "string") {
    throw new Error("[NotificationService] title is required.");
  }
  if (!message || typeof message !== "string") {
    throw new Error("[NotificationService] message is required.");
  }

  const normalizedType = VALID_TYPES.has(type) ? type : "info";

  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    userId,
    title: title.trim(),
    message: message.trim(),
    type: normalizedType,
    isRead: false,
    createdAt: serverTimestamp(),
  });

  return docRef.id;
}

// ── Read (one-shot) ────────────────────────────────────────────────────────

/**
 * Fetch all notifications for a user (most recent first), up to MAX_NOTIFICATIONS.
 *
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<Array<{id: string, userId: string, title: string, message: string,
 *           type: string, isRead: boolean, createdAt: any}>>}
 */
export async function getUserNotifications(userId) {
  if (!userId) return [];

  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(MAX_NOTIFICATIONS)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;

    console.warn("[NotificationService] Missing composite index; using fallback query.", error);
    const fallbackQuery = query(
      collection(db, COLLECTION_NAME),
      where("userId", "==", userId),
      limit(MAX_NOTIFICATIONS)
    );
    const fallbackSnapshot = await getDocs(fallbackQuery);
    const fallbackItems = fallbackSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return sortByCreatedAtDesc(fallbackItems);
  }
}

// ── Read (real-time) ───────────────────────────────────────────────────────

/**
 * Subscribe to real-time notification updates for a user.
 * Returns an unsubscribe function.
 *
 * @param {string}   userId   - Firebase Auth UID
 * @param {Function} callback - Called with (notifications[]) on every change
 * @param {Function} [onError] - Called with (error) on listener error
 * @returns {Function} Unsubscribe function
 */
export function subscribeToNotifications(userId, callback, onError) {
  if (!userId || typeof callback !== "function") {
    console.warn("[NotificationService] subscribeToNotifications: invalid args");
    return () => {};
  }

  let activeUnsubscribe = () => {};
  let usingFallbackQuery = false;

  const attachListener = (fallbackMode = false) => {
    usingFallbackQuery = fallbackMode;

    const constraints = fallbackMode
      ? [where("userId", "==", userId), limit(MAX_NOTIFICATIONS)]
      : [where("userId", "==", userId), orderBy("createdAt", "desc"), limit(MAX_NOTIFICATIONS)];

    const q = query(collection(db, COLLECTION_NAME), ...constraints);

    activeUnsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        callback(usingFallbackQuery ? sortByCreatedAtDesc(docs) : docs);
      },
      (error) => {
        if (!fallbackMode && isMissingIndexError(error)) {
          console.warn("[NotificationService] Missing index for realtime notifications; switching to fallback query.", error);
          try {
            activeUnsubscribe();
          } catch (_) {
            // no-op
          }
          attachListener(true);
          return;
        }
        console.error("[NotificationService] Realtime listener error:", error);
        if (typeof onError === "function") onError(error);
      }
    );
  };

  attachListener(false);

  return () => {
    try {
      activeUnsubscribe();
    } catch (_) {
      // no-op
    }
    activeUnsubscribe = () => {};
  };
}

// ── Update ─────────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 *
 * @param {string} notificationId - Firestore document ID
 * @returns {Promise<void>}
 */
export async function markAsRead(notificationId) {
  if (!notificationId) {
    throw new Error("[NotificationService] notificationId is required.");
  }
  const docRef = doc(db, COLLECTION_NAME, notificationId);
  await updateDoc(docRef, { isRead: true });
}

/**
 * Mark ALL notifications for a user as read (batched write).
 *
 * @param {string} userId - Firebase Auth UID
 * @returns {Promise<number>} Number of notifications marked as read
 */
export async function markAllAsRead(userId) {
  if (!userId) return 0;

  const q = query(
    collection(db, COLLECTION_NAME),
    where("userId", "==", userId),
    where("isRead", "==", false)
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return 0;

  // Firestore batches support up to 500 writes
  const batch = writeBatch(db);
  snapshot.docs.forEach((d) => {
    batch.update(doc(db, COLLECTION_NAME, d.id), { isRead: true });
  });
  await batch.commit();

  return snapshot.size;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the count of unread notifications for a user.
 *
 * @param {Array} notifications - Array of notification objects
 * @returns {number}
 */
export function getUnreadCount(notifications) {
  if (!Array.isArray(notifications)) return 0;
  return notifications.filter((n) => !n.isRead).length;
}

/**
 * Format a Firestore timestamp to a human-readable relative time string.
 *
 * @param {any} timestamp - Firestore Timestamp or Date
 * @returns {string} e.g. "2 min ago", "3 hours ago", "Yesterday"
 */
export function formatNotificationTime(timestamp) {
  if (!timestamp) return "";
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
