import { auth } from "./firebase.js";
import { confirmPasswordReset } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
      resetBtn.innerText = "Updating...";
      await confirmPasswordReset(auth, oobCode, newPassword);
      
      msg.innerText = "Password updated successfully! Redirecting to login...";
      msg.style.color = "#4ade80"; 
      
      setTimeout(() => {
        window.location.replace("login.html");
      }, 3000);

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
