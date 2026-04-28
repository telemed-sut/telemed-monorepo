"""merge lung device and passkey heads

Revision ID: 20260422_0036
Revises: 20260422_0035, 7aed142a5a3a
Create Date: 2026-04-22
"""

from typing import Sequence, Union


revision: str = "20260422_0036"
down_revision: Union[str, Sequence[str], None] = ("20260422_0035", "7aed142a5a3a")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Merge migration only. Schema changes live in the two parent revisions.
    pass


def downgrade() -> None:
    # Split heads again on downgrade.
    pass
