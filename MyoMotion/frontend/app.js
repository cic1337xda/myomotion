/**
 * ==============================================================================
 * MyoMotion Interactive Application Controller (app.js)
 * ==============================================================================
 * Real-time WebSocket biomechanics telemetry dispatcher, calibration engine,
 * clinical session manager, and device lifecycle controller.
 * ==============================================================================
 */

// Global State
let currentUser = null;
let currentDeviceMac = "";
let currentMode = "elbow"; // "elbow" | "wrist"
let wsConnection = null;
let activeSessionId = null;
let sessionStartTime = null;
let sessionTimerInterval = null;

// Calibrated Elbow Curl ROM boundaries (Straight = min, Max Flex = max)
let elbowLimits = {
  min: parseFloat(localStorage.getItem("myomotion_elbow_min")) || 0.0,
  max: parseFloat(localStorage.getItem("myomotion_elbow_max")) || 120.0
};

// Calibrated Wrist Curl ROM boundaries (Bottom = lowest, Top = highest)
let wristLimits = {
  bottom: parseFloat(localStorage.getItem("myomotion_wrist_bottom")) || -40.0,
  top: parseFloat(localStorage.getItem("myomotion_wrist_top")) || 40.0
};

// Minimum %MVC required during a curl to verify active muscle engagement
const EMG_REP_THRESHOLD = 20.0;

// Session Tracking Peak Metrics
let sessionMetrics = {
  maxFlexion: 0.0,
  maxExtension: 0.0,
  peakMvc: 0.0,
  emgSum: 0.0,
  emgCount: 0,
  reps: 0,
  repState: "waiting_straight", // Elbow: "waiting_straight"|"at_straight"|"at_max"; Wrist: "waiting_bottom"|"at_bottom"|"at_top"
  peakEmgInRep: 0.0
};

// Oscilloscope buffer
const emgHistory = new Array(120).fill(0);

// Initialize Theme
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

// Check session authentication on load
async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      if (!window.location.pathname.includes("login")) {
        window.location.href = "/login";
      }
      return null;
    }
    const user = await res.json();
    currentUser = user;

    // Populate sidebar user details
    const userNameEl = document.getElementById("sidebar-user-name");
    const userRoleEl = document.getElementById("sidebar-user-role");
    if (userNameEl) userNameEl.textContent = user.username;
    if (userRoleEl) userRoleEl.textContent = user.is_admin ? "Clinical Admin" : "Patient";

    return user;
  } catch (err) {
    if (!window.location.pathname.includes("login")) {
      window.location.href = "/login";
    }
    return null;
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {}
  showToast("Session closed.", "success");
  setTimeout(() => {
    window.location.href = "/login";
  }, 500);
}

// WebSocket Live Telemetry Stream
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

  wsConnection = new WebSocket(wsUrl);

  wsConnection.onopen = () => {
    console.log("[WS] Telemetry pipe established.");
    checkCurrentDeviceStatus();
  };

  wsConnection.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "telemetry") {
        if (!currentDeviceMac || currentDeviceMac === msg.mac) {
          handleIncomingTelemetry(msg.mac, msg.data);
        }
      } else if (msg.type === "device_status") {
        if (!currentDeviceMac || currentDeviceMac === msg.mac) {
          updateDeviceStatusBadge(msg.is_online, msg.is_online ? "Hardware Connected" : "Sensor Offline");
        }
      }
    } catch (e) {}
  };

  wsConnection.onclose = () => {
    console.log("[WS] Pipe disconnected. Reconnecting in 3s...");
    updateDeviceStatusBadge(false, "Server Reconnecting...");
    setTimeout(connectWebSocket, 3000);
  };

  wsConnection.onerror = () => {
    updateDeviceStatusBadge(false, "Server Disconnected");
  };
}

async function checkCurrentDeviceStatus() {
  if (!currentDeviceMac) {
    updateDeviceStatusBadge(false, "No Device Selected");
    return;
  }
  try {
    const res = await fetch(`/api/devices/${currentDeviceMac}/status`);
    if (res.ok) {
      const data = await res.json();
      updateDeviceStatusBadge(data.is_online, data.is_online ? "Hardware Connected" : "Sensor Offline");
    } else {
      updateDeviceStatusBadge(false, "Sensor Offline");
    }
  } catch (e) {
    updateDeviceStatusBadge(false, "Sensor Offline");
  }
}

