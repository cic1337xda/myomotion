# MyoMotion Web Platform & Docker Stack

> Containerized FastAPI backend, PostgreSQL database, Eclipse Mosquitto MQTT broker, and Liquid Glass Nginx frontend.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](README.md)**
* 🇲🇾 **[Bahasa Melayu](README_MY.md)**

---

## 🛠️ Tech Stack

* **Backend:** FastAPI 0.111, SQLAlchemy 2.0, Alembic, PyJWT, Passlib (Bcrypt), SlowAPI, Resend, Paho-MQTT
* **Database:** PostgreSQL 15 (`Asia/Kuala_Lumpur` synchronized)
* **Messaging:** Eclipse Mosquitto (TCP + WebSockets) &amp; FastAPI WebSocket bridge (`/ws/telemetry`)
* **Frontend:** Vanilla HTML5, CSS3 (Apple Liquid Glass), ES6 JS, 60 FPS HTML5 Canvas Engine

---

## 🚀 Quick Deployment Commands

```bash
# 1. Create shared external Docker network if missing
docker network inspect pwn20wnd-network >/dev/null 2>&1 || docker network create pwn20wnd-network

# 2. Configure environment variables
cp .env.example .env

# 3. Build and start all 4 containers
docker compose up -d --build

# 4. Run hardware simulator (optional)
./run_simulation.sh
```

---

## 📚 Subsystem Documentation
* [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) — Exhaustive REST &amp; WebSocket endpoint reference.
* [`DOCKER_AND_SERVICES.md`](DOCKER_AND_SERVICES.md) — Container topology, port mappings, healthchecks, log rotation &amp; `.env` matrix.
* [`SECURITY_AND_ARCHITECTURE.md`](SECURITY_AND_ARCHITECTURE.md) — Security controls, lockout/OTP logic, and biomechanical rep algorithms.
