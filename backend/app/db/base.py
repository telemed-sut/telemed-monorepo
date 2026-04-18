from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import models so Alembic can discover them
from app.models import (  # noqa: F401,E402
    invite, meeting, patient, user,
    doctor_patient_assignment, encounter, medical_history,
    current_condition, treatment, medication, lab,
    timeline_event, alert, audit_log,
    ip_ban, login_attempt, pressure_record, device_error_log, device_request_nonce,
    user_trusted_device, user_backup_code, device_registration,
    user_passkey,
    meeting_patient_invite_code,
    patient_app_registration,
    patient_app_session,
    meeting_room_presence,
    heart_sound_record,
    user_privileged_role_assignment,
    user_session,
)
