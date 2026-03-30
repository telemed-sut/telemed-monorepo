"""add privileged role assignments

Revision ID: 20260330_0027
Revises: 20260327_0026
Create Date: 2026-03-30 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260330_0027"
down_revision: Union[str, None] = "20260327_0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    privileged_role_enum = postgresql.ENUM(
        "platform_super_admin",
        "security_admin",
        "hospital_admin",
        name="privileged_role",
        create_type=False,
    )
    privileged_role_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "user_privileged_role_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", privileged_role_enum, nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.UUID(), nullable=True),
        sa.Column("revoked_reason", sa.String(length=300), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_privileged_role_assignments_user_id",
        "user_privileged_role_assignments",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_privileged_role_assignments_revoked_at",
        "user_privileged_role_assignments",
        ["revoked_at"],
        unique=False,
    )
    op.create_index(
        "uq_active_user_privileged_role_assignment",
        "user_privileged_role_assignments",
        ["user_id", "role"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_active_user_privileged_role_assignment", table_name="user_privileged_role_assignments")
    op.drop_index("ix_user_privileged_role_assignments_revoked_at", table_name="user_privileged_role_assignments")
    op.drop_index("ix_user_privileged_role_assignments_user_id", table_name="user_privileged_role_assignments")
    op.drop_table("user_privileged_role_assignments")

    privileged_role_enum = postgresql.ENUM(name="privileged_role", create_type=False)
    privileged_role_enum.drop(op.get_bind(), checkfirst=True)
