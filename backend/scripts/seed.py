import random
from datetime import datetime

from faker import Faker
from sqlalchemy import func, select

from app.core.security import get_password_hash
from app.db.session import SessionLocal
from app.models.patient import Patient
from app.models.user import User, UserRole

faker = Faker()


def seed_users(db):
    users = [
        {
            "email": "admin@example.com",
            "password": "AdminPass123",
            "role": UserRole.admin,
        },
        {
            "email": "staff@example.com",
            "password": "StaffPass123",
            "role": UserRole.staff,
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
                gender=random.choice(["male", "female", "other", None]),
                phone=faker.phone_number(),
                email=faker.email(),
                address=faker.address().replace("\n", ", "),
                created_at=datetime.utcnow(),
            )
        )

    db.add_all(patients)
    db.commit()


def main():
    db = SessionLocal()
    try:
        seed_users(db)
        seed_patients(db, 15)
        print("Seed completed")
    finally:
        db.close()


if __name__ == "__main__":
    main()
