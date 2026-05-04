"""Add weight record and vital threshold models

Revision ID: 6e6a549cfb10
Revises: 88a6342a6f1c
Create Date: 2026-05-01 14:19:00.134974

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e6a549cfb10'
down_revision: Union[str, None] = '88a6342a6f1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('patient_vital_thresholds',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('min_heart_rate', sa.Integer(), nullable=True),
    sa.Column('max_heart_rate', sa.Integer(), nullable=True),
    sa.Column('min_sys_pressure', sa.Integer(), nullable=True),
    sa.Column('max_sys_pressure', sa.Integer(), nullable=True),
    sa.Column('min_dia_pressure', sa.Integer(), nullable=True),
    sa.Column('max_dia_pressure', sa.Integer(), nullable=True),
    sa.Column('min_weight_kg', sa.Float(), nullable=True),
    sa.Column('max_weight_kg', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_by', sa.UUID(), nullable=True),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_patient_vital_thresholds_patient_id'), 'patient_vital_thresholds', ['patient_id'], unique=True)
    op.create_table('weight_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('weight_kg', sa.Float(), nullable=False),
    sa.Column('measured_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('recorded_by', sa.UUID(), nullable=True),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recorded_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_weight_records_measured_at', 'weight_records', ['measured_at'], unique=False)
    op.create_index('ix_weight_records_patient_id', 'weight_records', ['patient_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_weight_records_patient_id', table_name='weight_records')
    op.drop_index('ix_weight_records_measured_at', table_name='weight_records')
    op.drop_table('weight_records')
    op.drop_index(op.f('ix_patient_vital_thresholds_patient_id'), table_name='patient_vital_thresholds')
    op.drop_table('patient_vital_thresholds')
