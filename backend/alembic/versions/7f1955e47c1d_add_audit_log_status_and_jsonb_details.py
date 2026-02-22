"""add_audit_log_status_and_jsonb_details

Revision ID: 7f1955e47c1d
Revises: 20260219_0014
Create Date: 2026-02-22 18:05:31.321252

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7f1955e47c1d'
down_revision: Union[str, None] = '20260219_0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add 'status' column
    op.add_column(
        'audit_logs',
        sa.Column('status', sa.String(length=20), nullable=True, server_default=sa.text("'success'"))
    )
    op.create_index(op.f('ix_audit_logs_status'), 'audit_logs', ['status'], unique=False)

    # 2. Convert 'details' from Text to JSONB safely using PL/pgSQL block
    # This prevents failures on texts that start with '{' but are invalid JSON.
    op.execute(
        '''
        CREATE OR REPLACE FUNCTION try_cast_jsonb(p_in text) RETURNS jsonb AS $$
        BEGIN
          IF p_in IS NULL THEN
             RETURN NULL;
          END IF;
          IF p_in = '' THEN
             RETURN '""'::jsonb;
          END IF;
          RETURN p_in::jsonb;
        EXCEPTION WHEN others THEN
          RETURN to_jsonb(p_in);
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
        '''
    )
    op.execute(
        '''
        ALTER TABLE audit_logs 
        ALTER COLUMN details TYPE JSONB USING try_cast_jsonb(details::TEXT);
        '''
    )
    op.execute(
        '''
        DROP FUNCTION try_cast_jsonb(text);
        '''
    )

    # Add GIN index for performance
    op.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_audit_logs_details_gin 
        ON audit_logs USING GIN (details)
        '''
    )

    # 3. Backfill the new 'status' column based on the existing logic
    op.execute(
        '''
        UPDATE audit_logs 
        SET status = 
        CASE 
            WHEN action ILIKE '%denied%' OR action ILIKE '%forbidden%' OR action ILIKE '%failed%' THEN 'failure'
            WHEN details IS NOT NULL AND jsonb_typeof(details) = 'object' AND details->>'success' = 'false' THEN 'failure'
            WHEN details IS NOT NULL AND jsonb_typeof(details) = 'object' AND details->>'error' IS NOT NULL THEN 'failure'
            ELSE 'success'
        END
        '''
    )

    # 4. Enforce strict DB contract after backfill
    op.alter_column(
        'audit_logs',
        'status',
        existing_type=sa.String(length=20),
        nullable=False,
        server_default=sa.text("'success'"),
    )


def downgrade() -> None:
    # 1. Revert 'details' back to Text and drop GIN index
    op.execute(
        '''
        DROP INDEX IF EXISTS idx_audit_logs_details_gin;
        '''
    )
    op.execute(
        '''
        ALTER TABLE audit_logs 
        ALTER COLUMN details TYPE TEXT USING details::TEXT
        '''
    )

    # 2. Drop the 'status' column and its index
    op.drop_index(op.f('ix_audit_logs_status'), table_name='audit_logs')
    op.drop_column('audit_logs', 'status')
