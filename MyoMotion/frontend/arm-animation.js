/**
 * ==============================================================================
 * MyoMotion Articulated Arm Biomechanics & sEMG Animation Engine
 * ==============================================================================
 * Renders continuous 60-FPS articulated kinematic visualization:
 * - Elbow Mode: 1-DoF Flexion/Extension + Biceps Muscle Activation Heatmap
 * - Wrist Mode: 1-DoF Sagittal Wrist Curl (Bottom <-> Top) + Forearm Activation
 * ==============================================================================
 */

class ArmKinematicsRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");

    // Internal simulation state (Target from MQTT vs Smoothed for 60 FPS lerp)
    this.mode = "elbow"; // 'elbow' | 'wrist'

    // Live targets received from sensor
    this.targetElbowAngle = 0.0;
    this.targetWristPitch = 0.0;
    this.targetEmgPercent = 0.0;

    // Calibrated Elbow Curl ROM boundaries
    this.elbowMinAngle = 0.0;
    this.elbowMaxAngle = 120.0;

    // Calibrated Wrist Curl ROM boundaries
    this.wristBottomPitch = -40.0;
    this.wristTopPitch = 40.0;

    // Smoothed rendered states
    this.currentElbowAngle = 0.0;
    this.currentWristPitch = 0.0;
    this.currentEmgPercent = 0.0;

    this.resizeCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());

    this.startRenderLoop();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  setMode(newMode) {
    this.mode = newMode.toLowerCase() === "wrist" ? "wrist" : "elbow";
  }

  setElbowLimits(minDeg, maxDeg) {
    if (typeof minDeg === "number") this.elbowMinAngle = minDeg;
    if (typeof maxDeg === "number") this.elbowMaxAngle = maxDeg;
  }

  setWristLimits(bottomDeg, topDeg) {
    if (typeof bottomDeg === "number") this.wristBottomPitch = bottomDeg;
    if (typeof topDeg === "number") this.wristTopPitch = topDeg;
  }

  updateData(telemetry) {
    if (!telemetry) return;
    if (telemetry.mode && telemetry.mode !== "idle") {
      this.mode = telemetry.mode.toLowerCase() === "wrist" ? "wrist" : "elbow";
    }
    if (typeof telemetry.angle === "number") {
      this.targetElbowAngle = Math.max(0, Math.min(150, telemetry.angle));
    }
    if (typeof telemetry.elbow_min === "number") {
      this.elbowMinAngle = telemetry.elbow_min;
    }
    if (typeof telemetry.elbow_max === "number") {
      this.elbowMaxAngle = telemetry.elbow_max;
    }
    if (typeof telemetry.pitch === "number") {
      this.targetWristPitch = Math.max(-90, Math.min(90, telemetry.pitch));
    }
    if (typeof telemetry.bottom === "number") {
      this.wristBottomPitch = telemetry.bottom;
    }
    if (typeof telemetry.top === "number") {
      this.wristTopPitch = telemetry.top;
    }
    if (typeof telemetry.percent === "number") {
      this.targetEmgPercent = Math.max(0, Math.min(150, telemetry.percent));
    }
  }

  getMuscleColor(percent) {
    // Dynamic color gradient: 0% Cyan/Blue -> 50% Green -> 100%+ Amber/Red
    const norm = Math.min(1.0, percent / 100.0);
    if (norm < 0.5) {
      const t = norm * 2;
      const r = Math.round(0 + t * 50);
      const g = Math.round(122 + t * (215 - 122));
      const b = Math.round(255 + t * (75 - 255));
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const t = (norm - 0.5) * 2;
      const r = Math.round(50 + t * (255 - 50));
      const g = Math.round(215 + t * (59 - 215));
      const b = Math.round(75 + t * (48 - 75));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  startRenderLoop() {
    const loop = () => {
      this.currentElbowAngle += (this.targetElbowAngle - this.currentElbowAngle) * 0.15;
      this.currentWristPitch += (this.targetWristPitch - this.currentWristPitch) * 0.15;
      this.currentEmgPercent += (this.targetEmgPercent - this.currentEmgPercent) * 0.20;

      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render() {
    if (!this.ctx || !this.width) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const isDark = document.body.classList.contains("dark");
    const boneColor = isDark ? "#E5E7EB" : "#374151";
    const jointColor = "#0A84FF";
    const gridLineColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

    // Background coordinate grid
    ctx.strokeStyle = gridLineColor;
    ctx.lineWidth = 1;
    const gridSize = 30;
    for (let x = 0; x < this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    if (this.mode === "elbow") {
      this.renderElbowMode(ctx, boneColor, jointColor, isDark);
    } else {
      this.renderWristMode(ctx, boneColor, jointColor, isDark);
    }
  }

  renderElbowMode(ctx, boneColor, jointColor, isDark) {
    const shoulderX = this.width * 0.20;
    const shoulderY = this.height * 0.66;
    const armLength = Math.min(this.width * 0.28, 155);

    const elbowX = shoulderX + armLength;
    const elbowY = shoulderY;

    const angleRad = (this.currentElbowAngle * Math.PI) / 180.0;
    const handX = elbowX + armLength * Math.cos(-angleRad);
    const handY = elbowY + armLength * Math.sin(-angleRad);

    const muscleColor = this.getMuscleColor(this.currentEmgPercent);

    // Compute normalized elbow curl progress from Straight (0%) to Max Flex (100%)
    const elbowSpan = this.elbowMaxAngle - this.elbowMinAngle;
    let progress = 0.0;
    if (Math.abs(elbowSpan) >= 5.0) {
      progress = (this.currentElbowAngle - this.elbowMinAngle) / elbowSpan;
      progress = Math.max(0.0, Math.min(1.0, progress));
    }

    // 1. Biceps Muscle Belly with Dynamic Biofeedback Glow
    ctx.save();
    const bicepCenterX = shoulderX + armLength * 0.48;
    const bicepCenterY = shoulderY - 14;
    const bicepBulge = 14 + (this.currentEmgPercent / 100.0) * 12;

    ctx.shadowColor = muscleColor;
    ctx.shadowBlur = 10 + (this.currentEmgPercent / 100.0) * 20;

    ctx.beginPath();
    ctx.moveTo(shoulderX + 15, shoulderY - 8);
    ctx.quadraticCurveTo(bicepCenterX, bicepCenterY - bicepBulge, elbowX - 15, elbowY - 8);
    ctx.quadraticCurveTo(bicepCenterX, bicepCenterY + 4, shoulderX + 15, shoulderY - 8);
    ctx.fillStyle = muscleColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = isDark ? "#9CA3AF" : "#6B7280";
    ctx.font = "600 11px 'Roboto', sans-serif";
    ctx.fillText(`BICEPS: ${Math.round(this.currentEmgPercent)}% MVC`, bicepCenterX - 35, bicepCenterY - bicepBulge - 12);

    // 2. Upper Arm (Humerus Bone)
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(elbowX, elbowY);
    ctx.strokeStyle = boneColor;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.stroke();

    // 3. Calibrated Straight (Min) & Max Flex (Max) Target Lines
    const guideLen = armLength + 28;
    const minRad = (this.elbowMinAngle * Math.PI) / 180.0;
    const maxRad = (this.elbowMaxAngle * Math.PI) / 180.0;

    // STRAIGHT Limit Line (Orange dashed)
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(255, 159, 10, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(elbowX, elbowY);
    ctx.lineTo(elbowX + guideLen * Math.cos(-minRad), elbowY + guideLen * Math.sin(-minRad));
    ctx.stroke();
    ctx.fillStyle = "#FF9F0A";
    ctx.font = "700 11px 'Roboto', sans-serif";
    ctx.fillText(
      `MIN (${this.elbowMinAngle.toFixed(0)}°)`,
      elbowX + (guideLen + 6) * Math.cos(-minRad),
      elbowY + (guideLen + 6) * Math.sin(-minRad) + 4
    );
    ctx.restore();

    // MAX FLEX Limit Line (Green dashed)
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(50, 215, 75, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(elbowX, elbowY);
    ctx.lineTo(elbowX + guideLen * Math.cos(-maxRad), elbowY + guideLen * Math.sin(-maxRad));
    ctx.stroke();
    ctx.fillStyle = "#32D74B";
    ctx.font = "700 11px 'Roboto', sans-serif";
    ctx.fillText(
      `MAX (${this.elbowMaxAngle.toFixed(0)}°)`,
      elbowX + (guideLen + 6) * Math.cos(-maxRad) - 10,
      elbowY + (guideLen + 6) * Math.sin(-maxRad) - 6
    );
    ctx.restore();

    // 4. Angle Measurement Arc
    ctx.beginPath();
    const arcRadius = 45;
    ctx.arc(elbowX, elbowY, arcRadius, 0, -angleRad, true);
    ctx.strokeStyle = "#32D74B";
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#32D74B";
    ctx.font = "700 13px 'Roboto', sans-serif";
    const textAngle = -angleRad / 2;
    const labelX = elbowX + (arcRadius + 22) * Math.cos(textAngle);
    const labelY = elbowY + (arcRadius + 22) * Math.sin(textAngle);
    ctx.fillText(`${this.currentElbowAngle.toFixed(1)}°`, labelX - 10, labelY + 4);

    // 5. Forearm Bone
    ctx.beginPath();
    ctx.moveTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.strokeStyle = "#0A84FF";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.stroke();

    // 6. Articulated Hand Segment
    const handLength = 32;
    const handTipX = handX + handLength * Math.cos(-angleRad);
    const handTipY = handY + handLength * Math.sin(-angleRad);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handTipX, handTipY);
    ctx.strokeStyle = isDark ? "#FFFFFF" : "#111827";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();

    // 7. Joint Pivots
    ctx.beginPath();
    ctx.arc(shoulderX, shoulderY, 12, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "#1F2937" : "#D1D5DB";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = boneColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(elbowX, elbowY, 13, 0, Math.PI * 2);
    ctx.fillStyle = jointColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(elbowX, elbowY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(handX, handY, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#32D74B";
    ctx.fill();

    // 8. Title & Phase Label
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)";
    ctx.font = "800 18px 'Roboto', sans-serif";
    ctx.fillText("ELBOW CURL — BICEPS (1-DoF)", 24, 34);

    const statusLabel = progress >= 0.75
      ? "MAX FLEXION (Peak) ↑"
      : (progress <= 0.25 ? "STRAIGHT POSITION (Extended) →" : "MID-RANGE CURL");
    ctx.fillStyle = progress >= 0.75 ? "#32D74B" : (progress <= 0.25 ? "#FF9F0A" : "#0A84FF");
    ctx.font = "700 12px 'Roboto', sans-serif";
    ctx.fillText(statusLabel, 24, 56);

    // 9. Vertical ROM Curl Progress Meter (Right Side)
    const meterX = this.width - 54;
    const meterTop = 80;
    const meterH = this.height - 130;

    ctx.fillStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.roundRect(meterX, meterTop, 16, meterH, 8);
    ctx.fill();

    const fillH = Math.max(8, progress * meterH);
    ctx.fillStyle = progress >= 0.75 ? "#32D74B" : (progress <= 0.25 ? "#FF9F0A" : "#0A84FF");
    ctx.beginPath();
    ctx.roundRect(meterX, meterTop + meterH - fillH, 16, fillH, 8);
    ctx.fill();

    ctx.font = "700 10px 'Roboto', sans-serif";
    ctx.fillStyle = "#32D74B";
    ctx.fillText("MAX", meterX - 2, meterTop - 8);
    ctx.fillStyle = "#FF9F0A";
    ctx.fillText("MIN", meterX - 2, meterTop + meterH + 14);
    ctx.fillStyle = isDark ? "#E5E7EB" : "#111827";
    ctx.fillText(`${Math.round(progress * 100)}%`, meterX - 4, meterTop + meterH + 28);
  }

  renderWristMode(ctx, boneColor, jointColor, isDark) {
    const wristX = this.width * 0.48;
    const wristY = this.height * 0.54;
    const forearmLen = Math.min(this.width * 0.28, 175);
    const handLen = Math.min(this.width * 0.20, 105);
    const muscleColor = this.getMuscleColor(this.currentEmgPercent);

    // Compute normalized curl progress from Bottom (0%) to Top (100%)
    const romSpan = this.wristTopPitch - this.wristBottomPitch;
    let progress = 0.5;
    if (Math.abs(romSpan) >= 5.0) {
      progress = (this.currentWristPitch - this.wristBottomPitch) / romSpan;
      progress = Math.max(0.0, Math.min(1.0, progress));
    }

    // 1. Title & HUD Header
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)";
    ctx.font = "800 18px 'Roboto', sans-serif";
    ctx.fillText("WRIST CURL — FOREARM (1-DoF SAGITTAL)", 24, 34);

    const statusLabel = progress >= 0.75
      ? "TOP POSITION (Curl Peak) ↑"
      : (progress <= 0.25 ? "BOTTOM POSITION (Lowered) ↓" : "MID-RANGE CURL");
    ctx.fillStyle = progress >= 0.75 ? "#32D74B" : (progress <= 0.25 ? "#FF9F0A" : "#0A84FF");
    ctx.font = "700 12px 'Roboto', sans-serif";
    ctx.fillText(statusLabel, 24, 56);

    // 2. Forearm Support Pad / Rest Surface (Bench visual)
    ctx.save();
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
    ctx.beginPath();
    ctx.roundRect(wristX - forearmLen - 18, wristY + 14, forearmLen + 14, 18, 8);
    ctx.fill();
    ctx.restore();

    // 3. Forearm Flexor Muscle Belly with Live MyoWare Biofeedback Glow
    ctx.save();
    const muscleCenterX = wristX - forearmLen * 0.52;
    const muscleCenterY = wristY - 12;
    const muscleBulge = 12 + (this.currentEmgPercent / 100.0) * 14;

    ctx.shadowColor = muscleColor;
    ctx.shadowBlur = 10 + (this.currentEmgPercent / 100.0) * 20;

    ctx.beginPath();
    ctx.moveTo(wristX - forearmLen + 16, wristY - 6);
    ctx.quadraticCurveTo(muscleCenterX, muscleCenterY - muscleBulge, wristX - 14, wristY - 6);
    ctx.quadraticCurveTo(muscleCenterX, muscleCenterY + 5, wristX - forearmLen + 16, wristY - 6);
    ctx.fillStyle = muscleColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = isDark ? "#9CA3AF" : "#6B7280";
    ctx.font = "600 11px 'Roboto', sans-serif";
    ctx.fillText(`FOREARM: ${Math.round(this.currentEmgPercent)}% MVC`, muscleCenterX - 48, muscleCenterY - muscleBulge - 12);

    // 4. Forearm Bone (Fixed horizontal on bench)
    ctx.beginPath();
    ctx.moveTo(wristX - forearmLen, wristY);
    ctx.lineTo(wristX, wristY);
    ctx.strokeStyle = boneColor;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.stroke();

    // 5. Calibrated TOP & BOTTOM Target Lines + Neutral 0° Line
    const guideLen = handLen + 45;

    // Neutral 0° reference
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(wristX, wristY);
    ctx.lineTo(wristX + guideLen, wristY);
    ctx.stroke();
    ctx.restore();

    // TOP Limit Line (Green dashed)
    const topRad = (-this.wristTopPitch * Math.PI) / 180.0;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(50, 215, 75, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wristX, wristY);
    ctx.lineTo(wristX + guideLen * Math.cos(topRad), wristY + guideLen * Math.sin(topRad));
    ctx.stroke();
    ctx.fillStyle = "#32D74B";
    ctx.font = "700 11px 'Roboto', sans-serif";
    ctx.fillText(
      `TOP (${this.wristTopPitch.toFixed(0)}°)`,
      wristX + (guideLen + 6) * Math.cos(topRad),
      wristY + (guideLen + 6) * Math.sin(topRad) + 4
    );
    ctx.restore();

    // BOTTOM Limit Line (Orange dashed)
    const bottomRad = (-this.wristBottomPitch * Math.PI) / 180.0;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(255, 159, 10, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wristX, wristY);
    ctx.lineTo(wristX + guideLen * Math.cos(bottomRad), wristY + guideLen * Math.sin(bottomRad));
    ctx.stroke();
    ctx.fillStyle = "#FF9F0A";
    ctx.font = "700 11px 'Roboto', sans-serif";
    ctx.fillText(
      `BOTTOM (${this.wristBottomPitch.toFixed(0)}°)`,
      wristX + (guideLen + 6) * Math.cos(bottomRad),
      wristY + (guideLen + 6) * Math.sin(bottomRad) + 4
    );
    ctx.restore();

    // 6. Articulated Hand Segment (Pitch Curl Up/Down)
    const pitchRad = (-this.currentWristPitch * Math.PI) / 180.0;
    ctx.save();
    ctx.translate(wristX, wristY);
    ctx.rotate(pitchRad);

    // Palm / Hand Dorsum
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(handLen, 0);
    ctx.strokeStyle = "#0A84FF";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.stroke();

    // Curled Fingers / Grip Profile
    ctx.beginPath();
    ctx.moveTo(handLen, 0);
    ctx.lineTo(handLen + 28, -5);
    ctx.strokeStyle = isDark ? "#FFFFFF" : "#111827";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.stroke();

    // Knuckle / Grip Weight Indicator
    ctx.beginPath();
    ctx.arc(handLen + 8, 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = muscleColor;
    ctx.fill();
    ctx.restore();

    // 7. Angle Measurement Arc from Neutral (0°) to Current Pitch
    if (Math.abs(this.currentWristPitch) > 1.0) {
      ctx.beginPath();
      ctx.arc(wristX, wristY, 44, 0, pitchRad, this.currentWristPitch > 0);
      ctx.strokeStyle = "#0A84FF";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Current Pitch Badge
    ctx.fillStyle = "#0A84FF";
    ctx.font = "800 14px 'Roboto', sans-serif";
    ctx.fillText(`${this.currentWristPitch >= 0 ? "+" : ""}${this.currentWristPitch.toFixed(1)}°`, wristX - 18, wristY + 42);

    // 8. Joint Pivots
    ctx.beginPath();
    ctx.arc(wristX - forearmLen, wristY, 10, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "#1F2937" : "#D1D5DB";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = boneColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(wristX, wristY, 13, 0, Math.PI * 2);
    ctx.fillStyle = jointColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wristX, wristY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();

    // 9. Vertical ROM Curl Progress Meter (Right Side)
    const meterX = this.width - 54;
    const meterTop = 80;
    const meterH = this.height - 130;

    ctx.fillStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.roundRect(meterX, meterTop, 16, meterH, 8);
    ctx.fill();

    const fillH = Math.max(8, progress * meterH);
    ctx.fillStyle = progress >= 0.75 ? "#32D74B" : (progress <= 0.25 ? "#FF9F0A" : "#0A84FF");
    ctx.beginPath();
    ctx.roundRect(meterX, meterTop + meterH - fillH, 16, fillH, 8);
    ctx.fill();

    ctx.font = "700 10px 'Roboto', sans-serif";
    ctx.fillStyle = "#32D74B";
    ctx.fillText("TOP", meterX - 2, meterTop - 8);
    ctx.fillStyle = "#FF9F0A";
    ctx.fillText("BTM", meterX - 2, meterTop + meterH + 14);
    ctx.fillStyle = isDark ? "#E5E7EB" : "#111827";
    ctx.fillText(`${Math.round(progress * 100)}%`, meterX - 4, meterTop + meterH + 28);
  }
}

window.ArmKinematicsRenderer = ArmKinematicsRenderer;
