"""Add height to weight records

Revision ID: 7bd3c4a9e12f
Revises: 6e6a549cfb10
Create Date: 2026-05-01 23:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7bd3c4a9e12f"
down_revision: Union[str, None] = "6e6a549cfb10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("weight_records", sa.Column("height_cm", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("weight_records", "height_cm")
