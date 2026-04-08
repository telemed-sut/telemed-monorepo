#!/usr/bin/env python3
"""
Seed 100 demo patients into the database.
Run: PYTHONPATH=. .venv/bin/python scripts/seed_patients.py
"""

import os
import sys
import random
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

# Ensure we can import from the backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.db.base import Base
from app.models.patient import Patient

# ---------------------------------------------------------------------------
# Data pools -- Thai names & realistic hospital data
# ---------------------------------------------------------------------------

FIRST_NAMES = [
    "สมชาย", "สมหญิง", "วิชัย", "วิภา", "สุรินทร์", "สุพจน์", "มานะ", "มานี",
    "ประเสริฐ", "ประภา", "นพดล", "นภา", "สมศักดิ์", "สมศรี", "อนุชา", "อรุณ",
    "ธนพล", "ธนัญญา", "ปิยะ", "ปิ่นนภา", "ชัยวัฒน์", "ชวัลวิทย์", "ดวงกมล",
    "ดวงใจ", "เอกชัย", "เอกรินทร์", "ภานุพงศ์", "พรรณนิภา", "กิตติ", "กัลยา",
    "ธีรยุทธ์", "ธารินี", "นิติภูมิ", "นุชจรี", "ภาณุวัฒน์", "พิมพ์ใจ", "รณชัย",
    "รัตนา", "วีระชัย", "วรางคณา", "สราวุธ", "สวิตา", "อภิชาติ", "อมรา",
    "เจนวิทย์", "เจนจิรา", "ชัชชัย", "ชมพูนุช", "ณัฐพล", "ณัฐธิชา",
    "ดิลก", "ดวงสมร", "ทรงพล", "ทรงลักษณ์", "นที", "นฤมล", "บรรเจิด", "บุษบา",
    "ปรีชา", "ปวีณา", "พชร", "พรทิพย์", "พิชิต", "พิมลพรรณ", "ภควัฒน์", "มณี",
    "ยุพิน", "ยุวดี", "รวิช", "รุ่งอรุณ", "ลักขณา", "วรากร", "วรพงษ์", "วิลาวัลย์",
    "ศักดิ์ดา", "ศศิธร", "สันติ", "สมพร", "สมหมาย", "สุมิตร", "สุรีย์",
    "อรัญญา", "อรุณี", "อัมพร", "อัษฎา", "อุทัย", "อุบล",
]

LAST_NAMES = [
    "สุขใจ", "ศรีสุข", "แก้วมณี", "ทองคำ", "วงศ์สวัสดิ์", "เจริญสุข",
    "พงศ์พันธุ์", "รัตนากุล", "จันทร์เพ็ญ", "ดวงดี", "สมบูรณ์", "มั่นคง",
    "วิเชียร", "วงศ์ตระกูล", "กมลวรรณ", "จันทร์หอม", "ศรีสวัสดิ์",
    "ประทุม", "วงศ์พรหม", "ศรีวิชัย", "บุญมา", "บุญรอด", "บุญมี",
    "ศรีทอง", "แก้วกาฬ", "วงศ์วิริยะ", "จันทร์สว่าง", "ศรีจันทร์",
    "วงศ์ประเสริฐ", "ศรีสมบัติ", "วงศ์ธนกิจ", "ศรีปัญญา", "วงศ์วิวัฒน์",
    "ศรีวิไล", "วงศ์สมพร", "ศรีสมศักดิ์", "วงศ์วิชัย", "ศรีสุขสวัสดิ์",
    "วงศ์วัฒนา", "ศรีสมาน", "วงศ์วิจิตร", "ศรีสมบัติ", "วงศ์วิวัฒน์",
    "ศรีวิชัย", "วงศ์วิริยะ", "ศรีทอง", "วงศ์ประเสริฐ", "ศรีปัญญา",
    "วงศ์ธนกิจ", "ศรีสมศักดิ์", "วงศ์วิชัย", "ศรีสุขสวัสดิ์", "วงศ์วัฒนา",
    "ศรีสมาน", "วงศ์วิจิตร", "ศรีสมบัติ", "วงศ์วิวัฒน์", "ศรีวิชัย",
    "วงศ์วิริยะ", "ศรีทอง", "วงศ์ประเสริฐ", "ศรีปัญญา", "วงศ์ธนกิจ",
    "ศรีสมศักดิ์", "วงศ์วิชัย", "ศรีสุขสวัสดิ์", "วงศ์วัฒนา", "ศรีสมาน",
    "วงศ์วิจิตร", "ศรีสมบัติ", "วงศ์วิวัฒน์", "ศรีวิชัย", "วงศ์วิริยะ",
    "ศรีทอง", "วงศ์ประเสริฐ", "ศรีปัญญา", "วงศ์ธนกิจ", "ศรีสมศักดิ์",
    "วงศ์วิชัย", "ศรีสุขสวัสดิ์", "วงศ์วัฒนา", "ศรีสมาน", "วงศ์วิจิตร",
    "ศรีสมบัติ", "วงศ์วิวัฒน์", "ศรีวิชัย", "วงศ์วิริยะ", "ศรีทอง",
    "วงศ์ประเสริฐ", "ศรีปัญญา", "วงศ์ธนกิจ", "ศรีสมศักดิ์", "วงศ์วิชัย",
    "ศรีสุขสวัสดิ์", "วงศ์วัฒนา", "ศรีสมาน", "วงศ์วิจิตร",
]

