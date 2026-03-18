"""Add meeting room presence table

Revision ID: 20260305_0021
Revises: 20260304_0020
Create Date: 2026-03-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260305_0021"
down_revision: Union[str, None] = "20260304_0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "meeting_room_presence" not in tables:
        op.create_table(
            "meeting_room_presence",
            sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("doctor_joined_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("doctor_last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("doctor_left_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("patient_joined_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("patient_last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("patient_left_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("meeting_id"),
        )

    inspector = sa.inspect(bind)
    if "meeting_room_presence" in set(inspector.get_table_names()):
        indexes = _index_names(inspector, "meeting_room_presence")
        if "ix_meeting_room_presence_updated_at" not in indexes:
            op.create_index(
                "ix_meeting_room_presence_updated_at",
                "meeting_room_presence",
                ["updated_at"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "meeting_room_presence" not in tables:
        return

    indexes = _index_names(inspector, "meeting_room_presence")
    if "ix_meeting_room_presence_updated_at" in indexes:
        op.drop_index("ix_meeting_room_presence_updated_at", table_name="meeting_room_presence")

    op.drop_table("meeting_room_presence")
