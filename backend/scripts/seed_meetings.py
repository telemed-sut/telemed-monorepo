"""Seed meetings for today with varied statuses for queue testing."""
from app.db.session import SessionLocal
from app.models.meeting import Meeting
from app.models.patient import Patient
from app.models.enums import MeetingStatus
from datetime import datetime, timezone, timedelta

db = SessionLocal()

target_doctor = "e888b197-fc9d-4bf8-9546-b34e42a7985e"

# Get patients
patients = db.query(Patient).limit(6).all()
if len(patients) < 6:
    print(f"Only {len(patients)} patients available, need at least 6")
    db.close()
    exit(1)

# Create today's meetings at various hours
now = datetime.now(timezone.utc)
today_base = now.replace(hour=0, minute=0, second=0, microsecond=0)

new_meetings = [
    {"hour": 2, "min": 0, "status": MeetingStatus.completed, "patient_idx": 0, "desc": "Morning checkup"},
    {"hour": 3, "min": 0, "status": MeetingStatus.completed, "patient_idx": 1, "desc": "Blood pressure follow-up"},
    {"hour": 4, "min": 0, "status": MeetingStatus.in_progress, "patient_idx": 2, "desc": "Cardiology consultation"},
    {"hour": 4, "min": 30, "status": MeetingStatus.overtime, "patient_idx": 3, "desc": "Diabetes review"},
    {"hour": 5, "min": 0, "status": MeetingStatus.waiting, "patient_idx": 4, "desc": "General consultation"},
    {"hour": 6, "min": 0, "status": MeetingStatus.scheduled, "patient_idx": 5, "desc": "New patient intake"},
]

for m_data in new_meetings:
    dt = today_base + timedelta(hours=m_data["hour"], minutes=m_data["min"])
    patient = patients[m_data["patient_idx"]]
    meeting = Meeting(
        date_time=dt,
        description=m_data["desc"],
        doctor_id=target_doctor,
        user_id=patient.id,
        status=m_data["status"],
        room=f"Room {100 + m_data['patient_idx']}",
    )
    db.add(meeting)
    print(f"Created: {m_data['desc']} | {dt.isoformat()} | {m_data['status'].value} | patient={patient.first_name} {patient.last_name}")

db.commit()

# Verify
count = db.query(Meeting).filter(
    Meeting.doctor_id == target_doctor,
).count()
print(f"\nTotal meetings for awd asd: {count}")
db.close()
print("Done!")

