from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.ip_ban import IPBan
from app.models.login_attempt import LoginAttempt
from app.models.user import User
from app.core.security import get_password_hash
from app.services.auth import create_login_response


def _create_user(db: Session, *, email: str, role: UserRole) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("TestPass123"),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_headers(user: User) -> dict[str, str]:
    token = create_login_response(user)["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_list_active_ip_bans(client: TestClient, db: Session):
    admin = _create_user(db, email="ipban-admin@example.com", role=UserRole.admin)
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            IPBan(
                ip_address="203.0.113.10",
                reason="Too many failures",
                failed_attempts=7,
                banned_until=now + timedelta(hours=2),
            ),
            IPBan(
                ip_address="203.0.113.11",
                reason="Expired ban",
                failed_attempts=2,
                banned_until=now - timedelta(minutes=5),
            ),
        ]
    )
    db.commit()

    response = client.get("/security/ip-bans", headers=_auth_headers(admin))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["ip_address"] == "203.0.113.10"
    assert payload["items"][0]["failed_attempts"] == 7


def test_admin_can_create_and_update_ip_ban(client: TestClient, db: Session):
    admin = _create_user(db, email="ipban-create@example.com", role=UserRole.admin)

    create_response = client.post(
        "/security/ip-bans",
        json={
            "ip_address": "198.51.100.77",
            "reason": "Manual block",
            "duration_minutes": 90,
        },
        headers=_auth_headers(admin),
    )
    assert create_response.status_code == 200, create_response.text
    create_payload = create_response.json()
    assert create_payload["ip_address"] == "198.51.100.77"
    assert create_payload["reason"] == "Manual block"

    update_response = client.post(
        "/security/ip-bans",
        json={
            "ip_address": "198.51.100.77",
            "reason": "Manual block updated",
            "duration_minutes": 120,
        },
        headers=_auth_headers(admin),
    )
    assert update_response.status_code == 200, update_response.text
    update_payload = update_response.json()
    assert update_payload["ip_address"] == "198.51.100.77"
    assert update_payload["reason"] == "Manual block updated"

    ban = db.scalar(select(IPBan).where(IPBan.ip_address == "198.51.100.77"))
    assert ban is not None
    assert ban.reason == "Manual block updated"

    audit_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "ip_ban_create")
        .order_by(AuditLog.created_at.asc())
    ).all()
    assert len(audit_logs) == 2


def test_admin_cannot_ban_own_ip(client: TestClient, db: Session):
    admin = _create_user(db, email="ipban-ownip@example.com", role=UserRole.admin)

    response = client.post(
        "/security/ip-bans",
        json={
            "ip_address": "testclient",
            "reason": "Should fail",
            "duration_minutes": 30,
        },
        headers=_auth_headers(admin),
    )

    assert response.status_code == 400
    assert "cannot ban your own ip" in response.json()["detail"].lower()


def test_admin_can_delete_ip_ban(client: TestClient, db: Session):
    admin = _create_user(db, email="ipban-delete@example.com", role=UserRole.admin)
    db.add(
        IPBan(
            ip_address="198.51.100.88",
            reason="Cleanup",
            failed_attempts=3,
            banned_until=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    db.commit()

    response = client.delete(
        "/security/ip-bans/198.51.100.88",
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    assert "unbanned" in response.json()["message"].lower()
    assert db.scalar(select(IPBan).where(IPBan.ip_address == "198.51.100.88")) is None

    audit = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "ip_ban_delete")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None


def test_login_attempts_support_filters(client: TestClient, db: Session):
    admin = _create_user(db, email="attempts-admin@example.com", role=UserRole.admin)
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            LoginAttempt(
                ip_address="203.0.113.1",
                email="one@example.com",
                success=False,
                details="invalid password",
                created_at=now - timedelta(minutes=2),
            ),
            LoginAttempt(
                ip_address="203.0.113.2",
                email="two@example.com",
                success=True,
                details="login ok",
                created_at=now - timedelta(minutes=1),
            ),
        ]
    )
    db.commit()

    response = client.get(
        "/security/login-attempts?email=one@example.com&success=false",
        headers=_auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["email"] == "one@example.com"
    assert payload["items"][0]["success"] is False
    assert payload["items"][0]["details"] == "invalid password"


def test_non_admin_cannot_access_ip_bans_or_login_attempts(
    client: TestClient,
    db: Session,
):
    staff = _create_user(db, email="security-staff@example.com", role=UserRole.staff)
    headers = _auth_headers(staff)

    ip_bans_response = client.get("/security/ip-bans", headers=headers)
    attempts_response = client.get("/security/login-attempts", headers=headers)

    assert ip_bans_response.status_code == 403
    assert attempts_response.status_code == 403
