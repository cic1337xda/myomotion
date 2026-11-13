"""Initial MyoMotion schema with security lockout & OTP attempt columns.

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-11-12
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("username", sa.String(length=50), nullable=False, unique=True),
        sa.Column("email", sa.String(length=100), nullable=False, unique=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "otp_records",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("email", sa.String(length=100), nullable=False, index=True),
        sa.Column("otp", sa.String(length=6), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False, server_default="register"),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("mac_address", sa.String(length=32), nullable=False, index=True),
        sa.Column("device_name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "rehab_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("device_mac", sa.String(length=32), nullable=True),
        sa.Column("target_joint", sa.String(length=20), nullable=False),
        sa.Column("target_muscle", sa.String(length=20), nullable=False),
        sa.Column("patient_name", sa.String(length=100), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_flexion_deg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_extension_deg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_deviation_radial_deg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_deviation_ulnar_deg", sa.Float(), nullable=False, server_default="0"),
        sa.Column("peak_emg_mvc", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_emg_mvc", sa.Float(), nullable=False, server_default="0"),
        sa.Column("reps_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rehab_sessions")
    op.drop_table("devices")
    op.drop_table("otp_records")
    op.drop_table("users")
