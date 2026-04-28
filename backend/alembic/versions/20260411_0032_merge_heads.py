"""merge heads after auth hardening and query indexes

Revision ID: 20260411_0032
Revises: 20260411_0031, 28eb7c50e1f3
Create Date: 2026-04-11
"""

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "20260411_0032"
down_revision: Union[str, Sequence[str], None] = ("20260411_0031", "28eb7c50e1f3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Merge migration: no schema change.
    pass


def downgrade() -> None:
    # Split heads again on downgrade.
    pass
