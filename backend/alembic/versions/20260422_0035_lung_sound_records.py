"""lung sound records

Revision ID: 20260422_0035
Revises: 20260422_0034
Create Date: 2026-04-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260422_0035"
down_revision: Union[str, None] = "20260422_0034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "lung_sound_records" not in tables:
        op.create_table(
            "lung_sound_records",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("device_exam_session_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("device_id", sa.String(length=128), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("blob_url", sa.String(length=2048), nullable=True),
            sa.Column("storage_key", sa.String(length=1024), nullable=True),
            sa.Column("mime_type", sa.String(length=128), nullable=True),
            sa.Column("duration_seconds", sa.Integer(), nullable=True),
            sa.Column("sample_rate_hz", sa.Integer(), nullable=True),
            sa.Column("channel_count", sa.Integer(), nullable=True),
            sa.Column("wheeze_score", sa.Integer(), nullable=True),
            sa.Column("crackle_score", sa.Integer(), nullable=True),
            sa.Column("analysis", sa.JSON(), nullable=True),
            sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["device_exam_session_id"], ["device_exam_sessions.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("device_id", "recorded_at", "position", name="uq_lung_sound_records_device_recorded_position"),
        )

    inspector = sa.inspect(bind)
    if "lung_sound_records" in inspector.get_table_names():
        indexes = _index_names(inspector, "lung_sound_records")
        for index_name, columns in {
            "ix_lung_sound_records_patient_id": ["patient_id"],
            "ix_lung_sound_records_device_exam_session_id": ["device_exam_session_id"],
            "ix_lung_sound_records_device_id": ["device_id"],
            "ix_lung_sound_records_position": ["position"],
            "ix_lung_sound_records_recorded_at": ["recorded_at"],
            "ix_lung_sound_records_blob_url": ["blob_url"],
        }.items():
            if index_name not in indexes:
                op.create_index(index_name, "lung_sound_records", columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "lung_sound_records" not in inspector.get_table_names():
        return

    indexes = _index_names(inspector, "lung_sound_records")
    for index_name in (
        "ix_lung_sound_records_blob_url",
        "ix_lung_sound_records_recorded_at",
        "ix_lung_sound_records_position",
        "ix_lung_sound_records_device_id",
        "ix_lung_sound_records_device_exam_session_id",
        "ix_lung_sound_records_patient_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="lung_sound_records")
    op.drop_table("lung_sound_records")
