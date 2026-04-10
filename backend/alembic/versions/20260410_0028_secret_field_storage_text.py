"""expand secret storage columns for encrypted-at-rest values

Revision ID: 20260410_0028
Revises: 20260330_0027
Create Date: 2026-04-10 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260410_0028"
down_revision: Union[str, None] = "20260330_0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("device_registrations") as batch_op:
        batch_op.alter_column(
            "device_secret",
            existing_type=sa.String(length=255),
            type_=sa.Text(),
            existing_nullable=False,
        )

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "two_factor_secret",
            existing_type=sa.String(length=128),
            type_=sa.Text(),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "two_factor_secret",
            existing_type=sa.Text(),
            type_=sa.String(length=128),
            existing_nullable=True,
        )

    with op.batch_alter_table("device_registrations") as batch_op:
        batch_op.alter_column(
            "device_secret",
            existing_type=sa.Text(),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
