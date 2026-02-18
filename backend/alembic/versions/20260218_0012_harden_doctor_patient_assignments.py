"""harden_doctor_patient_assignments

Revision ID: 20260218_0012
Revises: 20260218_0011
Create Date: 2026-02-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260218_0012"
down_revision: Union[str, None] = "20260218_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Normalize role values before enforcing constraints.
    op.execute(
        """
        UPDATE doctor_patient_assignments
        SET role = CASE
            WHEN role = 'primary' THEN 'primary'
            WHEN role = 'consulting' THEN 'consulting'
            ELSE 'consulting'
        END
        """
    )

    # 2) Deduplicate (doctor_id, patient_id), keep earliest assignment.
    op.execute(
        """
        DELETE FROM doctor_patient_assignments d
        USING (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY doctor_id, patient_id
                        ORDER BY assigned_at ASC, id ASC
                    ) AS rn
                FROM doctor_patient_assignments
            ) ranked
            WHERE ranked.rn > 1
        ) dup
        WHERE d.id = dup.id
        """
    )

    # 3) Ensure max one primary per patient (keep earliest primary).
    op.execute(
        """
        WITH ranked_primary AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY patient_id
                    ORDER BY assigned_at ASC, id ASC
                ) AS rn
            FROM doctor_patient_assignments
            WHERE role = 'primary'
        )
        UPDATE doctor_patient_assignments d
        SET role = 'consulting'
        FROM ranked_primary rp
        WHERE d.id = rp.id
          AND rp.rn > 1
        """
    )

    # 4) If a patient has assignments but no primary, promote earliest to primary.
    op.execute(
        """
        WITH first_assignment AS (
            SELECT DISTINCT ON (patient_id)
                id,
                patient_id
            FROM doctor_patient_assignments
            ORDER BY patient_id, assigned_at ASC, id ASC
        )
        UPDATE doctor_patient_assignments d
        SET role = 'primary'
        FROM first_assignment fa
        WHERE d.id = fa.id
          AND NOT EXISTS (
            SELECT 1
            FROM doctor_patient_assignments x
            WHERE x.patient_id = fa.patient_id
              AND x.role = 'primary'
          )
        """
    )

    # 5) Enforce constraints.
    op.alter_column("doctor_patient_assignments", "role", nullable=False)
    op.create_check_constraint(
        "ck_dpa_role_allowed",
        "doctor_patient_assignments",
        "role IN ('primary', 'consulting')",
    )
    op.create_unique_constraint(
        "uq_dpa_doctor_patient_pair",
        "doctor_patient_assignments",
        ["doctor_id", "patient_id"],
    )
    op.create_index(
        "uq_dpa_primary_per_patient",
        "doctor_patient_assignments",
        ["patient_id"],
        unique=True,
        postgresql_where=sa.text("role = 'primary'"),
    )


def downgrade() -> None:
    op.drop_index("uq_dpa_primary_per_patient", table_name="doctor_patient_assignments")
    op.drop_constraint("uq_dpa_doctor_patient_pair", "doctor_patient_assignments", type_="unique")
    op.drop_constraint("ck_dpa_role_allowed", "doctor_patient_assignments", type_="check")
    op.alter_column("doctor_patient_assignments", "role", nullable=True)
