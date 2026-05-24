"""create_session_cache_unlogged

Revision ID: e2dcfc904683
Revises: 20260505_0042
Create Date: 2026-05-18 05:02:32.537723

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2dcfc904683'
down_revision: Union[str, None] = '20260505_0042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create unlogged table for fast session caching (shared across all instances)
    op.execute("""
        CREATE UNLOGGED TABLE IF NOT EXISTS session_cache (
            session_id TEXT PRIMARY KEY,
            user_id UUID NOT NULL,
            auth_source TEXT NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    """)
    # Index for fast cleanup of expired entries
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_session_cache_expires
        ON session_cache(expires_at)
    """)
    # Cleanup old entries periodically (entries older than 2 minutes are stale)
    op.execute("""
        DELETE FROM session_cache WHERE cached_at < NOW() - INTERVAL '2 minutes'
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS session_cache")
