"""Add short-code table for patient meeting invites

Revision ID: 20260303_0019
Revises: 20260226_0018
Create Date: 2026-03-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260303_0019"
down_revision: Union[str, None] = "20260226_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "meeting_patient_invite_codes" not in tables:
        op.create_table(
            "meeting_patient_invite_codes",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("code", sa.String(length=24), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code", name="uq_meeting_patient_invite_codes_code"),
        )

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector, "meeting_patient_invite_codes")
    if "ix_meeting_patient_invite_codes_code" not in indexes:
        op.create_index("ix_meeting_patient_invite_codes_code", "meeting_patient_invite_codes", ["code"], unique=False)
    if "ix_meeting_patient_invite_codes_meeting_id" not in indexes:
        op.create_index(
            "ix_meeting_patient_invite_codes_meeting_id",
            "meeting_patient_invite_codes",
            ["meeting_id"],
            unique=False,
        )
    if "ix_meeting_patient_invite_codes_expires_at" not in indexes:
        op.create_index(
            "ix_meeting_patient_invite_codes_expires_at",
            "meeting_patient_invite_codes",
            ["expires_at"],
            unique=False,
        )
    if "ix_meeting_patient_invite_codes_created_by" not in indexes:
        op.create_index(
            "ix_meeting_patient_invite_codes_created_by",
            "meeting_patient_invite_codes",
            ["created_by"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "meeting_patient_invite_codes" not in tables:
        return

    indexes = _index_names(inspector, "meeting_patient_invite_codes")
    if "ix_meeting_patient_invite_codes_created_by" in indexes:
        op.drop_index("ix_meeting_patient_invite_codes_created_by", table_name="meeting_patient_invite_codes")
    if "ix_meeting_patient_invite_codes_expires_at" in indexes:
        op.drop_index("ix_meeting_patient_invite_codes_expires_at", table_name="meeting_patient_invite_codes")
    if "ix_meeting_patient_invite_codes_meeting_id" in indexes:
        op.drop_index("ix_meeting_patient_invite_codes_meeting_id", table_name="meeting_patient_invite_codes")
    if "ix_meeting_patient_invite_codes_code" in indexes:
        op.drop_index("ix_meeting_patient_invite_codes_code", table_name="meeting_patient_invite_codes")

    op.drop_table("meeting_patient_invite_codes")
