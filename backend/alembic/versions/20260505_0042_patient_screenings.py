"""Add patient_screenings table for daily HF screening.

Revision ID: 20260505_0042
Revises: 20260505_0041
Create Date: 2026-05-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260505_0042"
down_revision: Union[str, None] = "20260505_0041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "patient_screenings" not in tables:
        op.create_table(
            "patient_screenings",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "symptom_more_tired",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "symptom_cannot_lie_flat",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "symptom_paroxysmal_nocturnal_dyspnea",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "symptom_more_than_one_pillow",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("systolic_bp", sa.Integer(), nullable=True),
            sa.Column("diastolic_bp", sa.Integer(), nullable=True),
            sa.Column("heart_rate", sa.Integer(), nullable=True),
            sa.Column("oxygen_saturation", sa.Integer(), nullable=True),
            sa.Column("weight_kg", sa.Float(), nullable=True),
            sa.Column(
                "warning_dyspnea_orthopnea",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column(
                "warning_abnormal_vitals",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "recorded_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    if "patient_screenings" in set(inspector.get_table_names()):
        existing = _index_names(inspector, "patient_screenings")
        if "ix_patient_screenings_patient_id" not in existing:
            op.create_index(
                "ix_patient_screenings_patient_id",
                "patient_screenings",
                ["patient_id"],
            )
        if "ix_patient_screenings_recorded_at" not in existing:
            op.create_index(
                "ix_patient_screenings_recorded_at",
                "patient_screenings",
                ["recorded_at"],
            )
        if "ix_patient_screenings_patient_recorded" not in existing:
            op.create_index(
                "ix_patient_screenings_patient_recorded",
                "patient_screenings",
                ["patient_id", "recorded_at"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "patient_screenings" in tables:
        existing = _index_names(inspector, "patient_screenings")
        for name in (
            "ix_patient_screenings_patient_recorded",
            "ix_patient_screenings_recorded_at",
            "ix_patient_screenings_patient_id",
        ):
            if name in existing:
                op.drop_index(name, table_name="patient_screenings")
        op.drop_table("patient_screenings")
