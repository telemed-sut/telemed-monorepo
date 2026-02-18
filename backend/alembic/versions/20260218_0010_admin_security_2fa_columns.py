"""add_admin_2fa_columns_to_users

Revision ID: 20260218_0010
Revises: a1b2c3d4e5f6
Create Date: 2026-02-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260218_0010"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("two_factor_secret", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("two_factor_enabled_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "two_factor_enabled_at")
    op.drop_column("users", "two_factor_secret")
    op.drop_column("users", "two_factor_enabled")
