# Rujukan API REST &amp; WebSocket

> Spesifikasi penuh API HTTP dan WebSocket untuk pengesahan, pengurusan peranti, penghantaran arahan kalibrasi, sesi rehabilitasi, dan telemetri langsung.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](API_DOCUMENTATION.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](API_DOCUMENTATION_MY.md)**

---

## 🩺 1. Semakan Kesihatan Sistem

### `GET /api/health` | `GET /api/v1/health`
Melaksanakan ujian `SELECT 1` terhadap PostgreSQL dan memulangkan status sistem bersama cap masa GMT+8:
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

## 🔐 2. Pengesahan &amp; OTP (`/api/auth`)

| Kaedah | Titik Akhir | Had Kadar | Akses | Penerangan |
| :--- | :--- | :---: | :---: | :--- |
| `POST` | `/api/auth/send-otp` | `3/min` | Awam | Menghantar OTP 6-digit melalui Resend (tamat 10 minit) |
| `POST` | `/api/auth/register` | `3/min` | Awam | Mengesahkan OTP (maks 5 cubaan) &amp; kekuatan kata laluan, cipta akaun, set kuki JWT `HttpOnly` |
| `POST` | `/api/auth/login` | `5/min` | Awam | Log masuk e-mel/nama pengguna (sekatan 15 minit selepas 5 kali gagal), set kuki JWT `HttpOnly` |
| `POST` | `/api/auth/logout` | — | Awam | Memadam kuki `access_token` |
| `GET` | `/api/auth/me` | — | Kuki | Memulangkan profil pengguna berdaftar (`id`, `username`, `email`, `is_admin`) |
| `POST` | `/api/auth/forgot-password` | `3/min` | Awam | Menghantar OTP pemulihan 6-digit melalui Resend |
| `POST` | `/api/auth/reset-password` | `3/min` | Awam | Mengesahkan OTP pemulihan (maks 5 cubaan), simpan kata laluan baru, buka sekatan |

---

## 📡 3. Pengurusan Peranti &amp; Kalibrasi (`/api/devices`)

| Kaedah | Titik Akhir | Akses | Penerangan |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/devices` | Kuki | Menyenaraikan peranti milik pengguna bersama status LWT langsung |
| `POST` | `/api/devices` | Kuki | Mendaftarkan alamat MAC 12-aksara ke akaun pengguna |
| `DELETE` | `/api/devices/{device_id}` | Kuki | Memadam peranti (semakan `user_id == current_user.id`) |
| `GET` | `/api/devices/{mac}/status` | Kuki | Memulangkan status LWT dalam/luar talian, `last_seen`, dan mod aktif |
| `POST` | `/api/devices/command` | Kuki | Menerbitkan arahan MQTT ke `myomotion/cmd/<MAC>` (pemilikan disemak) |

### Contoh Muatan `/api/devices/command`
```json
{
  "mac_address": "CC7B5C284994",
  "command": "wrist:bottom"
}
```
Arahan disokong: `tare`, `baseline`, `calibrate`, `reset`, `elbow:min`, `elbow:max`, `elbow:reset`, `wrist:bottom`, `wrist:top`, `wrist:reset`, `mode:elbow`, `mode:wrist`, `mode:idle`.

---

## 🏋️ 4. Sesi Rehabilitasi (`/api/rehab`)

| Kaedah | Titik Akhir | Akses | Penerangan |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/rehab/session/start` | Kuki | Memulakan sesi (`target_joint`: `elbow` \| `wrist`) &amp; hantar arahan mod |
| `POST` | `/api/rehab/session/stop` | Kuki | Menyimpan ROM (`max_flexion_deg`, `max_extension_deg`), `%MVC`, `reps_count`, `duration_seconds` |
| `GET` | `/api/rehab/history` | Kuki | Memulangkan rekod sejarah pengguna (pilihan `?joint=elbow\|wrist&limit=25`) |
| `GET` | `/api/rehab/session/{id}` | Kuki | Memulangkan butiran satu sesi (pemilikan disemak) |
| `DELETE` | `/api/rehab/session/{id}` | Kuki | Memadam rekod sesi (pemilikan disemak) |

---

## ⚡ 5. Telemetri Langsung (`/api/telemetry` &amp; `/ws/telemetry`)

* **`GET /api/telemetry/live/{mac}`:** Gambar serta-merta keadaan MQTT yang disimpan dalam memori.
* **`WS /ws/telemetry`:** Menolak peristiwa JSON masa nyata terus ke pelayar:
  * `{"type": "device_status", "mac": "...", "is_online": true, "timestamp": "..."}`
  * `{"type": "telemetry", "mac": "...", "data": { ... }}`
