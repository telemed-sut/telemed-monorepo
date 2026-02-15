"""Add user invites table for admin-generated registration links

Revision ID: 20260213_0003
Revises: 20260212_0002
Create Date: 2026-02-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260213_0003"
down_revision = "20260212_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM("admin", "staff", name="user_role", create_type=False),
            nullable=False,
            server_default="staff",
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(op.f("ix_user_invites_token_hash"), "user_invites", ["token_hash"], unique=True)
    op.create_index(op.f("ix_user_invites_email"), "user_invites", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_invites_email"), table_name="user_invites")
    op.drop_index(op.f("ix_user_invites_token_hash"), table_name="user_invites")
    op.drop_table("user_invites")
