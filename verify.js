import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const statusText = document.querySelector(".status-text");
const manualBtn = document.getElementById("manualCheckBtn");

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
        statusText.textContent = "Verified! Redirecting...";
        setTimeout(() => {
          window.location.replace("index.html");
        }, 1000);
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
