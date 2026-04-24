import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import scripts.seed_device_demo_flow as seed_device_demo_flow
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import DeviceExamSessionStatus, UserRole
from app.models.patient import Patient
from app.models.user import User
from scripts.seed_device_demo_flow import seed_demo_flow


def test_seed_device_demo_flow_is_idempotent(db: Session):
    secret = "seed-demo-secret-1234567890abcdefghi"

    first = seed_demo_flow(
        db,
        doctor_email="seed-demo-doctor@example.com",
        doctor_password="DeviceDemoPass123",
        patient_email="seed-demo-patient@example.com",
        device_id="seed-demo-lung-01",
        device_secret=secret,
        activate_now=True,
        preserve_existing_password=False,
    )
    second = seed_demo_flow(
        db,
        doctor_email="seed-demo-doctor@example.com",
        doctor_password="DeviceDemoPass123",
        patient_email="seed-demo-patient@example.com",
        device_id="seed-demo-lung-01",
        device_secret=secret,
        activate_now=True,
        preserve_existing_password=False,
    )

    assert second.doctor.id == first.doctor.id
    assert second.patient.id == first.patient.id
    assert second.device.id == first.device.id
    assert second.session.id == first.session.id
    assert second.session.status == DeviceExamSessionStatus.active
    assert second.device.device_secret == secret

    assert db.scalar(select(func.count(User.id)).where(User.email == "seed-demo-doctor@example.com")) == 1
    assert db.scalar(select(func.count(Patient.id)).where(Patient.email == "seed-demo-patient@example.com")) == 1
    assert db.scalar(select(func.count(DeviceRegistration.id)).where(DeviceRegistration.device_id == "seed-demo-lung-01")) == 1
    assert db.scalar(
        select(func.count(DoctorPatientAssignment.id)).where(
            DoctorPatientAssignment.doctor_id == first.doctor.id,
            DoctorPatientAssignment.patient_id == first.patient.id,
        )
    ) == 1
    assert db.scalar(
        select(func.count(DeviceExamSession.id)).where(
            DeviceExamSession.device_id == "seed-demo-lung-01",
            DeviceExamSession.status == DeviceExamSessionStatus.active,
        )
    ) == 1


def test_seed_device_demo_flow_does_not_reassign_open_device_session(db: Session):
    seed_demo_flow(
        db,
        doctor_email="seed-conflict-doctor@example.com",
        doctor_password="DeviceDemoPass123",
        patient_email="seed-conflict-patient-one@example.com",
        device_id="seed-conflict-lung-01",
        device_secret="seed-conflict-secret-1234567890abcdef",
        activate_now=True,
        preserve_existing_password=False,
    )

    with pytest.raises(RuntimeError, match="already has an open session for another patient"):
        seed_demo_flow(
            db,
            doctor_email="seed-conflict-doctor@example.com",
            doctor_password="DeviceDemoPass123",
            patient_email="seed-conflict-patient-two@example.com",
            device_id="seed-conflict-lung-01",
            device_secret="seed-conflict-secret-1234567890abcdef",
            activate_now=True,
            preserve_existing_password=False,
        )

    doctor = db.scalar(select(User).where(User.email == "seed-conflict-doctor@example.com"))
    assert doctor is not None
    assert doctor.role == UserRole.doctor


def test_seed_device_demo_flow_reports_missing_schema_before_writing(db: Session, monkeypatch):
    monkeypatch.setattr(seed_device_demo_flow, "REQUIRED_TABLES", ("missing_device_demo_table",))

    with pytest.raises(RuntimeError, match="venv/bin/alembic upgrade head"):
        seed_demo_flow(
            db,
            doctor_email="seed-missing-schema-doctor@example.com",
            doctor_password="DeviceDemoPass123",
            patient_email="seed-missing-schema-patient@example.com",
            device_id="seed-missing-schema-lung-01",
            device_secret="seed-missing-schema-secret-1234567890",
            activate_now=True,
            preserve_existing_password=False,
        )

    assert db.scalar(select(User).where(User.email == "seed-missing-schema-doctor@example.com")) is None
    assert db.scalar(select(Patient).where(Patient.email == "seed-missing-schema-patient@example.com")) is None
