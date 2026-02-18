"""add_2fa_trusted_devices_and_backup_codes

Revision ID: 20260218_0011
Revises: 20260218_0010
Create Date: 2026-02-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260218_0011"
down_revision: Union[str, None] = "20260218_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_trusted_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_agent_hash", sa.String(length=128), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_trusted_devices_user_id", "user_trusted_devices", ["user_id"], unique=False)
    op.create_index("ix_user_trusted_devices_token_hash", "user_trusted_devices", ["token_hash"], unique=True)
    op.create_index("ix_user_trusted_devices_expires_at", "user_trusted_devices", ["expires_at"], unique=False)
    op.create_index("ix_user_trusted_devices_revoked_at", "user_trusted_devices", ["revoked_at"], unique=False)

    op.create_table(
        "user_backup_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code_hash", sa.String(length=128), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_backup_codes_user_id", "user_backup_codes", ["user_id"], unique=False)
    op.create_index("ix_user_backup_codes_code_hash", "user_backup_codes", ["code_hash"], unique=False)
    op.create_index("ix_user_backup_codes_batch_id", "user_backup_codes", ["batch_id"], unique=False)
    op.create_index("ix_user_backup_codes_used_at", "user_backup_codes", ["used_at"], unique=False)
    op.create_index("ix_user_backup_codes_expires_at", "user_backup_codes", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_backup_codes_expires_at", table_name="user_backup_codes")
    op.drop_index("ix_user_backup_codes_used_at", table_name="user_backup_codes")
    op.drop_index("ix_user_backup_codes_batch_id", table_name="user_backup_codes")
    op.drop_index("ix_user_backup_codes_code_hash", table_name="user_backup_codes")
    op.drop_index("ix_user_backup_codes_user_id", table_name="user_backup_codes")
    op.drop_table("user_backup_codes")

    op.drop_index("ix_user_trusted_devices_revoked_at", table_name="user_trusted_devices")
    op.drop_index("ix_user_trusted_devices_expires_at", table_name="user_trusted_devices")
    op.drop_index("ix_user_trusted_devices_token_hash", table_name="user_trusted_devices")
    op.drop_index("ix_user_trusted_devices_user_id", table_name="user_trusted_devices")
    op.drop_table("user_trusted_devices")
