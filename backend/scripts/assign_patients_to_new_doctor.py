#!/usr/bin/env python3
"""Assign patients to a new doctor as consulting role (primary slots are taken by demo doctor)."""
import os, sys
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.models.user import User
from app.models.patient import Patient
from app.models.doctor_patient_assignment import DoctorPatientAssignment

def assign(db_url: str, doctor_email: str, count: int = 50):
    db_url_clean = db_url.split("?")[0]
    engine = create_engine(db_url_clean)
    session = Session(engine)
    try:
        doctor = session.scalar(select(User).where(User.email == doctor_email))
        if not doctor:
            print(f"❌ Doctor {doctor_email} not found.")
            return
        if doctor.role != "doctor":
            print(f"❌ {doctor_email} is not a doctor (role={doctor.role})")
            return
        
        # Get all active patients
        all_patients = session.scalars(
            select(Patient).where(Patient.deleted_at.is_(None), Patient.is_active == True)
        ).all()
        
        if not all_patients:
            print("❌ No active patients found.")
            return
        
        # Get patients already assigned to THIS doctor
        assigned_ids = set(session.scalars(
            select(DoctorPatientAssignment.patient_id).where(
                DoctorPatientAssignment.doctor_id == doctor.id
            )
        ).all())
        
        # Assign as consulting (primary slots are taken by demo doctor)
        to_assign = [p for p in all_patients if p.id not in assigned_ids][:count]
        
        for p in to_assign:
            session.add(DoctorPatientAssignment(doctor_id=doctor.id, patient_id=p.id, role="consulting"))
        
        session.commit()
        print(f"✅ Assigned {len(to_assign)} patients to {doctor_email} as consulting doctor")
        print(f"   ({doctor.first_name} {doctor.last_name})")
    finally:
        session.close()

if __name__ == "__main__":
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("❌ DATABASE_URL required")
        sys.exit(1)
    assign(url, "ppansiunn@gmail.com", 50)
