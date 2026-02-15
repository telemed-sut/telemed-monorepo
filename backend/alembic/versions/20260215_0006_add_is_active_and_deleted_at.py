"""Add is_active and deleted_at columns to users table

Revision ID: 20260215_0006
Revises: 20260215_0005
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260215_0006"
down_revision = "20260215_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f("ix_users_deleted_at"), "users", ["deleted_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_users_deleted_at"), table_name="users")
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "is_active")
