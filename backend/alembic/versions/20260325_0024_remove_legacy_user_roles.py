"""Remove legacy care-team role values from user_role enum

Revision ID: 20260325_0024
Revises: 20260325_0023
Create Date: 2026-03-25
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260325_0024"
down_revision: Union[str, None] = "20260325_0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ACTIVE_ROLES = ("admin", "doctor", "medical_student")
LEGACY_ROLES = (
    "staff",
    "nurse",
    "pharmacist",
    "medical_technologist",
    "psychologist",
)


def upgrade() -> None:
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

    op.execute("ALTER TABLE users ALTER COLUMN role DROP DEFAULT")
    op.execute("ALTER TABLE user_invites ALTER COLUMN role DROP DEFAULT")

    op.execute(
        "CREATE TYPE user_role_new AS ENUM ('admin', 'doctor', 'medical_student')"
    )
    op.execute(
        """
        ALTER TABLE users
        ALTER COLUMN role TYPE user_role_new
        USING role::text::user_role_new
        """
    )
    op.execute(
        """
        ALTER TABLE user_invites
        ALTER COLUMN role TYPE user_role_new
        USING role::text::user_role_new
        """
    )
    op.execute("DROP TYPE user_role")
    op.execute("ALTER TYPE user_role_new RENAME TO user_role")

    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'medical_student'")
    op.execute("ALTER TABLE user_invites ALTER COLUMN role SET DEFAULT 'medical_student'")


def downgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN role DROP DEFAULT")
    op.execute("ALTER TABLE user_invites ALTER COLUMN role DROP DEFAULT")

    op.execute(
        """
        UPDATE users
        SET role = 'staff'
        WHERE role = 'medical_student'
        """
    )
    op.execute(
        """
        UPDATE user_invites
        SET role = 'staff'
        WHERE role = 'medical_student'
        """
    )

    op.execute(
        """
        CREATE TYPE user_role_old AS ENUM (
            'admin',
            'staff',
            'doctor',
            'nurse',
            'pharmacist',
            'medical_technologist',
            'psychologist'
        )
        """
    )
    op.execute(
        """
        ALTER TABLE users
        ALTER COLUMN role TYPE user_role_old
        USING role::text::user_role_old
        """
    )
    op.execute(
        """
        ALTER TABLE user_invites
        ALTER COLUMN role TYPE user_role_old
        USING role::text::user_role_old
        """
    )
    op.execute("DROP TYPE user_role")
    op.execute("ALTER TYPE user_role_old RENAME TO user_role")

    op.execute("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'staff'")
    op.execute("ALTER TABLE user_invites ALTER COLUMN role SET DEFAULT 'staff'")
