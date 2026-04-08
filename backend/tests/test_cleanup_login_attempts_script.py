from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.login_attempt import LoginAttempt


def _load_cleanup_module():
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "cleanup_login_attempts.py"
    spec = importlib.util.spec_from_file_location("cleanup_login_attempts", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_cleanup_old_login_attempts_removes_only_expired_records(db: Session, monkeypatch):
    module = _load_cleanup_module()
    now = datetime.now(timezone.utc)

    db.add_all(
        [
            LoginAttempt(
                ip_address="127.0.0.1",
                email="old@example.com",
                success=False,
                details="Old attempt",
                created_at=now - timedelta(days=91),
            ),
            LoginAttempt(
                ip_address="127.0.0.1",
                email="recent@example.com",
                success=False,
                details="Recent attempt",
                created_at=now - timedelta(days=7),
            ),
        ]
    )
    db.commit()

    monkeypatch.setattr(module, "SessionLocal", lambda: db)

    deleted_count = module.cleanup_old_login_attempts(retention_days=90, batch_size=10)

    remaining_emails = db.scalars(select(LoginAttempt.email)).all()

    assert deleted_count == 1
    assert remaining_emails == ["recent@example.com"]
