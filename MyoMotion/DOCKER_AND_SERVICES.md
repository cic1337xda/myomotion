# Docker Architecture, Services & Port Mapping

> Multi-container deployment topology, healthcheck dependency ordering, log rotation policy, and environment configuration matrix.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](DOCKER_AND_SERVICES.md)**
* 🇲🇾 **[Bahasa Melayu](DOCKER_AND_SERVICES_MY.md)**

---

## 🐳 Container Services & Port Matrix

All services run on the shared external bridge network **`pwn20wnd-network`** with `TZ=Asia/Kuala_Lumpur` (GMT+8) and `json-file` log rotation (`max-size: "10m"`, `max-file: "3"`).

| Service | Container Name | Image / Build | Host Port | Internal Port | Purpose |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `db` | `myomotion_db` | `postgres:15-alpine` | `5455` | `5432` | Relational storage (`PGTZ=Asia/Kuala_Lumpur`, `pg_isready` healthcheck) |
| `mqtt` | `myomotion_mqtt` | `eclipse-mosquitto:latest` | `1892` / `9002` | `1883` / `9001` | MQTT TCP broker &amp; WebSockets listener |
| `backend` | `myomotion_backend` | `./backend` (non-root `appuser`) | `8840` | `8000` | FastAPI REST, WebSocket bridge, Paho-MQTT worker |
| `frontend` | `myomotion_frontend` | `./frontend` (`nginx:alpine`) | `8841` | `80` | Clean URL routing (`/rehab`, `/settings`, `/history`) &amp; reverse proxy |

---

## 🔄 Startup & Healthcheck Ordering

1. `myomotion_db` initializes and runs `pg_isready` every 5s.
2. `myomotion_backend` waits for `db: condition: service_healthy` and also runs `wait_for_database()` (up to 30 retries) before invoking `Base.metadata.create_all()` and `ensure_schema_columns()`.
3. `myomotion_frontend` proxies `/api/*` and `/ws/*` to `http://myomotion_backend:8000`.

---

## ⚙️ Environment Variable Matrix (`.env.example`)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `APP_PORT` | Host port for FastAPI | `8840` |
| `FRONTEND_PORT` | Host port for Nginx UI | `8841` |
| `DB_PORT` | Host port for PostgreSQL | `5455` |
| `MQTT_PORT` / `MQTT_WS_PORT` | Host ports for Mosquitto TCP / WS | `1892` / `9002` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials | `myomotion_admin` |
| `DATABASE_URL` | SQLAlchemy connection URI | `postgresql://...@myomotion_db:5432/myomotion_rehab` |
| `SECRET_KEY` | HS256 JWT signing secret | `64-char random hex` |
| `ALLOWED_ORIGINS` | Comma-separated CSRF allowed hostnames | `localhost,127.0.0.1,your-domain.com` |
| `RESEND_API_KEY` | Server-side Resend email API key | `re_...` |
| `RESEND_FROM_EMAIL` | Verified sender address | `myomotion@mail.yourdomain.com` |
| `MQTT_BROKER_HOST` / `MQTT_BROKER_PORT` | Internal broker hostname &amp; port | `myomotion_mqtt` / `1883` |

---

## 🗄️ Database Migrations (Alembic)

Alembic is configured in `backend/alembic.ini` and `backend/alembic/`:
```bash
docker exec -it myomotion_backend alembic upgrade head
```
