"""Add medical_student role and backfill deprecated care-team roles

Revision ID: 20260325_0023
Revises: 20260306_0022
Create Date: 2026-03-25
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260325_0023"
down_revision: Union[str, None] = "20260306_0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'medical_student'")

    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'medical_student'")

    op.execute(
        """
        UPDATE users
        SET role = 'medical_student'
        WHERE role IN ('staff', 'nurse', 'pharmacist', 'medical_technologist', 'psychologist')
        """
    )

    op.execute(
        """
        UPDATE user_invites
        SET role = 'medical_student'
        WHERE role IN ('staff', 'nurse', 'pharmacist', 'medical_technologist', 'psychologist')
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'staff'")
    # NOTE: PostgreSQL enums cannot safely drop values in-place.
    # We intentionally leave 'medical_student' in the enum during downgrade.
