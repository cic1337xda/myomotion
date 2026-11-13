import asyncio
import time
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import engine, Base, MALAYSIA_TZ, ensure_schema_columns
from middleware import SecurityAndTracingMiddleware
from mqtt_manager import (
    start_mqtt_client, stop_mqtt_client, set_main_event_loop
)

# Import sub-routers
from routers.auth_routes import router as auth_router
from routers.device_routes import router as device_router
from routers.rehab_routes import router as rehab_router
from routers.telemetry_routes import router as telemetry_router

limiter = Limiter(key_func=get_remote_address)


def wait_for_database(max_retries: int = 30, delay_sec: int = 2) -> bool:
    """
    Blocking retry loop that waits until PostgreSQL accepts TCP connections.
    Robust against first-boot initdb delays that cause the classic
    'backend started before DB ready' race condition.
    """
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception as e:
            print(f"[DB] PostgreSQL not ready yet (attempt {attempt}/{max_retries}): {e}", flush=True)
            time.sleep(delay_sec)
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Wait for PostgreSQL to become reachable, then initialize/sync schemas
    if wait_for_database():
        try:
            Base.metadata.create_all(bind=engine)
            ensure_schema_columns()
            print("[SYSTEM] PostgreSQL Database schemas verified and synced.", flush=True)
        except Exception as e:
            print(f"[ERROR] Database migration check failed: {e}", flush=True)
    else:
        print("[ERROR] Database unreachable after retries. Continuing (will retry on restart).", flush=True)

    # 2. Bridge event loop to MQTT manager
    loop = asyncio.get_running_loop()
    set_main_event_loop(loop)

    # 3. Spin up Paho-MQTT background client
    start_mqtt_client()

    yield

    # Teardown actions on shutdown
    stop_mqtt_client()
    print("[SYSTEM] System shutdown completed.", flush=True)


app = FastAPI(
    title="MyoMotion Rehabilitation API",
    description="Secure Biomechanical Kinematics & sEMG Biofeedback Clinical Platform",
    version="1.0.0",
    lifespan=lifespan
)

# Enforce Rate Limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# HTTP Security Headers, Request-ID Tracing & CSRF Origin Validation
app.add_middleware(SecurityAndTracingMiddleware)

# CORS Policy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Production behind Nginx reverse proxy
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register functional routers
app.include_router(auth_router)
app.include_router(device_router)
app.include_router(rehab_router)
app.include_router(telemetry_router)


@app.get("/api/health", tags=["System"])
@app.get("/api/v1/health", tags=["System"])
def health_check():
    db_status = "disconnected"
    status_code = 503
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
        status_code = 200
    except Exception:
        db_status = "disconnected"

    payload = {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "timestamp": datetime.now(MALAYSIA_TZ).isoformat(timespec="seconds"),
        "service": "MyoMotion Backend Engine",
        "version": "1.0.0"
    }
    return JSONResponse(status_code=status_code, content=payload)
