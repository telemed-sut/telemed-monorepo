"""Add missing indexes for login attempts and meetings

Revision ID: 20260226_0018
Revises: 20260223_0017
Create Date: 2026-02-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260226_0018"
down_revision: Union[str, None] = "20260223_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "login_attempts" in tables:
        login_attempt_indexes = _index_names(inspector, "login_attempts")
        if "ix_login_attempts_email" not in login_attempt_indexes:
            op.create_index("ix_login_attempts_email", "login_attempts", ["email"], unique=False)

    if "meetings" in tables:
        meetings_indexes = _index_names(inspector, "meetings")
        if "ix_meetings_date_time" not in meetings_indexes:
            op.create_index("ix_meetings_date_time", "meetings", ["date_time"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "login_attempts" in tables:
        login_attempt_indexes = _index_names(inspector, "login_attempts")
        if "ix_login_attempts_email" in login_attempt_indexes:
            op.drop_index("ix_login_attempts_email", table_name="login_attempts")

    if "meetings" in tables:
        meetings_indexes = _index_names(inspector, "meetings")
        if "ix_meetings_date_time" in meetings_indexes:
            op.drop_index("ix_meetings_date_time", table_name="meetings")
