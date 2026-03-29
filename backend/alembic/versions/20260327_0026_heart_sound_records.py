"""heart_sound_records

Revision ID: 20260327_0026
Revises: 20260326_0025
Create Date: 2026-03-27 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260327_0026"
down_revision: Union[str, None] = "20260326_0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "heart_sound_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("mac_address", sa.String(length=64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("blob_url", sa.String(length=2048), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=True),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_heart_sound_records_patient_id", "heart_sound_records", ["patient_id"], unique=False)
    op.create_index("ix_heart_sound_records_device_id", "heart_sound_records", ["device_id"], unique=False)
    op.create_index("ix_heart_sound_records_mac_address", "heart_sound_records", ["mac_address"], unique=False)
    op.create_index("ix_heart_sound_records_position", "heart_sound_records", ["position"], unique=False)
    op.create_index("ix_heart_sound_records_recorded_at", "heart_sound_records", ["recorded_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_heart_sound_records_recorded_at", table_name="heart_sound_records")
    op.drop_index("ix_heart_sound_records_position", table_name="heart_sound_records")
    op.drop_index("ix_heart_sound_records_mac_address", table_name="heart_sound_records")
    op.drop_index("ix_heart_sound_records_device_id", table_name="heart_sound_records")
    op.drop_index("ix_heart_sound_records_patient_id", table_name="heart_sound_records")
    op.drop_table("heart_sound_records")
