from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import models so Alembic can discover them
from app.models import (  # noqa: F401,E402
    invite, meeting, patient, user,
    doctor_patient_assignment, encounter, medical_history,
    current_condition, treatment, medication, lab,
    timeline_event, alert, audit_log,
    ip_ban, login_attempt, pressure_record, device_error_log,
)
