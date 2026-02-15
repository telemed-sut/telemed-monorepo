"""Hospital Dense Mode - add clinical tables and columns

Revision ID: 20260214_0004
Revises: 20260213_0003
Create Date: 2026-02-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260214_0004"
down_revision = "20260213_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Add new values to user_role ENUM ──────────────────
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'doctor'")
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'nurse'")

    # ── 2. Create new ENUM types ──────────────────
    encounter_type = postgresql.ENUM("inpatient", "outpatient", "emergency", name="encounter_type", create_type=False)
    encounter_type.create(op.get_bind(), checkfirst=True)

    encounter_status = postgresql.ENUM("active", "discharged", "transferred", name="encounter_status", create_type=False)
    encounter_status.create(op.get_bind(), checkfirst=True)

    order_status = postgresql.ENUM("pending", "active", "completed", "cancelled", name="order_status", create_type=False)
    order_status.create(op.get_bind(), checkfirst=True)

    alert_severity = postgresql.ENUM("critical", "warning", "info", name="alert_severity", create_type=False)
    alert_severity.create(op.get_bind(), checkfirst=True)

    alert_category = postgresql.ENUM("lab_result", "vital_sign", "medication", "allergy", "system", name="alert_category", create_type=False)
    alert_category.create(op.get_bind(), checkfirst=True)

    timeline_event_type = postgresql.ENUM(
        "note", "vitals", "lab_result", "imaging", "medication",
        "procedure", "encounter", "order", "alert",
        name="timeline_event_type", create_type=False,
    )
    timeline_event_type.create(op.get_bind(), checkfirst=True)

    # ── 3. Add columns to patients ──────────────────
    op.add_column("patients", sa.Column("allergies", sa.Text(), nullable=True))
    op.add_column("patients", sa.Column("blood_group", sa.String(length=10), nullable=True))
    op.add_column("patients", sa.Column("risk_score", sa.Integer(), nullable=True, server_default="0"))
    op.add_column("patients", sa.Column("primary_diagnosis", sa.String(length=500), nullable=True))
    op.add_column("patients", sa.Column("ward", sa.String(length=100), nullable=True))
    op.add_column("patients", sa.Column("bed_number", sa.String(length=20), nullable=True))

    # ── 4. Add columns to users ──────────────────
    op.add_column("users", sa.Column("specialty", sa.String(length=200), nullable=True))
    op.add_column("users", sa.Column("department", sa.String(length=200), nullable=True))

    # ── 5. Create new tables ──────────────────

    # doctor_patient_assignments
    op.create_table(
        "doctor_patient_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("doctor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=True, server_default="primary"),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["doctor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_dpa_doctor_id", "doctor_patient_assignments", ["doctor_id"])
    op.create_index("ix_dpa_patient_id", "doctor_patient_assignments", ["patient_id"])

    # encounters
    op.create_table(
        "encounters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("encounter_type", postgresql.ENUM("inpatient", "outpatient", "emergency", name="encounter_type", create_type=False), nullable=False),
        sa.Column("status", postgresql.ENUM("active", "discharged", "transferred", name="encounter_status", create_type=False), nullable=False, server_default="active"),
        sa.Column("admitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("discharged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ward", sa.String(length=100), nullable=True),
        sa.Column("bed_number", sa.String(length=20), nullable=True),
        sa.Column("attending_doctor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("chief_complaint", sa.Text(), nullable=True),
        sa.Column("discharge_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attending_doctor_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_encounters_patient_id", "encounters", ["patient_id"])

    # medical_history
    op.create_table(
        "medical_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("condition", sa.String(length=500), nullable=False),
        sa.Column("diagnosed_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_medical_history_patient_id", "medical_history", ["patient_id"])

    # current_conditions
    op.create_table(
        "current_conditions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("condition", sa.String(length=500), nullable=False),
        sa.Column("severity", sa.String(length=50), nullable=True),
        sa.Column("onset_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recorded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_current_conditions_patient_id", "current_conditions", ["patient_id"])

    # treatments
    op.create_table(
        "treatments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("ordered_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ordered_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_treatments_patient_id", "treatments", ["patient_id"])

    # medications
    op.create_table(
        "medications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("dosage", sa.String(length=200), nullable=True),
        sa.Column("frequency", sa.String(length=200), nullable=True),
        sa.Column("route", sa.String(length=100), nullable=True),
        sa.Column("status", postgresql.ENUM("pending", "active", "completed", "cancelled", name="order_status", create_type=False), nullable=False, server_default="active"),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ordered_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ordered_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_medications_patient_id", "medications", ["patient_id"])

    # labs
    op.create_table(
        "labs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("test_name", sa.String(length=300), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("status", postgresql.ENUM("pending", "active", "completed", "cancelled", name="order_status", create_type=False), nullable=False, server_default="pending"),
        sa.Column("ordered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resulted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_value", sa.String(length=200), nullable=True),
        sa.Column("result_unit", sa.String(length=50), nullable=True),
        sa.Column("reference_range", sa.String(length=100), nullable=True),
        sa.Column("is_abnormal", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("ordered_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ordered_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_labs_patient_id", "labs", ["patient_id"])

    # timeline_events
    op.create_table(
        "timeline_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", postgresql.ENUM(
            "note", "vitals", "lab_result", "imaging", "medication",
            "procedure", "encounter", "order", "alert",
            name="timeline_event_type", create_type=False,
        ), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("is_abnormal", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reference_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reference_type", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_timeline_events_patient_id", "timeline_events", ["patient_id"])
    op.create_index("ix_timeline_events_event_time", "timeline_events", ["event_time"])

    # alerts
    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("severity", postgresql.ENUM("critical", "warning", "info", name="alert_severity", create_type=False), nullable=False),
        sa.Column("category", postgresql.ENUM("lab_result", "vital_sign", "medication", "allergy", "system", name="alert_category", create_type=False), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("is_acknowledged", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("acknowledged_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["acknowledged_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_alerts_patient_id", "alerts", ["patient_id"])

    # audit_logs
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=100), nullable=True),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("is_break_glass", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("break_glass_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_resource_id", "audit_logs", ["resource_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table("audit_logs")
    op.drop_table("alerts")
    op.drop_table("timeline_events")
    op.drop_table("labs")
    op.drop_table("medications")
    op.drop_table("treatments")
    op.drop_table("current_conditions")
    op.drop_table("medical_history")
    op.drop_table("encounters")
    op.drop_table("doctor_patient_assignments")

    # Remove columns from patients
    op.drop_column("patients", "bed_number")
    op.drop_column("patients", "ward")
    op.drop_column("patients", "primary_diagnosis")
    op.drop_column("patients", "risk_score")
    op.drop_column("patients", "blood_group")
    op.drop_column("patients", "allergies")

    # Remove columns from users
    op.drop_column("users", "department")
    op.drop_column("users", "specialty")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS timeline_event_type")
    op.execute("DROP TYPE IF EXISTS alert_category")
    op.execute("DROP TYPE IF EXISTS alert_severity")
    op.execute("DROP TYPE IF EXISTS order_status")
    op.execute("DROP TYPE IF EXISTS encounter_status")
    op.execute("DROP TYPE IF EXISTS encounter_type")

    # Note: Cannot remove values from user_role ENUM in PostgreSQL without recreating it
