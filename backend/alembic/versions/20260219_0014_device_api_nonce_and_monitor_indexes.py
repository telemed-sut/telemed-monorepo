"""device_api_nonce_and_monitor_indexes

Revision ID: 20260219_0014
Revises: 20260218_0013
Create Date: 2026-02-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260219_0014"
down_revision: Union[str, None] = "20260218_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "device_request_nonces" not in tables:
        op.create_table(
            "device_request_nonces",
            # Primary keys are indexed implicitly; do not add a separate id index.
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("device_id", sa.String(length=128), nullable=False),
            sa.Column("nonce_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("device_id", "nonce_hash", name="uq_device_request_nonces_device_nonce"),
        )
        op.create_index("ix_device_request_nonces_expires_at", "device_request_nonces", ["expires_at"], unique=False)
        op.create_index(
            "ix_device_request_nonces_device_id_created_at",
            "device_request_nonces",
            ["device_id", "created_at"],
            unique=False,
        )

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "device_error_logs" in tables:
        device_error_log_indexes = _index_names(inspector, "device_error_logs")
        if "ix_device_error_logs_occurred_at" not in device_error_log_indexes:
            op.create_index(
                "ix_device_error_logs_occurred_at",
                "device_error_logs",
                ["occurred_at"],
                unique=False,
            )
        if "ix_device_error_logs_device_id_occurred_at" not in device_error_log_indexes:
            op.create_index(
                "ix_device_error_logs_device_id_occurred_at",
                "device_error_logs",
                ["device_id", "occurred_at"],
                unique=False,
            )

    if "pressure_records" in tables:
        pressure_indexes = _index_names(inspector, "pressure_records")
        if "ix_pressure_records_created_at" not in pressure_indexes:
            op.create_index(
                "ix_pressure_records_created_at",
                "pressure_records",
                ["created_at"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "pressure_records" in tables:
        pressure_indexes = _index_names(inspector, "pressure_records")
        if "ix_pressure_records_created_at" in pressure_indexes:
            op.drop_index("ix_pressure_records_created_at", table_name="pressure_records")

    if "device_error_logs" in tables:
        device_error_log_indexes = _index_names(inspector, "device_error_logs")
        if "ix_device_error_logs_device_id_occurred_at" in device_error_log_indexes:
            op.drop_index("ix_device_error_logs_device_id_occurred_at", table_name="device_error_logs")
        if "ix_device_error_logs_occurred_at" in device_error_log_indexes:
            op.drop_index("ix_device_error_logs_occurred_at", table_name="device_error_logs")

    if "device_request_nonces" in tables:
        nonce_indexes = _index_names(inspector, "device_request_nonces")
        if "ix_device_request_nonces_device_id_created_at" in nonce_indexes:
            op.drop_index("ix_device_request_nonces_device_id_created_at", table_name="device_request_nonces")
        if "ix_device_request_nonces_expires_at" in nonce_indexes:
            op.drop_index("ix_device_request_nonces_expires_at", table_name="device_request_nonces")
        op.drop_table("device_request_nonces")
