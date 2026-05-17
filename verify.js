import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut, applyActionCode } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const statusText = document.querySelector(".status-text");
const subText = document.querySelector(".sub-text");
const manualBtn = document.getElementById("manualCheckBtn");

// ---------------------------------------------------------------------------
// Handle Automatic Verification from Email Link
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");

if (oobCode) {
  statusText.textContent = "Verifying email...";
  applyActionCode(auth, oobCode)
    .then(() => {
      showVerifySuccess();
    })
    .catch((error) => {
      console.error("Verification error:", error);
      let errorMsg = "Invalid or expired verification link.";
      if (error.code === "auth/invalid-action-code") errorMsg = "This link is invalid or has already been used.";
      if (error.code === "auth/expired-action-code") errorMsg = "This verification link has expired.";
      
      statusText.textContent = "Verification Failed";
      statusText.style.color = "#ef4444";
      subText.textContent = errorMsg + " Please request a new one from the signup page.";
    });
}

// ---------------------------------------------------------------------------
// Polling for manual verification status
// ---------------------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  const checkVerification = async () => {
    try {
      await user.reload(); // Force refresh from Firebase servers
      const updatedUser = auth.currentUser;
      const isGoogle = updatedUser.providerData[0]?.providerId === 'google.com';
      
      if (updatedUser.emailVerified || isGoogle) {
        showVerifySuccess();
        return true;
      }
    } catch (err) {
      console.error("Verification check error:", err);
      if (err.code === "auth/too-many-requests") {
        statusText.textContent = "Rate limited. Waiting...";
      }
    }
    return false;
  };

  // Initial check
  const isVerified = await checkVerification();
  if (isVerified) return;

  // Polling every 3 seconds
  const interval = setInterval(async () => {
    const done = await checkVerification();
    if (done) clearInterval(interval);
  }, 3000);

  // Fallback manual button
  if (manualBtn) {
    manualBtn.style.display = "inline-block";
    manualBtn.onclick = async () => {
      const done = await checkVerification();
      if (!done) {
        statusText.textContent = "Still not verified. Please check your email.";
        setTimeout(() => { statusText.textContent = "Checking Verification..."; }, 2000);
      }
    };
  }
});

function showVerifySuccess() {
  document.body.innerHTML = `
    <div class="success-container">
      <div class="success-card">
        <h2>🎉 Email Verified!</h2>
        <p>Your account is now fully activated.</p>
        <p>Redirecting to dashboard in <strong id="timer">3</strong>s...</p>
      </div>
    </div>
  `;

  let time = 3;
  const timerEl = document.getElementById("timer");

  const interval = setInterval(() => {
    time--;
    if (timerEl) timerEl.textContent = time;

    if (time <= 0) {
      clearInterval(interval);
      window.location.replace("index.html");
    }
  }, 1000);
}
