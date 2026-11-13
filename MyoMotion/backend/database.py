import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import (
    create_engine, Column, Integer, String, Boolean, Float, DateTime, Text, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

# Malaysia Standard Time (UTC+8) — used consistently for DB & OTP timestamps
MALAYSIA_TZ = ZoneInfo("Asia/Kuala_Lumpur")


def now_local() -> datetime:
    """
    Naive local time in Asia/Kuala_Lumpur.
    NB: Returns NAIVE (tzinfo stripped) so it stays compatible with
    TIMESTAMP WITHOUT TIME ZONE columns — Postgres reads those back as
    naive datetimes, so comparisons must be naive-vs-naive.
    """
    return datetime.now(MALAYSIA_TZ).replace(tzinfo=None)


def now_utc() -> datetime:
    """Timezone-aware current time in UTC (for JWT exp claims)."""
    return datetime.now(timezone.utc)

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://myomotion_admin:myo_s3cur3_p4ss_2026@myomotion_db:5432/myomotion_rehab"
)

# Connect with connection pool & pre-ping to withstand DB restarts
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_local, nullable=False)

    devices = relationship("Device", back_populates="owner", cascade="all, delete-orphan")
    rehab_sessions = relationship("RehabSession", back_populates="owner", cascade="all, delete-orphan")


class OTPRecord(Base):
    __tablename__ = "otp_records"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), index=True, nullable=False)
    otp = Column(String(6), nullable=False)
    purpose = Column(String(30), default="register", nullable=False)  # "register" | "password_reset"
    failed_attempts = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=now_local, nullable=False)


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mac_address = Column(String(32), index=True, nullable=False)
    device_name = Column(String(100), default="MyoMotion Node", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=now_local, nullable=False)

    owner = relationship("User", back_populates="devices")


class RehabSession(Base):
    __tablename__ = "rehab_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_mac = Column(String(32), nullable=True)
    target_joint = Column(String(20), nullable=False)  # "elbow" | "wrist"
    target_muscle = Column(String(20), nullable=False)  # "biceps" | "forearm"
    patient_name = Column(String(100), default="Patient", nullable=False)
    
    start_time = Column(DateTime, default=now_local, nullable=False)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, default=0, nullable=False)
    
    # Biomechanical Kinematics ROM
    max_flexion_deg = Column(Float, default=0.0, nullable=False)
    max_extension_deg = Column(Float, default=0.0, nullable=False)
    max_deviation_radial_deg = Column(Float, default=0.0, nullable=False)
    max_deviation_ulnar_deg = Column(Float, default=0.0, nullable=False)
    
    # Electromyography (sEMG) Biofeedback Metrics
    peak_emg_mvc = Column(Float, default=0.0, nullable=False)
    avg_emg_mvc = Column(Float, default=0.0, nullable=False)
    reps_count = Column(Integer, default=0, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_local, nullable=False)

    owner = relationship("User", back_populates="rehab_sessions")


def ensure_schema_columns() -> None:
    """Safely add newer security columns onto existing PostgreSQL tables without dropping data."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL;",
        "ALTER TABLE otp_records ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;"
    ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
