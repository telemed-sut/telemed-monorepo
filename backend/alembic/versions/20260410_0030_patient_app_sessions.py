"""add patient app session registry

Revision ID: 20260410_0030
Revises: 20260410_0029
Create Date: 2026-04-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260410_0030"
down_revision: Union[str, None] = "20260410_0029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patient_app_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_patient_app_sessions_patient_id", "patient_app_sessions", ["patient_id"], unique=False)
    op.create_index("ix_patient_app_sessions_session_id", "patient_app_sessions", ["session_id"], unique=True)
    op.create_index("ix_patient_app_sessions_expires_at", "patient_app_sessions", ["expires_at"], unique=False)
    op.create_index("ix_patient_app_sessions_revoked_at", "patient_app_sessions", ["revoked_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_patient_app_sessions_revoked_at", table_name="patient_app_sessions")
    op.drop_index("ix_patient_app_sessions_expires_at", table_name="patient_app_sessions")
    op.drop_index("ix_patient_app_sessions_session_id", table_name="patient_app_sessions")
    op.drop_index("ix_patient_app_sessions_patient_id", table_name="patient_app_sessions")
    op.drop_table("patient_app_sessions")
