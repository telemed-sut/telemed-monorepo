import os
import secrets
from datetime import datetime
from urllib.parse import urlparse

from faker import Faker
from sqlalchemy import func, select

from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.patient import Patient
from app.models.user import User, UserRole

faker = Faker()
RNG = secrets.SystemRandom()
LOCAL_SEED_HOSTS = {"localhost", "127.0.0.1", "::1", "db", "patient-db"}


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _assert_demo_seed_allowed() -> None:
    if _is_truthy(os.getenv("ALLOW_DEMO_SEED")):
        return

    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required before running demo seed data.")

    if database_url.startswith("sqlite"):
        return

    parsed = urlparse(database_url)
    if parsed.hostname in LOCAL_SEED_HOSTS:
        return

    raise RuntimeError(
        "Refusing to seed demo credentials against a non-local database target. "
        "Set ALLOW_DEMO_SEED=true only if you intend to do this explicitly."
    )


def _seed_password(env_name: str, fallback: str) -> str:
    return (os.getenv(env_name) or fallback).strip()


def seed_users(db):
    users = [
        {
            "email": "admin@example.com",
            "password": _seed_password("SEED_ADMIN_PASSWORD", "AdminPass123"),
            "role": UserRole.admin,
        },
        {
            "email": "doctor@example.com",
            "password": _seed_password("SEED_DOCTOR_PASSWORD", "DoctorPass123"),
            "role": UserRole.doctor,
        },
        {
            "email": "medical-student@example.com",
            "password": _seed_password("SEED_MEDICAL_STUDENT_PASSWORD", "MedicalStudentPass123"),
            "role": UserRole.medical_student,
        },
    ]

    for user_data in users:
        existing = db.scalar(select(User).where(User.email == user_data["email"]))
        if existing:
            continue
        user = User(
            email=user_data["email"],
            password_hash=get_password_hash(user_data["password"]),
            role=user_data["role"],
        )
        db.add(user)
    db.commit()


def seed_patients(db, count: int = 15):
    existing_total = db.scalar(select(func.count()).select_from(Patient))
    if existing_total and existing_total > 0:
        return

    patients = []
    for _ in range(count):
        birth_date = faker.date_of_birth(minimum_age=1, maximum_age=95)
        patients.append(
            Patient(
                first_name=faker.first_name(),
                last_name=faker.last_name(),
                date_of_birth=birth_date,
                gender=RNG.choice(["male", "female", "other", None]),
                phone=faker.phone_number(),
                email=faker.email(),
                address=faker.address().replace("\n", ", "),
                created_at=datetime.utcnow(),
            )
        )

    db.add_all(patients)
    db.commit()


def main():
    _assert_demo_seed_allowed()
    db = SessionLocal()
    try:
        seed_users(db)
        seed_patients(db, 15)
        print("Seed completed")
    finally:
        db.close()


if __name__ == "__main__":
    main()
