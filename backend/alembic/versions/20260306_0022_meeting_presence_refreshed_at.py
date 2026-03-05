"""Add refreshed_at to meeting room presence

Revision ID: 20260306_0022
Revises: 20260305_0021
Create Date: 2026-03-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260306_0022"
down_revision: Union[str, None] = "20260305_0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "meeting_room_presence"
    tables = set(inspector.get_table_names())
    if table_name not in tables:
        return

    columns = _column_names(inspector, table_name)
    if "refreshed_at" not in columns:
        op.add_column(
            table_name,
            sa.Column(
                "refreshed_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector, table_name)
    if "ix_meeting_room_presence_refreshed_at" not in indexes:
        op.create_index(
            "ix_meeting_room_presence_refreshed_at",
            table_name,
            ["refreshed_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "meeting_room_presence"
    tables = set(inspector.get_table_names())
    if table_name not in tables:
        return

    indexes = _index_names(inspector, table_name)
    if "ix_meeting_room_presence_refreshed_at" in indexes:
        op.drop_index("ix_meeting_room_presence_refreshed_at", table_name=table_name)

    columns = _column_names(inspector, table_name)
    if "refreshed_at" in columns:
        op.drop_column(table_name, "refreshed_at")
