from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.patient import Patient
from app.models.patient_app_session import PatientAppSession
from app.models.user import User
from app.models.user_session import UserSession


def _load_cleanup_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "cleanup_sessions.py"
    spec = importlib.util.spec_from_file_location("cleanup_sessions", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_cleanup_sessions_removes_only_stale_user_and_patient_sessions(db: Session, monkeypatch):
    module = _load_cleanup_module()
    now = datetime.now(timezone.utc)

    user = User(
        email="cleanup-sessions@example.com",
        password_hash="hash",
        role=UserRole.admin,
        is_active=True,
    )
    patient = Patient(
        first_name="Cleanup",
        last_name="Patient",
        phone="+66812345678",
        date_of_birth=datetime(1990, 1, 1, tzinfo=timezone.utc).date(),
        is_active=True,
    )
    db.add_all([user, patient])
    db.commit()
    db.refresh(user)
    db.refresh(patient)

    db.add_all(
        [
            UserSession(
                user_id=user.id,
                session_id="user-old-revoked",
                auth_source="local",
                last_seen_at=now - timedelta(days=20),
                expires_at=now - timedelta(days=10),
                revoked_at=now - timedelta(days=10),
            ),
            UserSession(
                user_id=user.id,
                session_id="user-old-expired",
                auth_source="local",
                last_seen_at=now - timedelta(days=12),
                expires_at=now - timedelta(days=8),
            ),
            UserSession(
                user_id=user.id,
                session_id="user-active",
                auth_source="local",
                last_seen_at=now,
                expires_at=now + timedelta(days=1),
            ),
            PatientAppSession(
                patient_id=patient.id,
                session_id="patient-old-revoked",
                last_seen_at=now - timedelta(days=20),
                expires_at=now - timedelta(days=10),
                revoked_at=now - timedelta(days=10),
            ),
            PatientAppSession(
                patient_id=patient.id,
                session_id="patient-old-expired",
                last_seen_at=now - timedelta(days=12),
                expires_at=now - timedelta(days=8),
            ),
            PatientAppSession(
                patient_id=patient.id,
                session_id="patient-active",
                last_seen_at=now,
                expires_at=now + timedelta(days=1),
            ),
        ]
    )
    db.commit()

    monkeypatch.setattr(module, "SessionLocal", lambda: db)

    summary = module.cleanup_sessions(
        revoked_retention_days=7,
        expired_retention_days=7,
        batch_size=2,
    )

    remaining_user_session_ids = db.scalars(
        select(UserSession.session_id).order_by(UserSession.session_id.asc())
    ).all()
    remaining_patient_session_ids = db.scalars(
        select(PatientAppSession.session_id).order_by(PatientAppSession.session_id.asc())
    ).all()

    assert summary == {"user_sessions": 2, "patient_app_sessions": 2}
    assert remaining_user_session_ids == ["user-active"]
    assert remaining_patient_session_ids == ["patient-active"]


def test_cleanup_sessions_is_idempotent(db: Session, monkeypatch):
    module = _load_cleanup_module()
    monkeypatch.setattr(module, "SessionLocal", lambda: db)

    summary = module.cleanup_sessions(
        revoked_retention_days=7,
        expired_retention_days=7,
        batch_size=10,
    )

    assert summary == {"user_sessions": 0, "patient_app_sessions": 0}
