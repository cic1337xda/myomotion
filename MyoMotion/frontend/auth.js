/**
 * ==============================================================================
 * MyoMotion Clinical Authentication Controller (auth.js)
 * ==============================================================================
 * Zero session tokens in localStorage (100% Secure HttpOnly Cookie Architecture).
 * OTP verified registration and password recovery via Resend API.
 * ==============================================================================
 */

function initTheme() {
  const savedTheme = localStorage.getItem("myomotion_theme") || "dark";
  if (savedTheme === "dark") {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem("myomotion_theme", isDark ? "dark" : "light");
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `apple-toast ${type === "success" ? "toast-success" : "toast-error"}`;

  const iconSvg = type === "success"
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--apple-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--apple-red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

  toast.innerHTML = `
    <div style="display:flex; align-items:center;">${iconSvg}</div>
    <span style="flex: 1;">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "all 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function evaluatePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[!@#$%^&*(),.?":{}|<>\-_+=\[\]\\/]/.test(password)) score++;
  return score;
}

function updateStrengthMeter(password, barEl, textEl) {
  if (!barEl || !textEl) return;
  const score = evaluatePasswordStrength(password);
  const colors = ["#E5E7EB", "#FF3B30", "#FF9500", "#34C759", "#0A84FF"];
  const labels = ["Too weak", "Weak", "Moderate", "Good", "Strong & Secure"];

  barEl.style.backgroundColor = colors[Math.min(score, 4)];
  barEl.style.width = `${(score / 5) * 100}%`;
  textEl.textContent = password.length > 0 ? labels[Math.min(score, 4)] : "";
}

let pendingRegData = null;

function switchView(viewName) {
  const views = ["login-view", "register-view", "otp-view", "forgot-view", "reset-view"];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = "none";
  });

  const activeEl = document.getElementById(`${viewName}-view`);
  if (activeEl) activeEl.style.display = "block";
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();

  const yrEl = document.getElementById("copyright-year");
  if (yrEl) yrEl.textContent = new Date().getFullYear();

  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  // 1. Password input meter hooks
  const regPwd = document.getElementById("reg-password");
  const regBar = document.getElementById("reg-strength-bar");
  const regText = document.getElementById("reg-strength-text");
  if (regPwd) {
    regPwd.addEventListener("input", (e) => updateStrengthMeter(e.target.value, regBar, regText));
  }

  const resetPwd = document.getElementById("reset-new-password");
  const resetBar = document.getElementById("reset-strength-bar");
  const resetText = document.getElementById("reset-strength-text");
  if (resetPwd) {
    resetPwd.addEventListener("input", (e) => updateStrengthMeter(e.target.value, resetBar, resetText));
  }

  // 2. Direct Login
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      const btn = document.getElementById("login-submit-btn");

      btn.disabled = true;
      btn.textContent = "Authenticating...";

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Authentication failed.");

        showToast("Signed in successfully. Redirecting...", "success");
        setTimeout(() => {
          window.location.href = "/";
        }, 800);
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Sign In";
      }
    });
  }

  // 3. Register: Step 1 (Trigger 6-digit OTP dispatch)
  const regForm = document.getElementById("register-form");
  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("reg-username").value.trim();
      const email = document.getElementById("reg-email").value.trim();
      const password = document.getElementById("reg-password").value;

      if (evaluatePasswordStrength(password) < 3) {
        showToast("Please choose a stronger password (include numbers and symbols).", "error");
        return;
      }

      const btn = document.getElementById("reg-submit-btn");
      btn.disabled = true;
      btn.textContent = "Sending Verification Code...";

      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, purpose: "register" })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Failed to dispatch code.");

        pendingRegData = { username, email, password };
        const targetEl = document.getElementById("otp-target-email");
        if (targetEl) targetEl.textContent = email;

        showToast("Verification code dispatched via Resend to your inbox!", "success");
        switchView("otp");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Continue";
      }
    });
  }

  // 4. Register: Step 2 (Verify OTP & Complete Registration)
  const otpForm = document.getElementById("otp-form");
  if (otpForm) {
    otpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const otp = document.getElementById("otp-input").value.trim();
      if (!pendingRegData) {
        showToast("Session expired. Please restart registration.", "error");
        switchView("register");
        return;
      }

      const btn = document.getElementById("otp-submit-btn");
      btn.disabled = true;
      btn.textContent = "Verifying...";

      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: pendingRegData.username,
            email: pendingRegData.email,
            password: pendingRegData.password,
            otp: otp
          })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || "Verification failed.");

        showToast("Account activated successfully! Entering MyoMotion...", "success");
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Activate & Enter";
      }
    });
  }

  // Resend OTP button
  const resendBtn = document.getElementById("resend-otp-btn");
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      if (!pendingRegData) return;
      resendBtn.disabled = true;
      resendBtn.textContent = "Resending...";
      try {
        const res = await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: pendingRegData.email, purpose: "register" })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to resend code.");
        showToast("New code dispatched!", "success");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend Code";
      }
    });
  }

  // 5. Password Recovery
  const forgotForm = document.getElementById("forgot-form");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("forgot-email").value.trim();
      const btn = document.getElementById("forgot-submit-btn");
      btn.disabled = true;
      btn.textContent = "Sending...";

      try {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Request failed.");

        const resetEmailField = document.getElementById("reset-email-hidden");
        if (resetEmailField) resetEmailField.value = email;

        showToast("Recovery code sent to your email.", "success");
        switchView("reset");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Recovery Code";
      }
    });
  }

  const resetForm = document.getElementById("reset-form");
  if (resetForm) {
    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("reset-email-hidden").value.trim();
      const otp = document.getElementById("reset-otp-code").value.trim();
      const new_password = document.getElementById("reset-new-password").value;

      const btn = document.getElementById("reset-submit-btn");
      btn.disabled = true;
      btn.textContent = "Updating...";

      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, otp, new_password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Reset failed.");

        showToast("Password updated! Please sign in with your new password.", "success");
        switchView("login");
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Save Password";
      }
    });
  }
});
