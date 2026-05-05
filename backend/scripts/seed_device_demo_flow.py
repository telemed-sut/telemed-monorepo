#!/usr/bin/env python3
"""Seed one reusable local demo flow for lung device sessions."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.secret_crypto import has_reserved_secret_prefix
from app.core.security import get_password_hash
from app.db.session import SessionLocal, settings
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import DeviceExamMeasurementType, DeviceExamSessionStatus, UserRole
from app.models.patient import Patient
from app.models.user import User
from app.services.device_exam_session import device_exam_session_service

LOCAL_SEED_HOSTS = {"localhost", "127.0.0.1", "::1", "db", "patient-db"}
DEVICE_SECRET_MIN_LENGTH = 32
DEFAULT_DOCTOR_EMAIL = "device-demo-doctor@example.com"
DEFAULT_DOCTOR_PASSWORD = "DeviceDemoPass123"
DEFAULT_PATIENT_EMAIL = "device-demo-patient@example.com"
DEFAULT_DEVICE_ID = "lung-demo-01"
DEFAULT_DEVICE_SECRET = "demo-lung-device-secret-1234567890abcdef"
REQUIRED_TABLES = (
    "users",
    "patients",
    "doctor_patient_assignments",
    "device_registrations",
    "device_exam_sessions",
)


@dataclass(frozen=True)
class DemoFlow:
    doctor: User
    patient: Patient
    device: DeviceRegistration
    session: DeviceExamSession
    doctor_password: str
    device_secret: str


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _assert_demo_seed_allowed() -> None:
    if _is_truthy(os.getenv("ALLOW_DEMO_SEED")):
        return

    database_url = (settings.database_url or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required before running demo seed data.")

    if database_url.startswith("sqlite"):
        return

    parsed = urlparse(database_url)
    if parsed.hostname in LOCAL_SEED_HOSTS:
        return

    raise RuntimeError(
        "Refusing to seed demo data against a non-local database target. "
        "Set ALLOW_DEMO_SEED=true only if you intend to do this explicitly."
    )


def _assert_required_tables_exist(db: Session) -> None:
    inspector = inspect(db.get_bind())
    missing_tables = [table for table in REQUIRED_TABLES if not inspector.has_table(table)]
    if not missing_tables:
        return

    missing = ", ".join(missing_tables)
    raise RuntimeError(
        "Database schema is not migrated for the device demo flow. "
        f"Missing table(s): {missing}. "
        "Run `venv/bin/alembic upgrade head` from the backend directory, "
        "or restart the backend container so its entrypoint applies migrations."
    )


def _clear_dashboard_stats_cache_quietly() -> None:
    return None


def _clear_device_secret_cache_quietly(device_id: str) -> None:
    return None


def _normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise ValueError("Email cannot be empty.")
    return normalized


def _normalize_device_id(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Device ID cannot be empty.")
    return normalized


def _normalize_secret(value: str) -> str:
    normalized = value.strip()
    if len(normalized) < DEVICE_SECRET_MIN_LENGTH:
        raise ValueError(f"Device secret must be at least {DEVICE_SECRET_MIN_LENGTH} characters.")
    if has_reserved_secret_prefix(normalized):
        raise ValueError("Device secret cannot start with reserved prefix 'encv1:'.")
    return normalized


def _get_or_create_doctor(
    db: Session,
    *,
    email: str,
    password: str,
    preserve_existing_password: bool,
) -> User:
    doctor = db.scalar(select(User).where(User.email == email))
    if doctor is None:
        doctor = User(
            email=email,
            password_hash=get_password_hash(password),
            role=UserRole.doctor,
            first_name="Device Demo",
            last_name="Doctor",
            is_active=True,
            specialty="Pulmonology",
            department="Respiratory Medicine",
        )
        db.add(doctor)
        db.commit()
        db.refresh(doctor)
        return doctor

    doctor.role = UserRole.doctor
    doctor.is_active = True
    doctor.deleted_at = None
    doctor.first_name = doctor.first_name or "Device Demo"
    doctor.last_name = doctor.last_name or "Doctor"
    doctor.specialty = doctor.specialty or "Pulmonology"
    doctor.department = doctor.department or "Respiratory Medicine"
    if not preserve_existing_password:
        doctor.password_hash = get_password_hash(password)
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    return doctor


def _get_or_create_patient(db: Session, *, email: str) -> Patient:
    patient = db.scalar(select(Patient).where(Patient.email == email))
    if patient is None:
        patient = Patient(
            first_name="Device Demo",
            last_name="Patient",
            name="Device Demo Patient",
            date_of_birth=date(1988, 4, 22),
            gender="female",
            phone="0800000001",
            email=email,
            address="Demo respiratory ward",
            is_active=True,
            status="active",
            doctor="Device Demo Doctor",
            ward="Respiratory Ward",
            bed_number="D-01",
            blood_group="O+",
            risk_score=2,
            primary_diagnosis="Demo lung sound follow-up",
        )
        db.add(patient)
        db.commit()
        db.refresh(patient)
        _clear_dashboard_stats_cache_quietly()
        return patient

    patient.first_name = "Device Demo"
    patient.last_name = "Patient"
    patient.name = "Device Demo Patient"
    patient.is_active = True
    patient.deleted_at = None
    patient.status = "active"
    patient.doctor = "Device Demo Doctor"
    patient.ward = patient.ward or "Respiratory Ward"
    patient.bed_number = patient.bed_number or "D-01"
    patient.primary_diagnosis = patient.primary_diagnosis or "Demo lung sound follow-up"
    db.add(patient)
    db.commit()
    db.refresh(patient)
    _clear_dashboard_stats_cache_quietly()
    return patient


def _ensure_assignment(db: Session, *, doctor: User, patient: Patient) -> DoctorPatientAssignment:
    assignment = db.scalar(
        select(DoctorPatientAssignment).where(
            DoctorPatientAssignment.doctor_id == doctor.id,
            DoctorPatientAssignment.patient_id == patient.id,
        )
    )
    if assignment is not None:
        return assignment

    existing_primary = db.scalar(
        select(DoctorPatientAssignment.id).where(
            DoctorPatientAssignment.patient_id == patient.id,
            DoctorPatientAssignment.role == "primary",
        )
    )
    assignment = DoctorPatientAssignment(
        doctor_id=doctor.id,
        patient_id=patient.id,
        role="consulting" if existing_primary else "primary",
    )
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        assignment = db.scalar(
            select(DoctorPatientAssignment).where(
                DoctorPatientAssignment.doctor_id == doctor.id,
                DoctorPatientAssignment.patient_id == patient.id,
            )
        )
        if assignment is None:
            raise
    _clear_dashboard_stats_cache_quietly()
    return assignment


def _get_or_create_device(
    db: Session,
    *,
    device_id: str,
    device_secret: str,
    doctor: User,
) -> DeviceRegistration:
    device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == device_id))
    now = datetime.now(timezone.utc)
    if device is None:
        device = DeviceRegistration(
            device_id=device_id,
            display_name="Demo Lung Cart 01",
            notes="Local demo lung sound device. Safe to rotate for development.",
            is_active=True,
            deactivated_at=None,
            created_by=doctor.id,
            updated_by=doctor.id,
        )
        device.device_secret = device_secret
        db.add(device)
    else:
        device.display_name = "Demo Lung Cart 01"
        device.notes = "Local demo lung sound device. Safe to rotate for development."
        device.is_active = True
        device.deactivated_at = None
        device.updated_by = doctor.id
        device.updated_at = now
        device.device_secret = device_secret
        db.add(device)

    db.commit()
    db.refresh(device)
    _clear_device_secret_cache_quietly(device_id)
    return device


def _get_reusable_session(
    db: Session,
    *,
    patient: Patient,
    device_id: str,
) -> DeviceExamSession | None:
    reusable_statuses = (
        DeviceExamSessionStatus.active,
        DeviceExamSessionStatus.pending_pair,
    )
    session = db.scalar(
        select(DeviceExamSession)
        .where(
            DeviceExamSession.device_id == device_id,
            DeviceExamSession.status.in_(reusable_statuses),
        )
        .order_by(DeviceExamSession.created_at.desc())
    )
    if session is None:
        return None

    if session.patient_id != patient.id:
        raise RuntimeError(
            f"Device {device_id} already has an open session for another patient "
            f"({session.patient_id}). Complete or cancel that session, or pass --device-id."
        )
    if session.measurement_type not in (
        DeviceExamMeasurementType.lung_sound,
        DeviceExamMeasurementType.multi,
    ):
        raise RuntimeError(
            f"Device {device_id} already has an open {session.measurement_type.value} session. "
            "Complete or cancel that session before using this demo flow."
        )
    return session


def _get_or_create_session(
    db: Session,
    *,
    doctor: User,
    patient: Patient,
    device_id: str,
    activate_now: bool,
) -> DeviceExamSession:
    existing = _get_reusable_session(db, patient=patient, device_id=device_id)
    if existing is not None:
        return existing

    try:
        return device_exam_session_service.create_session(
            db,
            actor=doctor,
            patient_id=patient.id,
            device_id=device_id,
            measurement_type=DeviceExamMeasurementType.lung_sound,
            encounter_id=None,
            notes="Seeded local demo session for simulator testing.",
            activate_now=activate_now,
            ip_address="127.0.0.1",
        )
    except HTTPException as exc:
        raise RuntimeError(f"Could not create device demo session: {exc.detail}") from exc


def seed_demo_flow(
    db: Session,
    *,
    doctor_email: str,
    doctor_password: str,
    patient_email: str,
    device_id: str,
    device_secret: str,
    activate_now: bool,
    preserve_existing_password: bool,
) -> DemoFlow:
    _assert_demo_seed_allowed()
    _assert_required_tables_exist(db)
    doctor = _get_or_create_doctor(
        db,
        email=doctor_email,
        password=doctor_password,
        preserve_existing_password=preserve_existing_password,
    )
    patient = _get_or_create_patient(db, email=patient_email)
    _ensure_assignment(db, doctor=doctor, patient=patient)
    device = _get_or_create_device(
        db,
        device_id=device_id,
        device_secret=device_secret,
        doctor=doctor,
    )
    session = _get_or_create_session(
        db,
        doctor=doctor,
        patient=patient,
        device_id=device.device_id,
        activate_now=activate_now,
    )
    return DemoFlow(
        doctor=doctor,
        patient=patient,
        device=device,
        session=session,
        doctor_password=doctor_password,
        device_secret=device_secret,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed a local doctor, patient, registered lung device, and device exam session.",
    )
    parser.add_argument("--doctor-email", default=os.getenv("DEMO_DOCTOR_EMAIL", DEFAULT_DOCTOR_EMAIL))
    parser.add_argument("--doctor-password", default=os.getenv("DEMO_DOCTOR_PASSWORD", DEFAULT_DOCTOR_PASSWORD))
    parser.add_argument("--patient-email", default=os.getenv("DEMO_PATIENT_EMAIL", DEFAULT_PATIENT_EMAIL))
    parser.add_argument("--device-id", default=os.getenv("DEMO_DEVICE_ID", DEFAULT_DEVICE_ID))
    parser.add_argument("--device-secret", default=os.getenv("DEMO_DEVICE_SECRET", DEFAULT_DEVICE_SECRET))
    parser.add_argument(
        "--pending",
        action="store_true",
        help="Create a pending pairing session instead of an already active session.",
    )
    parser.add_argument(
        "--preserve-existing-password",
        action="store_true",
        help="Do not reset the demo doctor password if the account already exists.",
    )
    return parser


def _print_summary(flow: DemoFlow) -> None:
    patient_name = flow.patient.name or f"{flow.patient.first_name} {flow.patient.last_name}"
    print("")
    print("Device demo flow is ready.")
    print("")
    print("Login")
    print(f"  Email:    {flow.doctor.email}")
    print(f"  Password: {flow.doctor_password}")
    print("")
    print("Patient")
    print(f"  ID:   {flow.patient.id}")
    print(f"  Name: {patient_name}")
    print("")
    print("Device")
    print(f"  ID:     {flow.device.device_id}")
    print(f"  Secret: {flow.device_secret}")
    print("")
    print("Session")
    print(f"  ID:           {flow.session.id}")
    print(f"  Status:       {flow.session.status.value}")
    print(f"  Pairing code: {flow.session.pairing_code}")
    print("")
    print("Simulator")
    print("  cd backend")
    print(f"  DEVICE_API_SECRET=\"{flow.device_secret}\" \\")
    print(f"  DEVICE_SESSION_ID=\"{flow.session.id}\" \\")
    print("  python tools/simulate_lung_device.py \\")
    print("    --base-url http://127.0.0.1:8000 \\")
    print(f"    --device-id {flow.device.device_id} \\")
    print("    --mode both")
    print("")


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    doctor_email = _normalize_email(args.doctor_email)
    patient_email = _normalize_email(args.patient_email)
    device_id = _normalize_device_id(args.device_id)
    device_secret = _normalize_secret(args.device_secret)
    doctor_password = args.doctor_password.strip()
    if not doctor_password:
        raise ValueError("Doctor password cannot be empty.")

    db = SessionLocal()
    try:
        flow = seed_demo_flow(
            db,
            doctor_email=doctor_email,
            doctor_password=doctor_password,
            patient_email=patient_email,
            device_id=device_id,
            device_secret=device_secret,
            activate_now=not args.pending,
            preserve_existing_password=args.preserve_existing_password,
        )
        _print_summary(flow)
    finally:
        db.close()


if __name__ == "__main__":
    main()
