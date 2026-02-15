"""Add security: brute force columns, ip_bans, login_attempts tables

Revision ID: 20260215_0008
Revises: 20260215_0007
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "20260215_0008"
down_revision = "20260215_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add brute force columns to users
    op.add_column(
        "users",
        sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("account_locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_failed_login_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Create ip_bans table
    op.create_table(
        "ip_bans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("ip_address", sa.String(45), nullable=False, unique=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("banned_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_ip_bans_ip_address"), "ip_bans", ["ip_address"])

    # Create login_attempts table
    op.create_table(
        "login_attempts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("ip_address", sa.String(45), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(op.f("ix_login_attempts_ip_address"), "login_attempts", ["ip_address"])
    op.create_index(op.f("ix_login_attempts_created_at"), "login_attempts", ["created_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_login_attempts_created_at"), table_name="login_attempts")
    op.drop_index(op.f("ix_login_attempts_ip_address"), table_name="login_attempts")
    op.drop_table("login_attempts")
    op.drop_index(op.f("ix_ip_bans_ip_address"), table_name="ip_bans")
    op.drop_table("ip_bans")
    op.drop_column("users", "last_failed_login_at")
    op.drop_column("users", "account_locked_until")
    op.drop_column("users", "failed_login_attempts")