function updateDeviceStatusBadge(isOnline, customText = "") {
  const dot = document.getElementById("device-status-dot");
  const text = document.getElementById("device-status-text");
  if (!dot || !text) return;

  if (isOnline) {
    dot.className = "status-dot online";
    text.textContent = customText || "Hardware Connected";
  } else {
    dot.className = "status-dot offline";
    text.textContent = customText || (currentDeviceMac ? "Sensor Offline" : "No Device Selected");
  }
}

function updateElbowBoundsUI() {
  const boundsEl = document.getElementById("elbow-rom-bounds");
  if (boundsEl) {
    boundsEl.textContent = `${elbowLimits.min.toFixed(1)}° → ${elbowLimits.max.toFixed(1)}°`;
  }
  if (window.armRenderer) {
    window.armRenderer.setElbowLimits(elbowLimits.min, elbowLimits.max);
  }
}

function updateWristBoundsUI() {
  const boundsEl = document.getElementById("wrist-rom-bounds");
  if (boundsEl) {
    boundsEl.textContent = `${wristLimits.bottom.toFixed(1)}° → ${wristLimits.top >= 0 ? "+" : ""}${wristLimits.top.toFixed(1)}°`;
  }
  if (window.armRenderer) {
    window.armRenderer.setWristLimits(wristLimits.bottom, wristLimits.top);
  }
}

