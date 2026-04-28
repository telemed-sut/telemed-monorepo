"""device exam session links for measurement records

Revision ID: 20260422_0034
Revises: 20260422_0033
Create Date: 2026-04-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260422_0034"
down_revision: Union[str, None] = "20260422_0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "pressure_records" in tables:
        pressure_columns = _column_names(inspector, "pressure_records")
        if "device_exam_session_id" not in pressure_columns:
            op.add_column(
                "pressure_records",
                sa.Column("device_exam_session_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_pressure_records_device_exam_session_id",
                "pressure_records",
                "device_exam_sessions",
                ["device_exam_session_id"],
                ["id"],
                ondelete="SET NULL",
            )

    inspector = sa.inspect(bind)
    if "pressure_records" in inspector.get_table_names():
        pressure_indexes = _index_names(inspector, "pressure_records")
        if "ix_pressure_records_device_exam_session_id" not in pressure_indexes:
            op.create_index(
                "ix_pressure_records_device_exam_session_id",
                "pressure_records",
                ["device_exam_session_id"],
                unique=False,
            )

    if "heart_sound_records" in tables:
        heart_columns = _column_names(inspector, "heart_sound_records")
        if "device_exam_session_id" not in heart_columns:
            op.add_column(
                "heart_sound_records",
                sa.Column("device_exam_session_id", postgresql.UUID(as_uuid=True), nullable=True),
            )
            op.create_foreign_key(
                "fk_heart_sound_records_device_exam_session_id",
                "heart_sound_records",
                "device_exam_sessions",
                ["device_exam_session_id"],
                ["id"],
                ondelete="SET NULL",
            )

    inspector = sa.inspect(bind)
    if "heart_sound_records" in inspector.get_table_names():
        heart_indexes = _index_names(inspector, "heart_sound_records")
        if "ix_heart_sound_records_device_exam_session_id" not in heart_indexes:
            op.create_index(
                "ix_heart_sound_records_device_exam_session_id",
                "heart_sound_records",
                ["device_exam_session_id"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "heart_sound_records" in tables:
        heart_indexes = _index_names(inspector, "heart_sound_records")
        if "ix_heart_sound_records_device_exam_session_id" in heart_indexes:
            op.drop_index("ix_heart_sound_records_device_exam_session_id", table_name="heart_sound_records")
        heart_columns = _column_names(inspector, "heart_sound_records")
        if "device_exam_session_id" in heart_columns:
            op.drop_constraint(
                "fk_heart_sound_records_device_exam_session_id",
                "heart_sound_records",
                type_="foreignkey",
            )
            op.drop_column("heart_sound_records", "device_exam_session_id")

    inspector = sa.inspect(bind)
    if "pressure_records" in tables:
        pressure_indexes = _index_names(inspector, "pressure_records")
        if "ix_pressure_records_device_exam_session_id" in pressure_indexes:
            op.drop_index("ix_pressure_records_device_exam_session_id", table_name="pressure_records")
        pressure_columns = _column_names(inspector, "pressure_records")
        if "device_exam_session_id" in pressure_columns:
            op.drop_constraint(
                "fk_pressure_records_device_exam_session_id",
                "pressure_records",
                type_="foreignkey",
            )
            op.drop_column("pressure_records", "device_exam_session_id")
