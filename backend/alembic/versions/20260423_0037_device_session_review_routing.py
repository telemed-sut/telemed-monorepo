"""device session review routing foundations

Revision ID: 20260423_0037
Revises: 20260422_0036
Create Date: 2026-04-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260423_0037"
down_revision: Union[str, None] = "20260422_0036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _constraint_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect = bind.dialect.name

    if dialect == "postgresql":
        # PostgreSQL requires enum value additions to commit before the values
        # can be referenced by indexes or check constraints in the same migration.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE device_exam_session_status ADD VALUE IF NOT EXISTS 'stale'")
            op.execute("ALTER TYPE device_exam_session_status ADD VALUE IF NOT EXISTS 'review_needed'")
        bind = op.get_bind()
        postgresql.ENUM(
            "manual_complete",
            "timeout",
            "cancelled",
            "preempted_by_new_session",
            name="device_exam_session_resolution_reason",
        ).create(bind, checkfirst=True)
        postgresql.ENUM(
            "verified",
            "needs_review",
            "unmatched",
            "quarantined",
            name="device_measurement_routing_status",
        ).create(bind, checkfirst=True)

    device_session_columns = _column_names(inspector, "device_exam_sessions")
    if "resolution_reason" not in device_session_columns:
        op.add_column(
            "device_exam_sessions",
            sa.Column(
                "resolution_reason",
                sa.Enum(
                    "manual_complete",
                    "timeout",
                    "cancelled",
                    "preempted_by_new_session",
                    name="device_exam_session_resolution_reason",
                ),
                nullable=True,
            ),
        )

    inspector = sa.inspect(bind)
    session_indexes = _index_names(inspector, "device_exam_sessions")
    if dialect == "postgresql" and "uq_device_exam_sessions_device_open" not in session_indexes:
        op.create_index(
            "uq_device_exam_sessions_device_open",
            "device_exam_sessions",
            ["device_id"],
            unique=True,
            postgresql_where=sa.text("status IN ('pending_pair', 'active', 'stale')"),
        )

    session_constraints = _constraint_names(inspector, "device_exam_sessions")
    if "ck_device_exam_sessions_status_ended_at" not in session_constraints:
        op.create_check_constraint(
            "ck_device_exam_sessions_status_ended_at",
            "device_exam_sessions",
            "((status IN ('completed', 'cancelled', 'review_needed') AND ended_at IS NOT NULL) "
            "OR (status IN ('pending_pair', 'active', 'stale') AND ended_at IS NULL))",
        )

    lung_columns = _column_names(inspector, "lung_sound_records")
    if "routing_status" not in lung_columns:
        op.add_column(
            "lung_sound_records",
            sa.Column(
                "routing_status",
                sa.Enum(
                    "verified",
                    "needs_review",
                    "unmatched",
                    "quarantined",
                    name="device_measurement_routing_status",
                ),
                nullable=False,
                server_default="verified",
            ),
        )
    if "conflict_metadata" not in lung_columns:
        op.add_column("lung_sound_records", sa.Column("conflict_metadata", sa.JSON(), nullable=True))
    if "server_received_at" not in lung_columns:
        op.add_column(
            "lung_sound_records",
            sa.Column(
                "server_received_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    op.alter_column("lung_sound_records", "patient_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.execute(
        "UPDATE lung_sound_records SET routing_status = 'verified' WHERE routing_status IS NULL"
    )
    op.execute(
        "UPDATE lung_sound_records SET server_received_at = COALESCE(created_at, recorded_at) WHERE server_received_at IS NULL"
    )

    inspector = sa.inspect(bind)
    lung_indexes = _index_names(inspector, "lung_sound_records")
    if "ix_lung_sound_records_session_routing" not in lung_indexes:
        op.create_index(
            "ix_lung_sound_records_session_routing",
            "lung_sound_records",
            ["device_exam_session_id", "routing_status"],
            unique=False,
        )
    if "ix_lung_sound_records_device_received_at" not in lung_indexes:
        op.create_index(
            "ix_lung_sound_records_device_received_at",
            "lung_sound_records",
            ["device_id", "server_received_at"],
            unique=False,
        )

    lung_constraints = _constraint_names(inspector, "lung_sound_records")
    if "ck_lung_sound_records_routing_consistency" not in lung_constraints:
        op.create_check_constraint(
            "ck_lung_sound_records_routing_consistency",
            "lung_sound_records",
            "((routing_status = 'verified' AND device_exam_session_id IS NOT NULL) "
            "OR (routing_status = 'unmatched' AND device_exam_session_id IS NULL) "
            "OR routing_status IN ('needs_review', 'quarantined'))",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    dialect = bind.dialect.name

    lung_indexes = _index_names(inspector, "lung_sound_records")
    for index_name in (
        "ix_lung_sound_records_device_received_at",
        "ix_lung_sound_records_session_routing",
    ):
        if index_name in lung_indexes:
            op.drop_index(index_name, table_name="lung_sound_records")

    lung_constraints = _constraint_names(inspector, "lung_sound_records")
    if "ck_lung_sound_records_routing_consistency" in lung_constraints:
        op.drop_constraint("ck_lung_sound_records_routing_consistency", "lung_sound_records", type_="check")

    lung_columns = _column_names(inspector, "lung_sound_records")
    if "server_received_at" in lung_columns:
        op.drop_column("lung_sound_records", "server_received_at")
    if "conflict_metadata" in lung_columns:
        op.drop_column("lung_sound_records", "conflict_metadata")
    if "routing_status" in lung_columns:
        op.drop_column("lung_sound_records", "routing_status")

    op.alter_column("lung_sound_records", "patient_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    session_constraints = _constraint_names(inspector, "device_exam_sessions")
    if "ck_device_exam_sessions_status_ended_at" in session_constraints:
        op.drop_constraint("ck_device_exam_sessions_status_ended_at", "device_exam_sessions", type_="check")

    session_indexes = _index_names(inspector, "device_exam_sessions")
    if dialect == "postgresql" and "uq_device_exam_sessions_device_open" in session_indexes:
        op.drop_index("uq_device_exam_sessions_device_open", table_name="device_exam_sessions")

    session_columns = _column_names(inspector, "device_exam_sessions")
    if "resolution_reason" in session_columns:
        op.drop_column("device_exam_sessions", "resolution_reason")
