"""add_user_passkey_and_onboarding_fields

Revision ID: 7aed142a5a3a
Revises: 20260411_0032
Create Date: 2026-04-12 14:57:01.802680

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '7aed142a5a3a'
down_revision: Union[str, None] = '20260411_0032'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user_passkeys',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('credential_id', sa.String(length=512), nullable=False),
    sa.Column('public_key', sa.LargeBinary(), nullable=False),
    sa.Column('sign_count', sa.Integer(), nullable=False),
    sa.Column('transports', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('name', sa.String(length=100), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_passkeys_credential_id'), 'user_passkeys', ['credential_id'], unique=True)
    op.create_index(op.f('ix_user_passkeys_user_id'), 'user_passkeys', ['user_id'], unique=False)
    op.add_column('users', sa.Column('passkey_onboarding_dismissed', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('last_onboarding_prompt_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'last_onboarding_prompt_at')
    op.drop_column('users', 'passkey_onboarding_dismissed')
    op.drop_index(op.f('ix_user_passkeys_user_id'), table_name='user_passkeys')
    op.drop_index(op.f('ix_user_passkeys_credential_id'), table_name='user_passkeys')
    op.drop_table('user_passkeys')
