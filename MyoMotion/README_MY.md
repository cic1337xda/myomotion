# Platform Web &amp; Susunan Docker MyoMotion

> Backend FastAPI berkontena, pangkalan data PostgreSQL, broker MQTT Eclipse Mosquitto, dan frontend Nginx bertema Liquid Glass.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](README.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](README_MY.md)**

---

## 🛠️ Tindanan Teknologi

* **Backend:** FastAPI 0.111, SQLAlchemy 2.0, Alembic, PyJWT, Passlib (Bcrypt), SlowAPI, Resend, Paho-MQTT
* **Pangkalan Data:** PostgreSQL 15 (diselaraskan ke `Asia/Kuala_Lumpur`)
* **Pemesejan:** Eclipse Mosquitto (TCP + WebSockets) &amp; jambatan WebSocket FastAPI (`/ws/telemetry`)
* **Frontend:** HTML5 Tulen, CSS3 (Apple Liquid Glass), JS ES6, Enjin Kanvas HTML5 60 FPS

---

## 🚀 Arahan Pemasangan Pantas

```bash
# 1. Cipta rangkaian Docker luaran sepunya jika belum wujud
docker network inspect pwn20wnd-network >/dev/null 2>&1 || docker network create pwn20wnd-network

# 2. Sediakan pemboleh ubah persekitaran
cp .env.example .env

# 3. Bina dan mulakan kesemua 4 kontena
docker compose up -d --build

# 4. Jalankan simulator perkakasan (pilihan)
./run_simulation.sh
```

---

## 📚 Dokumentasi Subsistem
* [`API_DOCUMENTATION_MY.md`](API_DOCUMENTATION_MY.md) — Rujukan lengkap titik akhir REST &amp; WebSocket.
* [`DOCKER_AND_SERVICES_MY.md`](DOCKER_AND_SERVICES_MY.md) — Topologi kontena, pemetaan port, semakan kesihatan, putaran log &amp; matriks `.env`.
* [`SECURITY_AND_ARCHITECTURE_MY.md`](SECURITY_AND_ARCHITECTURE_MY.md) — Kawalan keselamatan, logik sekatan/OTP, dan algoritma ulangan biomekanik.
