#!/usr/bin/env python3
"""
Assign patients to the demo doctor.
Run: PYTHONPATH=. .venv/bin/python scripts/assign_patients_to_demo_doctor.py
"""

import os
import sys
from sqlalchemy import select
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.models.user import User
from app.models.patient import Patient
from app.models.doctor_patient_assignment import DoctorPatientAssignment


def assign_patients_to_demo_doctor(db: Session) -> int:
    # Find the demo doctor
    doctor = db.scalar(select(User).where(User.email == "doctor@emedhelp.example.com"))
    if not doctor:
        print("❌ Demo doctor not found. Did you run the seed migration?")
        return 0

    print(f"🩺 Found demo doctor: {doctor.first_name} {doctor.last_name} ({doctor.id})")

    # Get all active patients
    patients = db.scalars(
        select(Patient).where(Patient.deleted_at.is_(None), Patient.is_active == True)
    ).all()

    if not patients:
        print("❌ No active patients found. Run scripts/seed_patients.py first.")
        return 0

    print(f"📋 Found {len(patients)} active patients")

    assigned = 0
    for patient in patients:
        # Check if already assigned
        existing = db.scalar(
            select(DoctorPatientAssignment).where(
                DoctorPatientAssignment.doctor_id == doctor.id,
                DoctorPatientAssignment.patient_id == patient.id,
            )
        )
        if existing:
            continue

        db.add(DoctorPatientAssignment(
            doctor_id=doctor.id,
            patient_id=patient.id,
            role="primary",
        ))
        assigned += 1

    db.commit()
    print(f"✅ Assigned {assigned} patients to the demo doctor.")
    return assigned


if __name__ == "__main__":
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("❌ DATABASE_URL environment variable is required.")
        sys.exit(1)

    db_url = db_url.split("?")[0]
    from sqlalchemy import create_engine
    engine = create_engine(db_url)
    session = Session(engine)

    try:
        assign_patients_to_demo_doctor(session)
    finally:
        session.close()
