"""Add patient app registration codes and PIN columns

Revision ID: 20260304_0020
Revises: 20260303_0019
Create Date: 2026-03-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260304_0020"
down_revision: Union[str, None] = "20260303_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # --- 1. Add PIN hash + app_registered columns to patients table ---
    patient_cols = _column_names(inspector, "patients")

    if "pin_hash" not in patient_cols:
        op.add_column("patients", sa.Column("pin_hash", sa.String(length=255), nullable=True))

    if "app_registered_at" not in patient_cols:
        op.add_column(
            "patients",
            sa.Column("app_registered_at", sa.DateTime(timezone=True), nullable=True),
        )

    # --- 2. Create patient_app_registrations table ---
    if "patient_app_registrations" not in tables:
        op.create_table(
            "patient_app_registrations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("code", sa.String(length=10), nullable=False),
            sa.Column("is_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
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
            sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code", name="uq_patient_app_registrations_code"),
        )

    # Refresh inspector after table creation.
    inspector = sa.inspect(bind)
    if "patient_app_registrations" in set(inspector.get_table_names()):
        indexes = _index_names(inspector, "patient_app_registrations")
        if "ix_patient_app_registrations_patient_id" not in indexes:
            op.create_index(
                "ix_patient_app_registrations_patient_id",
                "patient_app_registrations",
                ["patient_id"],
            )
        if "ix_patient_app_registrations_code" not in indexes:
            op.create_index(
                "ix_patient_app_registrations_code",
                "patient_app_registrations",
                ["code"],
            )
        if "ix_patient_app_registrations_created_by" not in indexes:
            op.create_index(
                "ix_patient_app_registrations_created_by",
                "patient_app_registrations",
                ["created_by"],
            )

    # --- 3. Add patient_invite_url column to meetings table ---
    meeting_cols = _column_names(inspector, "meetings")
    if "patient_invite_url" not in meeting_cols:
        op.add_column("meetings", sa.Column("patient_invite_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Drop meetings.patient_invite_url
    meeting_cols = _column_names(inspector, "meetings")
    if "patient_invite_url" in meeting_cols:
        op.drop_column("meetings", "patient_invite_url")

    # Drop patient_app_registrations table
    if "patient_app_registrations" in tables:
        indexes = _index_names(inspector, "patient_app_registrations")
        for idx_name in [
            "ix_patient_app_registrations_created_by",
            "ix_patient_app_registrations_code",
            "ix_patient_app_registrations_patient_id",
        ]:
            if idx_name in indexes:
                op.drop_index(idx_name, table_name="patient_app_registrations")
        op.drop_table("patient_app_registrations")

    # Drop patients columns
    patient_cols = _column_names(inspector, "patients")
    if "app_registered_at" in patient_cols:
        op.drop_column("patients", "app_registered_at")
    if "pin_hash" in patient_cols:
        op.drop_column("patients", "pin_hash")
