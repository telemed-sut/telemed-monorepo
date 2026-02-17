"""add_old_values_and_new_values_to_audit_logs

Revision ID: a1b2c3d4e5f6
Revises: 9ecb37e7bca8
Create Date: 2026-02-17 20:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '9ecb37e7bca8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('audit_logs')]

    if 'old_values' not in columns:
        op.add_column('audit_logs', sa.Column('old_values', JSONB, nullable=True))
    
    if 'new_values' not in columns:
        op.add_column('audit_logs', sa.Column('new_values', JSONB, nullable=True))


def downgrade() -> None:
    # We can try to drop, but if we want to be safe we can check too.
    # Usually downgrade is destructive so we just let it fail or force it.
    op.drop_column('audit_logs', 'new_values')
    op.drop_column('audit_logs', 'old_values')
