"""Reset every patient PIN to plaintext '1234'.

Companion to the security.py change that drops bcrypt+pepper for patient PINs:
this one-time data migration overrides every existing pin_hash with the
plaintext value '1234' so all current patients can log in with phone + 1234.

Also clears any active lockout / failed-attempt state and stamps
app_registered_at so /patient-app/login works without a separate /register
call.

Revision ID: 20260505_0041
Revises: 20260505_0040
Create Date: 2026-05-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260505_0041"
down_revision: Union[str, None] = "20260505_0040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEFAULT_PIN = "1234"


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE patients
            SET pin_hash = :pin,
                app_registered_at = COALESCE(app_registered_at, now()),
                failed_app_login_attempts = 0,
                app_account_locked_until = NULL,
                last_app_failed_login_at = NULL
            WHERE deleted_at IS NULL
            """
        ).bindparams(pin=_DEFAULT_PIN)
    )


def downgrade() -> None:
    # No-op: original bcrypt hashes were not preserved; downgrading would leave
    # patients without a working PIN. Operators can re-issue PINs manually.
    pass
