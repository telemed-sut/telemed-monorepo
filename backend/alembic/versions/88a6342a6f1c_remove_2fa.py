"""remove 2fa

Revision ID: 88a6342a6f1c
Revises: 20260424_0038
Create Date: 2026-04-28 15:28:52.326146

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '88a6342a6f1c'
down_revision: Union[str, None] = '20260424_0038'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop 2FA related tables
    op.drop_table('user_backup_codes')
    op.drop_table('user_trusted_devices')
    
    # Drop 2FA related columns from users table
    op.drop_column('users', 'two_factor_enabled_at')
    op.drop_column('users', 'two_factor_secret')
    op.drop_column('users', 'two_factor_enabled')


def downgrade() -> None:
    # Add 2FA related columns back to users table
    op.add_column('users', sa.Column('two_factor_enabled', sa.BOOLEAN(), server_default=sa.text('false'), autoincrement=False, nullable=False))
    op.add_column('users', sa.Column('two_factor_secret', sa.TEXT(), autoincrement=False, nullable=True))
    op.add_column('users', sa.Column('two_factor_enabled_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
    
    # Recreate user_trusted_devices table
    op.create_table('user_trusted_devices',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('user_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('token_hash', sa.VARCHAR(length=128), autoincrement=False, nullable=False),
        sa.Column('user_agent_hash', sa.VARCHAR(length=128), autoincrement=False, nullable=True),
        sa.Column('ip_address', sa.VARCHAR(length=45), autoincrement=False, nullable=True),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('last_used_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('expires_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=False),
        sa.Column('revoked_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='user_trusted_devices_user_id_fkey', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='user_trusted_devices_pkey')
    )
    op.create_index('ix_user_trusted_devices_user_id', 'user_trusted_devices', ['user_id'], unique=False)
    op.create_index('ix_user_trusted_devices_token_hash', 'user_trusted_devices', ['token_hash'], unique=True)
    op.create_index('ix_user_trusted_devices_revoked_at', 'user_trusted_devices', ['revoked_at'], unique=False)
    op.create_index('ix_user_trusted_devices_expires_at', 'user_trusted_devices', ['expires_at'], unique=False)

    # Recreate user_backup_codes table
    op.create_table('user_backup_codes',
        sa.Column('id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('user_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('code_hash', sa.VARCHAR(length=128), autoincrement=False, nullable=False),
        sa.Column('batch_id', sa.UUID(), autoincrement=False, nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), autoincrement=False, nullable=False),
        sa.Column('used_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.Column('expires_at', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='user_backup_codes_user_id_fkey', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='user_backup_codes_pkey')
    )
    op.create_index('ix_user_backup_codes_user_id', 'user_backup_codes', ['user_id'], unique=False)
    op.create_index('ix_user_backup_codes_used_at', 'user_backup_codes', ['used_at'], unique=False)
    op.create_index('ix_user_backup_codes_expires_at', 'user_backup_codes', ['expires_at'], unique=False)
    op.create_index('ix_user_backup_codes_code_hash', 'user_backup_codes', ['code_hash'], unique=False)
    op.create_index('ix_user_backup_codes_batch_id', 'user_backup_codes', ['batch_id'], unique=False)
