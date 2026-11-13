# REST & WebSocket API Reference

> Complete HTTP and WebSocket API specification for authentication, device management, calibration dispatch, rehabilitation sessions, and live telemetry.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](API_DOCUMENTATION.md)**
* 🇲🇾 **[Bahasa Melayu](API_DOCUMENTATION_MY.md)**

---

## 🩺 1. System Healthcheck

### `GET /api/health` | `GET /api/v1/health`
Pings PostgreSQL (`SELECT 1`) and returns service health with GMT+8 timestamp:
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2026-11-12T23:00:00+08:00",
  "service": "MyoMotion Backend Engine",
  "version": "1.0.0"
}
```

---

## 🔐 2. Authentication & OTP (`/api/auth`)

| Method | Endpoint | Rate Limit | Auth | Description |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/api/auth/send-otp` | `3/min` | Public | Dispatches 6-digit OTP via Resend (10-min TTL) |
| `POST` | `/api/auth/register` | `3/min` | Public | Validates OTP (max 5 attempts) &amp; password entropy, creates user, sets `HttpOnly` JWT |
| `POST` | `/api/auth/login` | `5/min` | Public | Authenticates email/username (15-min lockout after 5 fails), sets `HttpOnly` JWT |
| `POST` | `/api/auth/logout` | — | Public | Clears `access_token` cookie |
| `GET` | `/api/auth/me` | — | Cookie | Returns authenticated user profile (`id`, `username`, `email`, `is_admin`) |
| `POST` | `/api/auth/forgot-password` | `3/min` | Public | Sends 6-digit recovery OTP via Resend |
| `POST` | `/api/auth/reset-password` | `3/min` | Public | Verifies recovery OTP (max 5 attempts), hashes new password, clears lockout |

---

## 📡 3. Device Management & Calibration (`/api/devices`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/devices` | Cookie | Lists devices owned by authenticated user with live LWT status |
| `POST` | `/api/devices` | Cookie | Registers normalized 12-char MAC address to user account |
| `DELETE` | `/api/devices/{device_id}` | Cookie | Removes device (enforces `user_id == current_user.id`) |
| `GET` | `/api/devices/{mac}/status` | Cookie | Returns live LWT online/offline state, `last_seen`, and active mode |
| `POST` | `/api/devices/command` | Cookie | Publishes MQTT command to `myomotion/cmd/<MAC>` (requires ownership) |

### Supported `/api/devices/command` Payloads
```json
{
  "mac_address": "CC7B5C284994",
  "command": "wrist:bottom"
}
```
Commands: `tare`, `baseline`, `calibrate`, `reset`, `elbow:min`, `elbow:max`, `elbow:reset`, `wrist:bottom`, `wrist:top`, `wrist:reset`, `mode:elbow`, `mode:wrist`, `mode:idle`.

---

## 🏋️ 4. Rehabilitation Sessions (`/api/rehab`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/rehab/session/start` | Cookie | Starts session (`target_joint`: `elbow` \| `wrist`), dispatches mode command |
| `POST` | `/api/rehab/session/stop` | Cookie | Commits ROM (`max_flexion_deg`, `max_extension_deg`), `%MVC`, `reps_count`, `duration_seconds` |
| `GET` | `/api/rehab/history` | Cookie | Returns user-scoped history (optional `?joint=elbow\|wrist&limit=25`) |
| `GET` | `/api/rehab/session/{id}` | Cookie | Returns single session details (ownership enforced) |
| `DELETE` | `/api/rehab/session/{id}` | Cookie | Deletes session record (ownership enforced) |

---

## ⚡ 5. Live Telemetry (`/api/telemetry` &amp; `/ws/telemetry`)

* **`GET /api/telemetry/live/{mac}`:** Instant snapshot of cached MQTT state for polling/hydration.
* **`WS /ws/telemetry`:** Pushes real-time JSON events to the browser:
  * `{"type": "device_status", "mac": "...", "is_online": true, "timestamp": "..."}`
  * `{"type": "telemetry", "mac": "...", "data": { ... }}`
