"""harden patient app auth state

Revision ID: 20260411_0031
Revises: 20260410_0030
Create Date: 2026-04-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260411_0031"
down_revision: Union[str, None] = "20260410_0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "patients",
        sa.Column("failed_app_login_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "patients",
        sa.Column("app_account_locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "patients",
        sa.Column("last_app_failed_login_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("patients", "last_app_failed_login_at")
    op.drop_column("patients", "app_account_locked_until")
    op.drop_column("patients", "failed_app_login_attempts")
