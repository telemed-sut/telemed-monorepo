"""merge_heads

Revision ID: 20260223_0016
Revises: 20260223_0015, 7f1955e47c1d
Create Date: 2026-02-23
"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "20260223_0016"
down_revision: Union[str, Sequence[str], None] = ("20260223_0015", "7f1955e47c1d")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Merge migration: no schema change.
    pass


def downgrade() -> None:
    # Split heads again on downgrade.
    pass
