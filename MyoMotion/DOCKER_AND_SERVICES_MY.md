# Seni Bina Docker, Perkhidmatan &amp; Pemetaan Port

> Topologi pemasangan berbilang kontena, susunan kebergantungan semakan kesihatan, polisi putaran log, dan matriks konfigurasi persekitaran.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](DOCKER_AND_SERVICES.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](DOCKER_AND_SERVICES_MY.md)**

---

## 🐳 Perkhidmatan Kontena &amp; Matriks Port

Semua perkhidmatan dijalankan di dalam rangkaian jambatan luaran sepunya **`pwn20wnd-network`** dengan `TZ=Asia/Kuala_Lumpur` (GMT+8) serta putaran log `json-file` (`max-size: "10m"`, `max-file: "3"`).

| Perkhidmatan | Nama Kontena | Imej / Binaan | Port Hos | Port Dalaman | Tujuan |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `db` | `myomotion_db` | `postgres:15-alpine` | `5455` | `5432` | Storan hubungan (`PGTZ=Asia/Kuala_Lumpur`, semakan `pg_isready`) |
| `mqtt` | `myomotion_mqtt` | `eclipse-mosquitto:latest` | `1892` / `9002` | `1883` / `9001` | Broker MQTT TCP &amp; pendengar WebSockets |
| `backend` | `myomotion_backend` | `./backend` (`appuser` bukan-root) | `8840` | `8000` | REST FastAPI, jambatan WebSocket, pekerja Paho-MQTT |
| `frontend` | `myomotion_frontend` | `./frontend` (`nginx:alpine`) | `8841` | `80` | Penghalaan URL bersih (`/rehab`, `/settings`, `/history`) &amp; proksi terbalik |

---

## 🔄 Urutan Permulaan &amp; Semakan Kesihatan

1. `myomotion_db` bermula dan menjalankan `pg_isready` setiap 5 saat.
2. `myomotion_backend` menunggu `db: condition: service_healthy` dan turut menjalankan `wait_for_database()` (sehingga 30 cubaan) sebelum melaksanakan `Base.metadata.create_all()` dan `ensure_schema_columns()`.
3. `myomotion_frontend` memproksi `/api/*` dan `/ws/*` ke `http://myomotion_backend:8000`.

---

## ⚙️ Matriks Pemboleh Ubah Persekitaran (`.env.example`)

| Pemboleh Ubah | Penerangan | Contoh |
| :--- | :--- | :--- |
| `APP_PORT` | Port hos untuk FastAPI | `8840` |
| `FRONTEND_PORT` | Port hos untuk Nginx UI | `8841` |
| `DB_PORT` | Port hos untuk PostgreSQL | `5455` |
| `MQTT_PORT` / `MQTT_WS_PORT` | Port hos untuk Mosquitto TCP / WS | `1892` / `9002` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Kredensial pangkalan data | `myomotion_admin` |
| `DATABASE_URL` | URI sambungan SQLAlchemy | `postgresql://...@myomotion_db:5432/myomotion_rehab` |
| `SECRET_KEY` | Kunci tandatangan JWT HS256 | `64-char random hex` |
| `ALLOWED_ORIGINS` | Senarai hos asal CSRF dibenarkan | `localhost,127.0.0.1,your-domain.com` |
| `RESEND_API_KEY` | Kunci API e-mel Resend sebelah pelayan | `re_...` |
| `RESEND_FROM_EMAIL` | Alamat penghantar disahkan | `myomotion@mail.yourdomain.com` |
| `MQTT_BROKER_HOST` / `MQTT_BROKER_PORT` | Hos &amp; port broker dalaman | `myomotion_mqtt` / `1883` |

---

## 🗄️ Migrasi Pangkalan Data (Alembic)

Alembic dikonfigurasikan dalam `backend/alembic.ini` dan `backend/alembic/`:
```bash
docker exec -it myomotion_backend alembic upgrade head
```
