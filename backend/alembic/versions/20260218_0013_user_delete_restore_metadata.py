"""user_delete_restore_metadata

Revision ID: 20260218_0013
Revises: 20260218_0012
Create Date: 2026-02-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "20260218_0013"
down_revision: Union[str, None] = "20260218_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("users", sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("restored_by", postgresql.UUID(as_uuid=True), nullable=True))

    op.create_foreign_key(
        "fk_users_deleted_by_users",
        "users",
        "users",
        ["deleted_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_users_restored_by_users",
        "users",
        "users",
        ["restored_by"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_index("ix_users_deleted_by", "users", ["deleted_by"], unique=False)
    op.create_index("ix_users_restored_at", "users", ["restored_at"], unique=False)
    op.create_index("ix_users_restored_by", "users", ["restored_by"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_restored_by", table_name="users")
    op.drop_index("ix_users_restored_at", table_name="users")
    op.drop_index("ix_users_deleted_by", table_name="users")

    op.drop_constraint("fk_users_restored_by_users", "users", type_="foreignkey")
    op.drop_constraint("fk_users_deleted_by_users", "users", type_="foreignkey")

    op.drop_column("users", "restored_by")
    op.drop_column("users", "restored_at")
    op.drop_column("users", "deleted_by")
