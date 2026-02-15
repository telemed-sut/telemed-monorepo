"""Add status, reason, cancelled_at, cancelled_by to meetings

Revision ID: 20260215_0009
Revises: 20260215_0008
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "20260215_0009"
down_revision = "20260215_0008"
branch_labels = None
depends_on = None

# Enum values
MEETING_STATUS_VALUES = ("scheduled", "waiting", "in_progress", "overtime", "completed", "cancelled")


def upgrade() -> None:
    # 1. Create the enum type
    meetingstatus = sa.Enum(*MEETING_STATUS_VALUES, name="meetingstatus")
    meetingstatus.create(op.get_bind(), checkfirst=True)

    # 2. Add columns
    op.add_column("meetings", sa.Column("status", sa.Enum(*MEETING_STATUS_VALUES, name="meetingstatus"), nullable=False, server_default="scheduled"))
    op.add_column("meetings", sa.Column("reason", sa.Text(), nullable=True))
    op.add_column("meetings", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("meetings", sa.Column("cancelled_by", UUID(as_uuid=True), nullable=True))

    # 3. Index on status for fast filtering
    op.create_index("ix_meetings_status", "meetings", ["status"])

    # 4. Foreign key for cancelled_by → users.id
    op.create_foreign_key(
        "fk_meetings_cancelled_by_users",
        "meetings",
        "users",
        ["cancelled_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_meetings_cancelled_by_users", "meetings", type_="foreignkey")
    op.drop_index("ix_meetings_status", table_name="meetings")
    op.drop_column("meetings", "cancelled_by")
    op.drop_column("meetings", "cancelled_at")
    op.drop_column("meetings", "reason")
    op.drop_column("meetings", "status")

    # Drop enum type
    sa.Enum(name="meetingstatus").drop(op.get_bind(), checkfirst=True)
