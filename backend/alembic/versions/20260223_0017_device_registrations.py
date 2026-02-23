"""device_registrations

Revision ID: 20260223_0017
Revises: 20260223_0016
Create Date: 2026-02-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260223_0017"
down_revision: Union[str, None] = "20260223_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "device_registrations" not in tables:
        op.create_table(
            "device_registrations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("device_id", sa.String(length=128), nullable=False),
            sa.Column("display_name", sa.String(length=200), nullable=False),
            sa.Column("device_secret", sa.String(length=255), nullable=False),
            sa.Column("notes", sa.String(length=500), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("device_id", name="uq_device_registrations_device_id"),
        )

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector, "device_registrations")
    if "ix_device_registrations_device_id" not in indexes:
        op.create_index("ix_device_registrations_device_id", "device_registrations", ["device_id"], unique=False)
    if "ix_device_registrations_created_by" not in indexes:
        op.create_index("ix_device_registrations_created_by", "device_registrations", ["created_by"], unique=False)
    if "ix_device_registrations_updated_by" not in indexes:
        op.create_index("ix_device_registrations_updated_by", "device_registrations", ["updated_by"], unique=False)
    if "ix_device_registrations_active_created" not in indexes:
        op.create_index(
            "ix_device_registrations_active_created",
            "device_registrations",
            ["is_active", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "device_registrations" not in tables:
        return

    indexes = _index_names(inspector, "device_registrations")
    if "ix_device_registrations_active_created" in indexes:
        op.drop_index("ix_device_registrations_active_created", table_name="device_registrations")
    if "ix_device_registrations_updated_by" in indexes:
        op.drop_index("ix_device_registrations_updated_by", table_name="device_registrations")
    if "ix_device_registrations_created_by" in indexes:
        op.drop_index("ix_device_registrations_created_by", table_name="device_registrations")
    if "ix_device_registrations_device_id" in indexes:
        op.drop_index("ix_device_registrations_device_id", table_name="device_registrations")

    op.drop_table("device_registrations")
