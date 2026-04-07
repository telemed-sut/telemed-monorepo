"""Seed admin and doctor users for testing

Revision ID: 20260215_0007
Revises: 20260215_0006
Create Date: 2026-02-15
"""

import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from passlib.context import CryptContext

# revision identifiers, used by Alembic.
revision = "20260215_0007"
down_revision = "20260215_0006"
branch_labels = None
depends_on = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _require_seed_password(env_name: str) -> str:
    password = (os.environ.get(env_name) or "").strip()
    if not password:
        raise ValueError(f"{env_name} must be set before running this seed migration.")
    return password


def upgrade() -> None:
    user_role_enum = postgresql.ENUM(name="user_role", create_type=False)
    verification_status_enum = postgresql.ENUM(name="verification_status", create_type=False)
    users_table = sa.table(
        "users",
        sa.column("id", sa.dialects.postgresql.UUID),
        sa.column("email", sa.String),
        sa.column("first_name", sa.String),
        sa.column("last_name", sa.String),
        sa.column("password_hash", sa.String),
        sa.column("role", user_role_enum),
        sa.column("is_active", sa.Boolean),
        sa.column("specialty", sa.String),
        sa.column("department", sa.String),
        sa.column("license_no", sa.String),
        sa.column("verification_status", verification_status_enum),
    )

    admin_hash = pwd_context.hash(_require_seed_password("SEED_ADMIN_PASSWORD"))
    doctor_hash = pwd_context.hash(_require_seed_password("SEED_DOCTOR_PASSWORD"))

    op.bulk_insert(users_table, [
        {
            "id": "00000000-0000-4000-a000-000000000001",
            "email": "admin@emedhelp.example.com",
            "first_name": "System",
            "last_name": "Admin",
            "password_hash": admin_hash,
            "role": "admin",
            "is_active": True,
            "specialty": None,
            "department": None,
            "license_no": None,
            "verification_status": "verified",
        },
        {
            "id": "00000000-0000-4000-a000-000000000002",
            "email": "doctor@emedhelp.example.com",
            "first_name": "Demo",
            "last_name": "Doctor",
            "password_hash": doctor_hash,
            "role": "doctor",
            "is_active": True,
            "specialty": "Internal Medicine",
            "department": "General Medicine",
            "license_no": "MD12345",
            "verification_status": "verified",
        },
    ])


def downgrade() -> None:
    op.execute(
        "DELETE FROM users WHERE email IN ('admin@emedhelp.example.com', 'doctor@emedhelp.example.com')"
    )
