"""Expand user roles and add professional verification fields

Revision ID: 20260215_0005
Revises: 20260214_0004
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260215_0005"
down_revision = "20260214_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add new values to user_role ENUM
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pharmacist'")
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'medical_technologist'")
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'psychologist'")

    # 2. Create verification_status ENUM
    verification_status = postgresql.ENUM(
        "unverified", "pending", "verified",
        name="verification_status", create_type=False,
    )
    verification_status.create(op.get_bind(), checkfirst=True)

    # 3. Add professional verification columns to users
    op.add_column("users", sa.Column("license_no", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("license_expiry", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "verification_status",
            postgresql.ENUM("unverified", "pending", "verified", name="verification_status", create_type=False),
            nullable=False,
            server_default="unverified",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "verification_status")
    op.drop_column("users", "license_expiry")
    op.drop_column("users", "license_no")
    op.execute("DROP TYPE IF EXISTS verification_status")
    # Note: Cannot remove values from user_role ENUM in PostgreSQL without recreating it
