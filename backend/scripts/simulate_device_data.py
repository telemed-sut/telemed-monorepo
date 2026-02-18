import random
import time
import argparse
from datetime import datetime
from typing import Dict
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.patient import Patient
from app.models.pressure_record import PressureRecord
from app.models.device_error_log import DeviceErrorLog

# Mock Constants
DEVICE_COUNT = 10
# Generate consistent device IDs
DEVICE_IDS = [f"DEV-{i:03d}" for i in range(1, DEVICE_COUNT + 1)]

ERROR_MESSAGES = [
    "Connection timeout",
    "Invalid data format",
    "Sensor calibration error",
    "Battery low",
    "Network unreachable",
    "Data checksum mismatch"
]

class DeviceSimulator:
    def __init__(self, device_id: str, patient_id: uuid.UUID):
        self.device_id = device_id
        self.patient_id = patient_id
        # Initial random state
        self.hr = random.randint(60, 90)
        self.sys = random.randint(110, 140)
        self.dia = random.randint(70, 90)
    
    def update_state(self):
        """Apply random walk to simulated vitals."""
        # Random walk: vary slightly from previous state
        self.hr += random.randint(-2, 2)
        self.sys += random.randint(-3, 3)
        self.dia += random.randint(-2, 2)
        
        # Keep within physiological bounds
        self.hr = max(40, min(180, self.hr))
        self.sys = max(90, min(200, self.sys))
        self.dia = max(50, min(120, self.dia))
        
        # Ensure Systolic > Diastolic
        if self.sys <= self.dia + 10:
            self.sys = self.dia + 15

    def generate_record(self) -> PressureRecord:
        """Create a PressureRecord based on current state."""
        # Generate some noisy waveform data
        wave_a = [random.randint(0, 1024) for _ in range(50)]
        wave_b = [random.randint(0, 1024) for _ in range(50)]
        
        return PressureRecord(
            patient_id=self.patient_id,
            device_id=self.device_id,
            heart_rate=self.hr,
            sys_rate=self.sys,
            dia_rate=self.dia,
            wave_a=wave_a,
            wave_b=wave_b,
            measured_at=datetime.utcnow()
        )

def get_patients(db: Session) -> list[Patient]:
    """Fetch all patients."""
    return db.scalars(select(Patient)).all()

def main():
    parser = argparse.ArgumentParser(description="Simulate realistic device data.")
    parser.add_argument("--loop", action="store_true", help="Run continuously")
    parser.add_argument("--interval", type=float, default=1.0, help="Interval in seconds (default: 1.0)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        patients = get_patients(db)
        if not patients:
            print("❌ No patients found. Please seed the database first.")
            return

        # Initialize simulators
        # Assign distinct devices to patients.
        # If fewer patients than devices, recycle patients.
        simulators: list[DeviceSimulator] = []
        for i, device_id in enumerate(DEVICE_IDS):
            patient = patients[i % len(patients)]
            sim = DeviceSimulator(device_id, patient.id)
            simulators.append(sim)
            print(f"🔹 Initialized {device_id} for Patient: {patient.first_name} {patient.last_name}")

        print(f"🚀 Starting simulation... (Interval: {args.interval}s)")

        while True:
            # Randomly pick a subset of devices to report data in this tick
            # (Simulating that not all devices report at the exact same millisecond, but functionally they stream in)
            # For high frequency, let's update ALL devices or a large subset.
            
            active_sims = simulators # Update all devices for maximum activity
            
            for sim in active_sims:
                # 1. Update vital signs (Random Walk)
                sim.update_state()
                
                # 2. Save Pressure Record
                record = sim.generate_record()
                db.add(record)
                
                # 3. Random Chance for Error (low probability)
                if random.random() < 0.02:  # 2% chance per tick
                    error_log = DeviceErrorLog(
                        device_id=sim.device_id,
                        error_message=random.choice(ERROR_MESSAGES),
                        ip_address=f"192.168.1.{random.randint(2, 254)}",
                        endpoint="/api/v1/ingest",
                        occurred_at=datetime.utcnow()
                    )
                    db.add(error_log)
                    print(f"⚠️  Error on {sim.device_id}: {error_log.error_message}")

            db.commit()
            print(f"✅ Updated {len(active_sims)} devices at {datetime.now().strftime('%H:%M:%S')}")
            
            if not args.loop:
                break
                
            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n🛑 Simulation stopped.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
