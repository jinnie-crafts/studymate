import { auth } from "./firebase.js";
import { confirmPasswordReset, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");

// Debug logging for troubleshooting
console.log("Reset URL:", window.location.href);
console.log("Activation Code detected:", oobCode ? "Yes" : "No");

// If no oobCode is present, show error immediately
if (!oobCode || oobCode.length < 20) {
  const msg = document.getElementById("statusMessage");
  if (msg) {
    msg.innerText = "Invalid or missing password reset link. Please request a new one from the Login page.";
    msg.style.color = "#ef4444";
    msg.style.fontWeight = "bold";
  }
}

const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.onclick = async () => {
    if (!oobCode) return;
    
    const newPassword = document.getElementById("newPassword").value;
    const msg = document.getElementById("statusMessage");

    if (!newPassword || newPassword.length < 6) {
      msg.innerText = "Password must be at least 6 characters long.";
      msg.style.color = "#ef4444";
      return;
    }

    try {
      resetBtn.disabled = true;
      resetBtn.innerHTML = `
        <span class="spinner" style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px;"></span>
        Updating...
      `;
      
      await confirmPasswordReset(auth, oobCode, newPassword);
      
      // Success flow
      showResetSuccess(newPassword);

    } catch (error) {
      console.error("Password reset error:", error);
      let errorText = "An error occurred. Please try again.";
      if (error.code === "auth/expired-action-code") errorText = "The reset link has expired. Please request a new one.";
      if (error.code === "auth/invalid-action-code") errorText = "The reset link is invalid. Please request a new one.";
      
      msg.innerText = errorText;
      msg.style.color = "#ef4444";
      resetBtn.innerText = "Update Password";
      resetBtn.disabled = false;
    }
  };
}

function showResetSuccess(newPassword) {
  let target = "login.html";
  let targetLabel = "login";
  const email = localStorage.getItem("resetEmail");
  let autoLoginSuccess = false;

  const performAutoLogin = async () => {
    if (email && newPassword) {
      try {
        await signInWithEmailAndPassword(auth, email, newPassword);
        target = "index.html";
        targetLabel = "dashboard";
        autoLoginSuccess = true;
        localStorage.removeItem("resetEmail");
      } catch (err) {
        console.warn("Auto-login failed:", err);
      }
    }
  };

  performAutoLogin().then(() => {
    document.body.innerHTML = `
      <div class="success-container">
        <div class="success-card">
          <h2>✅ Success!</h2>
          <p>Your password has been reset.</p>
          ${autoLoginSuccess ? "<p><strong>Logging you in automatically...</strong></p>" : ""}
          <p>Redirecting to ${targetLabel} in <strong id="timer">3</strong>s...</p>
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
        window.location.replace(target);
      }
    }, 1000);
  });
}
