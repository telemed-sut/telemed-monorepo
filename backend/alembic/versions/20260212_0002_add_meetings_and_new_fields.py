"""Add meetings table, update users and patients with new fields

Revision ID: 20260212_0002
Revises: 20260108_0001
Create Date: 2026-02-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260212_0002"
down_revision = "20260108_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Users: Add first_name, last_name ---
    op.add_column("users", sa.Column("first_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(length=100), nullable=True))

    # --- Patients: Add name, people_id, age, status, doctor ---
    op.add_column("patients", sa.Column("name", sa.String(length=200), nullable=True))
    op.add_column("patients", sa.Column("people_id", sa.String(length=20), nullable=True))
    op.add_column("patients", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("patients", sa.Column("status", sa.String(length=50), nullable=True, server_default="active"))
    op.add_column("patients", sa.Column("doctor", sa.String(length=200), nullable=True))
    op.create_index(op.f("ix_patients_people_id"), "patients", ["people_id"], unique=True)

    # --- Meetings: Create table ---
    op.create_table(
        "meetings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("date_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("doctor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("room", sa.String(length=100), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["doctor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["patients.id"], ondelete="SET NULL"),
    )
    op.create_index(op.f("ix_meetings_doctor_id"), "meetings", ["doctor_id"], unique=False)
    op.create_index(op.f("ix_meetings_user_id"), "meetings", ["user_id"], unique=False)


def downgrade() -> None:
    # --- Meetings: Drop table ---
    op.drop_index(op.f("ix_meetings_user_id"), table_name="meetings")
    op.drop_index(op.f("ix_meetings_doctor_id"), table_name="meetings")
    op.drop_table("meetings")

    # --- Patients: Remove new columns ---
    op.drop_index(op.f("ix_patients_people_id"), table_name="patients")
    op.drop_column("patients", "doctor")
    op.drop_column("patients", "status")
    op.drop_column("patients", "age")
    op.drop_column("patients", "people_id")
    op.drop_column("patients", "name")

    # --- Users: Remove new columns ---
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
