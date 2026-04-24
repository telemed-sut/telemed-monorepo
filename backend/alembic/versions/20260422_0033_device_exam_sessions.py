"""device exam sessions

Revision ID: 20260422_0033
Revises: 20260411_0032
Create Date: 2026-04-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260422_0033"
down_revision: Union[str, None] = "20260411_0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    session_status_enum = postgresql.ENUM(
        "pending_pair",
        "active",
        "completed",
        "cancelled",
        name="device_exam_session_status",
    )
    measurement_type_enum = postgresql.ENUM(
        "lung_sound",
        "heart_sound",
        "blood_pressure",
        "multi",
        name="device_exam_measurement_type",
    )
    session_status_enum.create(bind, checkfirst=True)
    measurement_type_enum.create(bind, checkfirst=True)

    if "device_exam_sessions" not in tables:
        op.create_table(
            "device_exam_sessions",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("encounter_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("started_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("ended_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("device_id", sa.String(length=128), nullable=False),
            sa.Column(
                "measurement_type",
                postgresql.ENUM(
                    "lung_sound",
                    "heart_sound",
                    "blood_pressure",
                    "multi",
                    name="device_exam_measurement_type",
                    create_type=False,
                ),
                nullable=False,
            ),
            sa.Column(
                "status",
                postgresql.ENUM(
                    "pending_pair",
                    "active",
                    "completed",
                    "cancelled",
                    name="device_exam_session_status",
                    create_type=False,
                ),
                nullable=False,
                server_default=sa.text("'active'"),
            ),
            sa.Column("pairing_code", sa.String(length=32), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["encounter_id"], ["encounters.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["started_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["ended_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector, "device_exam_sessions")
    if "ix_device_exam_sessions_patient_id" not in indexes:
        op.create_index("ix_device_exam_sessions_patient_id", "device_exam_sessions", ["patient_id"], unique=False)
    if "ix_device_exam_sessions_encounter_id" not in indexes:
        op.create_index("ix_device_exam_sessions_encounter_id", "device_exam_sessions", ["encounter_id"], unique=False)
    if "ix_device_exam_sessions_started_by" not in indexes:
        op.create_index("ix_device_exam_sessions_started_by", "device_exam_sessions", ["started_by"], unique=False)
    if "ix_device_exam_sessions_ended_by" not in indexes:
        op.create_index("ix_device_exam_sessions_ended_by", "device_exam_sessions", ["ended_by"], unique=False)
    if "ix_device_exam_sessions_device_id" not in indexes:
        op.create_index("ix_device_exam_sessions_device_id", "device_exam_sessions", ["device_id"], unique=False)
    if "ix_device_exam_sessions_pairing_code" not in indexes:
        op.create_index("ix_device_exam_sessions_pairing_code", "device_exam_sessions", ["pairing_code"], unique=False)
    if "ix_device_exam_sessions_device_status_started" not in indexes:
        op.create_index(
            "ix_device_exam_sessions_device_status_started",
            "device_exam_sessions",
            ["device_id", "status", "started_at"],
            unique=False,
        )
    if "ix_device_exam_sessions_patient_status_created" not in indexes:
        op.create_index(
            "ix_device_exam_sessions_patient_status_created",
            "device_exam_sessions",
            ["patient_id", "status", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "device_exam_sessions" in tables:
        indexes = _index_names(inspector, "device_exam_sessions")
        for index_name in (
            "ix_device_exam_sessions_patient_status_created",
            "ix_device_exam_sessions_device_status_started",
            "ix_device_exam_sessions_pairing_code",
            "ix_device_exam_sessions_device_id",
            "ix_device_exam_sessions_ended_by",
            "ix_device_exam_sessions_started_by",
            "ix_device_exam_sessions_encounter_id",
            "ix_device_exam_sessions_patient_id",
        ):
            if index_name in indexes:
                op.drop_index(index_name, table_name="device_exam_sessions")
        op.drop_table("device_exam_sessions")

    postgresql.ENUM(name="device_exam_session_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="device_exam_measurement_type").drop(bind, checkfirst=True)