WARDS = ["ICU", "ER", "Ward A", "Ward B", "Ward C", "Ward D", "Special Care", "General Ward"]
BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", None]
GENDERS = ["male", "female", "other"]
STATUSES = ["active", "active", "active", "active", "discharged", "critical"]
DIAGNOSES = [
    None, None, None, "Hypertension", "Type 2 Diabetes", "Asthma",
    "Heart Disease", "COPD", "Chronic Kidney Disease", "Thyroid Disorder",
    "Anemia", "Arthritis", "Migraine", "Gastritis", "Back Pain",
    "Insomnia", "Anxiety", "Depression", "Allergies", "None",
]

ALLERGIES = [
    None, None, None, "Penicillin", "Latex", "Peanuts", "Shellfish",
    "Sulfa drugs", "Aspirin", "Iodine", "Dust mites", "None",
]


def random_dob(min_age: int = 18, max_age: int = 90) -> date:
    today = date.today()
    dob = today - timedelta(days=random.randint(min_age * 365, max_age * 365))
    return dob


def generate_patients(count: int = 100) -> list[dict]:
    patients = []
    for i in range(count):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        patients.append({
            "first_name": first,
            "last_name": last,
            "date_of_birth": random_dob(),
            "gender": random.choice(GENDERS),
            "phone": f"08{random.randint(10_000_000, 99_999_999)}",
            "email": f"{first}{last}{random.randint(1, 999)}@example.com",
            "ward": random.choice(WARDS),
            "bed_number": f"{random.randint(1, 50):03d}",
            "blood_group": random.choice(BLOOD_GROUPS),
            "status": random.choice(STATUSES),
            "primary_diagnosis": random.choice(DIAGNOSES),
            "allergies": random.choice(ALLERGIES),
            "risk_score": random.randint(0, 10),
        })
    return patients


def seed_patients(db: Session, count: int = 100, clear: bool = False) -> None:
    if clear:
        print(f"🗑️  Deleting existing patients...")
        db.query(Patient).delete()
        db.commit()

    patients_data = generate_patients(count)
    for data in patients_data:
        p = Patient(**data)
        db.add(p)
    db.commit()
    print(f"✅ Seeded {count} patients into the database.")


if __name__ == "__main__":
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL environment variable is required.")
        sys.exit(1)

    # Strip sslmode for local SQLAlchemy connection
    db_url = db_url.split("?")[0]
    engine = create_engine(db_url)
    session = Session(engine)

    try:
        seed_patients(session, count=100, clear=True)
    finally:
        session.close()
