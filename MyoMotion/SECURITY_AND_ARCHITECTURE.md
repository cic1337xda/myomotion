# Security Controls & Biomechanical Architecture

> Detailed breakdown of web/API security defenses, authentication flows, and the hybrid ROM + sEMG repetition algorithm.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](SECURITY_AND_ARCHITECTURE.md)**
* 🇲🇾 **[Bahasa Melayu](SECURITY_AND_ARCHITECTURE_MY.md)**

---

## 🛡️ 1. Web & API Security Architecture

1. **XSS-Resilient Session Cookies:** JWT tokens are issued exclusively inside `HttpOnly`, `Secure`, `SameSite=Lax` cookies (`access_token`)—never stored in `localStorage` or `sessionStorage`.
2. **CSRF Origin Validation:** `SecurityAndTracingMiddleware` inspects `Origin` and `Referer` headers on all `POST`, `PUT`, `DELETE`, and `PATCH` requests to reject untrusted cross-site mutations (`403 Forbidden`).
3. **HTTP Security Headers & Request Tracing:** Every response injects `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a unique UUID `X-Request-ID`.
4. **Brute-Force Protection (Rate Limiting + Lockout):**
   * `SlowAPI` enforces `5/minute` on `/login` and `3/minute` on `/send-otp`, `/register`, `/forgot-password`, and `/reset-password`.
   * Accounts lock automatically for **15 minutes** (`423 Locked`) after **5 consecutive failed login attempts**.
5. **Cryptographic OTP Verification:** 6-digit single-use codes expire in **10 minutes** and self-invalidate after **5 failed verification attempts**.
6. **Password Strength & Hashing:** Enforces $\ge 8$ characters (max 70 bytes), uppercase, lowercase, digit, and special symbol before Bcrypt hashing (`passlib`).
7. **Strict Ownership Enforcement (BOLA/IDOR Prevention):** Every device and rehabilitation session query filters by `user_id == current_user.id`. Admin checks run strictly server-side (`get_current_admin`).
8. **SQL Injection Immunity & Non-Root Isolation:** 100% parameterized SQLAlchemy ORM queries; FastAPI container runs as unprivileged `appuser`.

---

## 🧠 2. Biomechanical Kinematics & Rep Counting Algorithm

### A. Elbow Curl (Biceps — 1-DoF Quaternion Displacement)
* Relative orientation: $q_{\text{rel}} = q_{\text{prox}}^* \otimes q_{\text{dist}}$, zero-referenced via $q_{\text{joint}} = q_{\text{rel}} \otimes q_{\text{offset}}^*$.
* Flexion angle: $\theta = 2 \arccos(|w|)$ smoothed with EMA ($\alpha = 0.20$).
* Calibrated ROM normalization between **Straight (`elbow_min`)** and **Max Flex (`elbow_max`)**:
  $$\text{progress} = \frac{\theta - \theta_{\min}}{\theta_{\max} - \theta_{\min}}$$

### B. Wrist Curl (Forearm — 1-DoF Sagittal Pitch)
* Projects longitudinal axis $[1, 0, 0]^T$ via analytical quaternion rotation to extract sagittal pitch $\phi = \text{atan2}(-v_z, v_x)$ without gimbal lock.
* Calibrated ROM normalization between **Bottom (`bottom`)** and **Top (`top`)**:
  $$\text{progress} = \frac{\phi - \phi_{\text{bottom}}}{\phi_{\text{top}} - \phi_{\text{bottom}}}$$

### C. Hybrid EMG-Verified Repetition State Machine
To ensure passive arm movement without muscular effort does not count as therapeutic work:
1. Subject starts in the resting zone (`progress <= 0.25`).
2. Subject curls smoothly upward while `peakEmgInRep` tracks peak MyoWare `%MVC`.
3. When `progress >= 0.75` **AND** `peakEmgInRep >= 20% MVC`, **+1 valid rep** is recorded and locked until the limb returns to `<= 0.25`.