function handleIncomingTelemetry(mac, data) {
  updateDeviceStatusBadge(data.is_online, data.is_online ? "Hardware Connected" : "Sensor Offline");

  // Sync calibrated Elbow Straight/Max Flex limits from hardware telemetry if present
  if (typeof data.elbow_min === "number" && typeof data.elbow_max === "number") {
    elbowLimits.min = data.elbow_min;
    elbowLimits.max = data.elbow_max;
    localStorage.setItem("myomotion_elbow_min", String(elbowLimits.min));
    localStorage.setItem("myomotion_elbow_max", String(elbowLimits.max));
    updateElbowBoundsUI();
  }

  // Sync calibrated Wrist Bottom/Top limits from hardware telemetry if present
  if (typeof data.bottom === "number" && typeof data.top === "number") {
    wristLimits.bottom = data.bottom;
    wristLimits.top = data.top;
    localStorage.setItem("myomotion_wrist_bottom", String(wristLimits.bottom));
    localStorage.setItem("myomotion_wrist_top", String(wristLimits.top));
    updateWristBoundsUI();
  }

  // Update canvas renderer if available
  if (window.armRenderer) {
    window.armRenderer.updateData(data);
  }

  // Update HUD Metrics
  const angle = data.angle || 0;
  const pitch = data.pitch || 0;
  const raw = data.raw || 0;
  const percent = data.percent !== null && data.percent !== undefined ? data.percent : 0;
  const mvc = data.mvc || 0;

  // DOM Elements
  const angleValEl = document.getElementById("hud-primary-angle");
  const angleLabelEl = document.getElementById("hud-primary-angle-label");
  const subAngleValEl = document.getElementById("hud-secondary-angle");
  const emgPercentEl = document.getElementById("hud-emg-percent");
  const emgRawEl = document.getElementById("hud-emg-raw");
  const mvcValEl = document.getElementById("hud-mvc-peak");
  const repStatusEl = document.getElementById("hud-rep-status");

  if (currentMode === "elbow") {
    const elbowSpan = elbowLimits.max - elbowLimits.min;
    const elbowPct = Math.abs(elbowSpan) >= 5.0
      ? Math.max(0, Math.min(100, ((angle - elbowLimits.min) / elbowSpan) * 100))
      : 0;
    if (angleValEl) angleValEl.textContent = `${angle.toFixed(1)}°`;
    if (angleLabelEl) angleLabelEl.textContent = "Elbow Curl Angle";
    if (subAngleValEl) subAngleValEl.textContent = `Curl Progress: ${Math.round(elbowPct)}% (${elbowLimits.min.toFixed(0)}° → ${elbowLimits.max.toFixed(0)}°)`;
  } else {
    const romSpan = wristLimits.top - wristLimits.bottom;
    const progressPct = Math.abs(romSpan) >= 5.0
      ? Math.max(0, Math.min(100, ((pitch - wristLimits.bottom) / romSpan) * 100))
      : 50;
    if (angleValEl) angleValEl.textContent = `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`;
    if (angleLabelEl) angleLabelEl.textContent = "Wrist Curl Angle (Sagittal)";
    if (subAngleValEl) subAngleValEl.textContent = `Curl Progress: ${Math.round(progressPct)}% (${wristLimits.bottom.toFixed(0)}° → ${wristLimits.top.toFixed(0)}°)`;
  }

  if (emgPercentEl) emgPercentEl.textContent = `${Math.round(percent)}%`;
  if (emgRawEl) emgRawEl.textContent = `Raw ADC: ${raw}`;
  if (mvcValEl) mvcValEl.textContent = `MVC: ${Math.round(mvc)}`;

  // Push to oscilloscope buffer
  emgHistory.push(percent);
  emgHistory.shift();
  drawOscilloscope();

  // If session is active, accumulate clinical metrics & run Rep State Machine
  if (activeSessionId) {
    if (currentMode === "elbow") {
      // Elbow Curl Rep State Machine: Straight (<=25% ROM) -> Max Flex (>=75% ROM + EMG >=20%) = +1 Rep
      if (angle > sessionMetrics.maxFlexion) sessionMetrics.maxFlexion = angle;
      if (angle < sessionMetrics.maxExtension) sessionMetrics.maxExtension = angle;

      const span = elbowLimits.max - elbowLimits.min;
      const effectiveSpan = Math.abs(span) >= 10.0 ? span : 120.0;
      const effectiveMin = Math.abs(span) >= 10.0 ? elbowLimits.min : 0.0;
      const progress = (angle - effectiveMin) / effectiveSpan;

      if (sessionMetrics.repState === "waiting_straight" || sessionMetrics.repState === "at_max") {
        if (progress <= 0.25) {
          sessionMetrics.repState = "at_straight";
          sessionMetrics.peakEmgInRep = percent;
          if (repStatusEl) repStatusEl.textContent = `Straight ✓ — Curl UP to Max Flex + Biceps EMG ≥ ${EMG_REP_THRESHOLD}% ↑`;
        } else if (sessionMetrics.repState === "waiting_straight") {
          if (repStatusEl) repStatusEl.textContent = `Straighten arm to Min position to start →`;
        }
      } else if (sessionMetrics.repState === "at_straight") {
        if (percent > sessionMetrics.peakEmgInRep) sessionMetrics.peakEmgInRep = percent;

        if (progress >= 0.75) {
          if (sessionMetrics.peakEmgInRep >= EMG_REP_THRESHOLD) {
            sessionMetrics.reps++;
            sessionMetrics.repState = "at_max";
            const repsEl = document.getElementById("hud-reps-count");
            if (repsEl) repsEl.textContent = sessionMetrics.reps;
            if (repStatusEl) repStatusEl.textContent = `Rep #${sessionMetrics.reps} counted! Straighten arm back down →`;
          } else {
            if (repStatusEl) repStatusEl.textContent = `At Max Flex — engage Biceps ≥ ${EMG_REP_THRESHOLD}% MVC!`;
          }
        }
      }
    } else {
      // Wrist Curl Rep State Machine: Bottom (<=25% ROM) -> Top (>=75% ROM + EMG >=20%) = +1 Rep
      if (pitch > sessionMetrics.maxFlexion) sessionMetrics.maxFlexion = pitch;
      if (pitch < sessionMetrics.maxExtension) sessionMetrics.maxExtension = pitch;

      const span = wristLimits.top - wristLimits.bottom;
      const effectiveSpan = Math.abs(span) >= 10.0 ? span : 80.0;
      const effectiveBottom = Math.abs(span) >= 10.0 ? wristLimits.bottom : -40.0;
      const progress = (pitch - effectiveBottom) / effectiveSpan;

      if (sessionMetrics.repState === "waiting_bottom" || sessionMetrics.repState === "at_top") {
        if (progress <= 0.25) {
          sessionMetrics.repState = "at_bottom";
          sessionMetrics.peakEmgInRep = percent;
          if (repStatusEl) repStatusEl.textContent = `Bottom ✓ — Curl UP to Top + Forearm EMG ≥ ${EMG_REP_THRESHOLD}% ↑`;
        } else if (sessionMetrics.repState === "waiting_bottom") {
          if (repStatusEl) repStatusEl.textContent = `Lower wrist to Bottom position to start ↓`;
        }
      } else if (sessionMetrics.repState === "at_bottom") {
        if (percent > sessionMetrics.peakEmgInRep) sessionMetrics.peakEmgInRep = percent;

        if (progress >= 0.75) {
          if (sessionMetrics.peakEmgInRep >= EMG_REP_THRESHOLD) {
            sessionMetrics.reps++;
            sessionMetrics.repState = "at_top";
            const repsEl = document.getElementById("hud-reps-count");
            if (repsEl) repsEl.textContent = sessionMetrics.reps;
            if (repStatusEl) repStatusEl.textContent = `Rep #${sessionMetrics.reps} counted! Lower back to Bottom ↓`;
          } else {
            if (repStatusEl) repStatusEl.textContent = `At Top — squeeze Forearm ≥ ${EMG_REP_THRESHOLD}% MVC!`;
          }
        }
      }
    }

    if (percent > sessionMetrics.peakMvc) sessionMetrics.peakMvc = percent;
    sessionMetrics.emgSum += percent;
    sessionMetrics.emgCount++;
  }
}

