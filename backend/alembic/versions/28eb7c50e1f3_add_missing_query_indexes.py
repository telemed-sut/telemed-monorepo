"""add_missing_query_indexes

Revision ID: 28eb7c50e1f3
Revises: 20260330_0027
Create Date: 2026-04-08 16:20:56.937817

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '28eb7c50e1f3'
down_revision: Union[str, None] = '20260330_0027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "encounters" in tables:
        encounter_indexes = _index_names(inspector, "encounters")
        if "ix_encounters_status" not in encounter_indexes:
            op.create_index("ix_encounters_status", "encounters", ["status"], unique=False)

    if "alerts" in tables:
        alert_indexes = _index_names(inspector, "alerts")
        if "ix_alerts_patient_id_is_acknowledged" not in alert_indexes:
            op.create_index(
                "ix_alerts_patient_id_is_acknowledged",
                "alerts",
                ["patient_id", "is_acknowledged"],
                unique=False,
            )

    if "login_attempts" in tables:
        login_attempt_indexes = _index_names(inspector, "login_attempts")
        if "ix_login_attempts_email_created_at" not in login_attempt_indexes:
            op.create_index(
                "ix_login_attempts_email_created_at",
                "login_attempts",
                ["email", "created_at"],
                unique=False,
            )

    if "heart_sound_records" in tables:
        heart_sound_indexes = _index_names(inspector, "heart_sound_records")
        if "ix_heart_sound_records_blob_url" not in heart_sound_indexes:
            op.create_index(
                "ix_heart_sound_records_blob_url",
                "heart_sound_records",
                ["blob_url"],
                unique=True,
            )

    if "user_privileged_role_assignments" in tables:
        privileged_role_indexes = _index_names(inspector, "user_privileged_role_assignments")
        if "ix_user_privileged_role_assignments_created_by" not in privileged_role_indexes:
            op.create_index(
                "ix_user_privileged_role_assignments_created_by",
                "user_privileged_role_assignments",
                ["created_by"],
                unique=False,
            )
        if "ix_user_privileged_role_assignments_revoked_by" not in privileged_role_indexes:
            op.create_index(
                "ix_user_privileged_role_assignments_revoked_by",
                "user_privileged_role_assignments",
                ["revoked_by"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "user_privileged_role_assignments" in tables:
        privileged_role_indexes = _index_names(inspector, "user_privileged_role_assignments")
        if "ix_user_privileged_role_assignments_revoked_by" in privileged_role_indexes:
            op.drop_index(
                "ix_user_privileged_role_assignments_revoked_by",
                table_name="user_privileged_role_assignments",
            )
        if "ix_user_privileged_role_assignments_created_by" in privileged_role_indexes:
            op.drop_index(
                "ix_user_privileged_role_assignments_created_by",
                table_name="user_privileged_role_assignments",
            )

    if "heart_sound_records" in tables:
        heart_sound_indexes = _index_names(inspector, "heart_sound_records")
        if "ix_heart_sound_records_blob_url" in heart_sound_indexes:
            op.drop_index("ix_heart_sound_records_blob_url", table_name="heart_sound_records")

    if "login_attempts" in tables:
        login_attempt_indexes = _index_names(inspector, "login_attempts")
        if "ix_login_attempts_email_created_at" in login_attempt_indexes:
            op.drop_index("ix_login_attempts_email_created_at", table_name="login_attempts")

    if "alerts" in tables:
        alert_indexes = _index_names(inspector, "alerts")
        if "ix_alerts_patient_id_is_acknowledged" in alert_indexes:
            op.drop_index("ix_alerts_patient_id_is_acknowledged", table_name="alerts")

    if "encounters" in tables:
        encounter_indexes = _index_names(inspector, "encounters")
        if "ix_encounters_status" in encounter_indexes:
            op.drop_index("ix_encounters_status", table_name="encounters")


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}
