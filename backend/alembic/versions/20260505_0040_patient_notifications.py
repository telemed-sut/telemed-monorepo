"""Add patient_notifications table.

Patient mobile-app notifications (distinct from clinical alerts).

Revision ID: 20260505_0040
Revises: 7bd3c4a9e12f
Create Date: 2026-05-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260505_0040"
down_revision: Union[str, None] = "7bd3c4a9e12f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CATEGORY_VALUES = ("critical", "warning", "info", "normal")
_ENUM_NAME = "patient_notification_category"


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    category_enum = postgresql.ENUM(
        *_CATEGORY_VALUES,
        name=_ENUM_NAME,
        create_type=False,
    )
    # Create the enum type if it doesn't already exist (idempotent for re-runs).
    bind.execute(
        sa.text(
            "DO $$ BEGIN "
            f"CREATE TYPE {_ENUM_NAME} AS ENUM ("
            + ", ".join(f"'{v}'" for v in _CATEGORY_VALUES)
            + "); "
            "EXCEPTION WHEN duplicate_object THEN null; END $$;"
        )
    )

    if "patient_notifications" not in tables:
        op.create_table(
            "patient_notifications",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column(
                "category",
                category_enum,
                nullable=False,
                server_default="info",
            ),
            sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column(
                "is_read",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    if "patient_notifications" in set(inspector.get_table_names()):
        existing_indexes = _index_names(inspector, "patient_notifications")
        if "ix_patient_notifications_patient_id" not in existing_indexes:
            op.create_index(
                "ix_patient_notifications_patient_id",
                "patient_notifications",
                ["patient_id"],
            )
        if "ix_patient_notifications_created_at" not in existing_indexes:
            op.create_index(
                "ix_patient_notifications_created_at",
                "patient_notifications",
                ["created_at"],
            )
        if "ix_patient_notifications_patient_unread" not in existing_indexes:
            op.create_index(
                "ix_patient_notifications_patient_unread",
                "patient_notifications",
                ["patient_id", "is_read"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "patient_notifications" in tables:
        existing_indexes = _index_names(inspector, "patient_notifications")
        for name in (
            "ix_patient_notifications_patient_unread",
            "ix_patient_notifications_created_at",
            "ix_patient_notifications_patient_id",
        ):
            if name in existing_indexes:
                op.drop_index(name, table_name="patient_notifications")
        op.drop_table("patient_notifications")

    bind.execute(sa.text(f"DROP TYPE IF EXISTS {_ENUM_NAME}"))