// Oscilloscope Canvas Visualizer
function drawOscilloscope() {
  const canvas = document.getElementById("emg-oscilloscope");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const isDark = document.body.classList.contains("dark");
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  ctx.lineWidth = 1;

  // Grid
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Waveform
  ctx.beginPath();
  const step = w / (emgHistory.length - 1);
  for (let i = 0; i < emgHistory.length; i++) {
    const val = emgHistory[i];
    // Map 0 - 120% MVC to canvas height
    const y = h - (val / 120.0) * (h - 20) - 10;
    const x = i * step;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = "#32D74B";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // Gradient fill under curve
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(50, 215, 75, 0.25)");
  grad.addColorStop(1, "rgba(50, 215, 75, 0.0)");
  ctx.fillStyle = grad;
  ctx.fill();
}

// Mode Selection Handler
function switchRehabMode(mode, silent = false) {
  currentMode = mode.toLowerCase() === "wrist" ? "wrist" : "elbow";
  if (window.armRenderer) {
    window.armRenderer.setMode(currentMode);
  }

  // Update Segmented buttons
  document.querySelectorAll(".segmented-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });

  // Toggle Elbow Straight/Max vs Wrist Bottom/Top calibration bars
  const elbowCalBar = document.getElementById("elbow-rom-calibration");
  const wristCalBar = document.getElementById("wrist-rom-calibration");
  if (elbowCalBar) {
    elbowCalBar.style.display = currentMode === "elbow" ? "flex" : "none";
  }
  if (wristCalBar) {
    wristCalBar.style.display = currentMode === "wrist" ? "flex" : "none";
  }
  updateElbowBoundsUI();
  updateWristBoundsUI();

  // Dispatch MQTT pipeline switch command to ESP32
  if (currentDeviceMac) {
    dispatchCommand(`mode:${currentMode}`);
  }

  if (!silent) {
    showToast(`Switched pipeline to ${currentMode === "wrist" ? "WRIST CURL" : "ELBOW CURL"} mode.`, "success");
  }
}

// Command Dispatcher (Tare, Wrist Bottom/Top, Calibrate, Baseline, Reset)
async function dispatchCommand(cmd) {
  if (!currentDeviceMac) {
    showToast("Please select or add a device in Settings first.", "error");
    return;
  }

  try {
    const res = await fetch("/api/devices/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mac_address: currentDeviceMac,
        command: cmd
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Command failed.");

    if (cmd === "tare") {
      showToast("Baseline angle zeroed (0°).", "success");
    } else if (cmd === "elbow:min") {
      showToast("Elbow STRAIGHT (Min) position calibrated!", "success");
    } else if (cmd === "elbow:max") {
      showToast("Elbow MAX FLEX (Max) position calibrated!", "success");
    } else if (cmd === "elbow:reset") {
      elbowLimits.min = 0.0;
      elbowLimits.max = 120.0;
      localStorage.setItem("myomotion_elbow_min", "0");
      localStorage.setItem("myomotion_elbow_max", "120");
      updateElbowBoundsUI();
      showToast("Elbow Straight/Max limits reset to 0° / 120°.", "success");
    } else if (cmd === "wrist:bottom") {
      showToast("Wrist Curl BOTTOM (lowest) position calibrated!", "success");
    } else if (cmd === "wrist:top") {
      showToast("Wrist Curl TOP (highest) position calibrated!", "success");
    } else if (cmd === "wrist:reset") {
      wristLimits.bottom = -40.0;
      wristLimits.top = 40.0;
      localStorage.setItem("myomotion_wrist_bottom", "-40");
      localStorage.setItem("myomotion_wrist_top", "40");
      updateWristBoundsUI();
      showToast("Wrist Curl Bottom/Top limits reset to -40° / +40°.", "success");
    } else if (cmd === "calibrate") {
      showToast("MVC Calibration initiated! Flex & squeeze maximum contraction for 3 seconds!", "success");
    } else if (cmd === "baseline") {
      showToast("MyoWare RELAX baseline (0%) captured.", "success");
    } else if (cmd === "reset") {
      showToast("MyoWare calibration reset.", "success");
    } else {
      showToast(`Command '${cmd}' acknowledged by hardware.`, "success");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Session Lifecycle (Start & Stop)
async function startSession() {
  if (activeSessionId) return;

  const patientName = document.getElementById("session-patient-name")?.value || currentUser?.username || "Self";
  const startBtn = document.getElementById("session-start-btn");
  const stopBtn = document.getElementById("session-stop-btn");

  try {
    const res = await fetch("/api/rehab/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_joint: currentMode,
        patient_name: patientName,
        device_mac: currentDeviceMac || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to start session.");

    activeSessionId = data.session_id;
    sessionStartTime = new Date();

    // Reset trackers
    sessionMetrics = {
      maxFlexion: currentMode === "wrist" ? -90.0 : 0.0,
      maxExtension: 180.0,
      peakMvc: 0.0,
      emgSum: 0.0,
      emgCount: 0,
      reps: 0,
      repState: currentMode === "wrist" ? "waiting_bottom" : "waiting_straight",
      peakEmgInRep: 0.0
    };

    const repsEl = document.getElementById("hud-reps-count");
    if (repsEl) repsEl.textContent = "0";
    const repStatusEl = document.getElementById("hud-rep-status");
    if (repStatusEl) {
      repStatusEl.textContent = currentMode === "wrist"
        ? "Lower wrist to Bottom position to start ↓"
        : "Straighten arm to Min position to start →";
    }

    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "inline-flex";

    // Timer interval
    const timerEl = document.getElementById("session-timer");
    sessionTimerInterval = setInterval(() => {
      const elapsed = Math.floor((new Date() - sessionStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const secs = String(elapsed % 60).padStart(2, "0");
      if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);

    showToast(`Rehabilitation Session #${activeSessionId} started!`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function stopSession() {
  if (!activeSessionId) return;

  const startBtn = document.getElementById("session-start-btn");
  const stopBtn = document.getElementById("session-stop-btn");
  clearInterval(sessionTimerInterval);

  const durationSec = Math.max(1, Math.floor((new Date() - sessionStartTime) / 1000));
  const avgMvc = sessionMetrics.emgCount > 0 ? (sessionMetrics.emgSum / sessionMetrics.emgCount) : 0.0;

  try {
    const res = await fetch("/api/rehab/session/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: activeSessionId,
        duration_seconds: durationSec,
        max_flexion_deg: sessionMetrics.maxFlexion === -90.0 ? 0.0 : sessionMetrics.maxFlexion,
        max_extension_deg: sessionMetrics.maxExtension === 180.0 ? 0.0 : sessionMetrics.maxExtension,
        peak_emg_mvc: sessionMetrics.peakMvc,
        avg_emg_mvc: avgMvc,
        reps_count: sessionMetrics.reps
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to commit session.");

    showToast(`Session #${activeSessionId} completed & archived! Total Reps: ${sessionMetrics.reps}`, "success");
    activeSessionId = null;

    if (startBtn) startBtn.style.display = "inline-flex";
    if (stopBtn) stopBtn.style.display = "none";
    const timerEl = document.getElementById("session-timer");
    if (timerEl) timerEl.textContent = "00:00";
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Device Management for Settings Page
async function loadUserDevices() {
  const container = document.getElementById("devices-list-container");
  if (!container) return;

  try {
    const res = await fetch("/api/devices");
    const devices = await res.json();
    if (!res.ok) throw new Error(devices.detail || "Failed to fetch devices.");

    container.innerHTML = "";
    if (devices.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
          No hardware nodes registered. Enter your ESP32 MAC address below.
        </div>`;
      return;
    }

    devices.forEach((d) => {
      // Pick the first device as active if none set
      if (!currentDeviceMac) currentDeviceMac = d.mac_address;

      const card = document.createElement("div");
      card.className = "user-card";
      card.style.flexDirection = "row";
      card.style.alignItems = "center";
      card.style.justifyContent = "space-between";
      card.style.padding = "14px 18px";

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="status-dot ${d.is_online ? "online" : "offline"}"></div>
          <div>
            <div style="font-size:14px; font-weight:700;">${d.device_name}</div>
            <div style="font-size:11px; color:var(--text-tertiary); font-family:monospace;">${d.mac_address}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="user-role-badge" style="background:${d.is_online ? "rgba(50,215,75,0.15)" : "rgba(255,59,48,0.15)"}; color:${d.is_online ? "var(--apple-green)" : "var(--apple-red)"};">
            ${d.is_online ? "ONLINE" : "OFFLINE"}
          </span>
          <button class="liquid-btn" onclick="selectActiveDevice('${d.mac_address}')" style="padding:6px 12px; font-size:12px;">
            ${currentDeviceMac === d.mac_address ? "Active" : "Select"}
          </button>
          <button class="liquid-btn liquid-btn-danger" onclick="deleteDevice(${d.id})" style="padding:6px 10px; font-size:12px;">
            &times;
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

function selectActiveDevice(mac) {
  currentDeviceMac = mac;
  localStorage.setItem("myomotion_active_mac", mac);
  loadUserDevices();
  showToast(`Device ${mac} designated as active sensor node.`, "success");
}

async function addDeviceHandler(e) {
  e.preventDefault();
  const input = document.getElementById("add-device-mac");
  const nameInput = document.getElementById("add-device-name");
  const rawMac = input.value.trim();
  const name = nameInput?.value.trim() || "MyoMotion Sensor Node";

  if (!rawMac) {
    showToast("Please enter a valid MAC address.", "error");
    return;
  }

  try {
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mac_address: rawMac, device_name: name })
    });
    const device = await res.json();
    if (!res.ok) throw new Error(device.detail || "Failed to register node.");

    input.value = "";
    if (nameInput) nameInput.value = "";

    // Check device live status
    if (device.is_online) {
      showToast(`Device ${device.mac_address} registered and is ONLINE!`, "success");
    } else {
      showToast(`Device ${device.mac_address} registered. (Note: Device not found / currently offline on MQTT broker).`, "error");
    }

    currentDeviceMac = device.mac_address;
    localStorage.setItem("myomotion_active_mac", device.mac_address);
    loadUserDevices();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteDevice(id) {
  if (!confirm("Are you sure you wish to delete this device node?")) return;
  try {
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not remove device.");
    showToast("Device unregistered successfully.", "success");
    loadUserDevices();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// History Records Page
async function loadHistoryRecords(jointFilter = "") {
  const container = document.getElementById("history-table-body");
  if (!container) return;

  try {
    const url = jointFilter ? `/api/rehab/history?joint=${jointFilter}` : "/api/rehab/history";
    const res = await fetch(url);
    const sessions = await res.json();
    if (!res.ok) throw new Error(sessions.detail || "Failed to load history.");

    container.innerHTML = "";
    if (sessions.length === 0) {
      container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-tertiary);">No clinical rehabilitation records logged yet.</td></tr>`;
      return;
    }

    sessions.forEach((s) => {
      const row = document.createElement("tr");
      const dateStr = new Date(s.start_time).toLocaleDateString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      const duration = `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`;

      row.innerHTML = `
        <td style="padding:14px 16px; font-weight:700;">#${s.id}</td>
        <td style="padding:14px 16px;">${dateStr}</td>
        <td style="padding:14px 16px;">
          <span class="user-role-badge" style="background:${s.target_joint === "elbow" ? "rgba(0,122,255,0.15)" : "rgba(255,159,10,0.15)"}; color:${s.target_joint === "elbow" ? "var(--apple-blue)" : "var(--apple-orange)"};">
            ${s.target_joint.toUpperCase()}
          </span>
        </td>
        <td style="padding:14px 16px; font-variant-numeric:tabular-nums;">${s.max_flexion_deg}°</td>
        <td style="padding:14px 16px; font-variant-numeric:tabular-nums; color:var(--apple-green); font-weight:700;">${s.peak_emg_mvc}%</td>
        <td style="padding:14px 16px; font-weight:700;">${s.reps_count}</td>
        <td style="padding:14px 16px; color:var(--text-secondary);">${duration}</td>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Global DOM Initialization
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();

  const yrEl = document.getElementById("copyright-year");
  if (yrEl) yrEl.textContent = new Date().getFullYear();

  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

  const logoutBtn = document.getElementById("sidebar-logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

  // Authenticate user
  await checkAuth();

  // Load saved device MAC
  currentDeviceMac = localStorage.getItem("myomotion_active_mac") || "";
  checkCurrentDeviceStatus();

  // Initialize Canvas Kinematics Renderer if canvas exists on page
  if (document.getElementById("arm-simulation-canvas")) {
    window.armRenderer = new ArmKinematicsRenderer("arm-simulation-canvas");
    updateElbowBoundsUI();
    updateWristBoundsUI();

    const targetMode = localStorage.getItem("myomotion_target_mode");
    if (targetMode === "wrist" || targetMode === "elbow") {
      localStorage.removeItem("myomotion_target_mode");
      switchRehabMode(targetMode, true);
    }
  }

  // Hook Segmented mode selector buttons
  document.querySelectorAll(".segmented-option").forEach((btn) => {
    btn.addEventListener("click", () => switchRehabMode(btn.dataset.mode));
  });

  // Start live WebSocket stream
  connectWebSocket();

  // Settings page forms
  const addDevForm = document.getElementById("add-device-form");
  if (addDevForm) addDevForm.addEventListener("submit", addDeviceHandler);
  if (document.getElementById("devices-list-container")) {
    loadUserDevices();
  }

  // History page
  if (document.getElementById("history-table-body")) {
    loadHistoryRecords();
    const filterSelect = document.getElementById("history-filter-joint");
    if (filterSelect) {
      filterSelect.addEventListener("change", (e) => loadHistoryRecords(e.target.value));
    }
  }

  // Dashboard Overview Quick Stats
  if (document.getElementById("overview-total-sessions")) {
    try {
      const res = await fetch("/api/rehab/history?limit=100");
      const sessions = await res.json();
      if (res.ok && Array.isArray(sessions)) {
        document.getElementById("overview-total-sessions").textContent = sessions.length;
        const totalReps = sessions.reduce((acc, s) => acc + (s.reps_count || 0), 0);
        document.getElementById("overview-total-reps").textContent = totalReps;
        const highestPeak = sessions.reduce((acc, s) => Math.max(acc, s.peak_emg_mvc || 0), 0);
        document.getElementById("overview-peak-mvc").textContent = `${Math.round(highestPeak)}%`;
      }
    } catch (e) {}
  }
});
