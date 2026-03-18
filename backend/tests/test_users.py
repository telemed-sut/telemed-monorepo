"""Tests for user management API – RBAC, CRUD, soft-delete, validation, audit."""


from datetime import datetime, timedelta, timezone
from uuid import UUID as PyUUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole, VerificationStatus
from app.models.invite import UserInvite
from app.models.user import User


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────


def _parse_details(raw):
    """Parse audit log details — handles both dict (JSONB) and str (legacy)."""
    if isinstance(raw, dict):
        return raw
    import json
    return json.loads(raw)

def _make_user(
    db: Session,
    *,
    email: str,
    role: UserRole = UserRole.staff,
    password: str = "TestPass123",
    first_name: str = "Test",
    last_name: str = "User",
) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash(password),
        first_name=first_name,
        last_name=last_name,
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, email: str, password: str = "TestPass123") -> str:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ──────────────────────────────────────────────────────────
# RBAC – admin-only endpoints
# ──────────────────────────────────────────────────────────

class TestRBAC:
    def test_staff_cannot_list_users(self, client: TestClient, db: Session):
        _make_user(db, email="staff@example.com", role=UserRole.staff)
        token = _login(client, "staff@example.com")
        resp = client.get("/users", headers=_auth(token))
        assert resp.status_code == 403

    def test_admin_can_list_users(self, client: TestClient, db: Session):
        _make_user(db, email="admin@example.com", role=UserRole.admin)
        token = _login(client, "admin@example.com")
        resp = client.get("/users", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert data["total"] >= 1

    def test_staff_cannot_create_user(self, client: TestClient, db: Session):
        _make_user(db, email="staff2@example.com", role=UserRole.staff)
        token = _login(client, "staff2@example.com")
        resp = client.post("/users", json={
            "email": "new@example.com",
            "password": "NewPass123",
        }, headers=_auth(token))
        assert resp.status_code == 403

    def test_staff_cannot_delete_user(self, client: TestClient, db: Session):
        target = _make_user(db, email="target@example.com", role=UserRole.staff)
        staff = _make_user(db, email="staff3@example.com", role=UserRole.staff)
        token = _login(client, "staff3@example.com")
        resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert resp.status_code == 403

    def test_doctor_cannot_list_users(self, client: TestClient, db: Session):
        _make_user(db, email="doc@example.com", role=UserRole.doctor)
        token = _login(client, "doc@example.com")
        resp = client.get("/users", headers=_auth(token))
        assert resp.status_code == 403

    def test_user_can_read_self(self, client: TestClient, db: Session):
        user = _make_user(db, email="self@example.com", role=UserRole.staff)
        token = _login(client, "self@example.com")
        resp = client.get(f"/users/{user.id}", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["email"] == "self@example.com"

    def test_user_cannot_read_other(self, client: TestClient, db: Session):
        other = _make_user(db, email="other@example.com", role=UserRole.staff)
        user = _make_user(db, email="me@example.com", role=UserRole.staff)
        token = _login(client, "me@example.com")
        resp = client.get(f"/users/{other.id}", headers=_auth(token))
        assert resp.status_code == 403

    def test_non_admin_cannot_change_role(self, client: TestClient, db: Session):
        user = _make_user(db, email="norole@example.com", role=UserRole.staff)
        token = _login(client, "norole@example.com")
        resp = client.put(f"/users/{user.id}", json={"role": "admin"}, headers=_auth(token))
        assert resp.status_code == 403


# ──────────────────────────────────────────────────────────
# CRUD – create, update, list
# ──────────────────────────────────────────────────────────

class TestCRUD:
    def test_create_user(self, client: TestClient, db: Session):
        _make_user(db, email="admin-crud@example.com", role=UserRole.admin)
        token = _login(client, "admin-crud@example.com")
        resp = client.post("/users", json={
            "email": "newuser@example.com",
            "password": "NewPass123",
            "first_name": "New",
            "last_name": "User",
            "role": "staff",
        }, headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "newuser@example.com"
        assert data["role"] == "staff"
        assert data["is_active"] is True

    def test_create_duplicate_email_fails(self, client: TestClient, db: Session):
        _make_user(db, email="dup@example.com", role=UserRole.admin)
        _make_user(db, email="existing@example.com")
        token = _login(client, "dup@example.com")
        resp = client.post("/users", json={
            "email": "existing@example.com",
            "password": "Pass1234",
        }, headers=_auth(token))
        assert resp.status_code == 400

    def test_update_user(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-upd@example.com", role=UserRole.admin)
        target = _make_user(db, email="updtarget@example.com", role=UserRole.staff)
        token = _login(client, "admin-upd@example.com")
        resp = client.put(f"/users/{target.id}", json={
            "first_name": "Updated",
            "role": "doctor",
            "license_no": "MD12345",
        }, headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["first_name"] == "Updated"
        assert data["role"] == "doctor"

    def test_list_users_filters(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-filt@example.com", role=UserRole.admin)
        _make_user(db, email="doc1@example.com", role=UserRole.doctor)
        _make_user(db, email="nurse1@example.com", role=UserRole.nurse)
        token = _login(client, "admin-filt@example.com")

        # Filter by role
        resp = client.get("/users?role=doctor", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert all(u["role"] == "doctor" for u in data["items"])

    def test_list_users_clinical_only_scope(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-scope@example.com", role=UserRole.admin)
        _make_user(db, email="doctor-scope@example.com", role=UserRole.doctor)
        _make_user(db, email="staff-scope@example.com", role=UserRole.staff)
        token = _login(client, "admin-scope@example.com")

        resp = client.get("/users?clinical_only=true", headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) > 0
        assert all(
            item["role"] in {"doctor", "nurse", "pharmacist", "medical_technologist", "psychologist"}
            for item in data["items"]
        )

    def test_list_pagination(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-page@example.com", role=UserRole.admin)
        for i in range(5):
            _make_user(db, email=f"page{i}@example.com")
        token = _login(client, "admin-page@example.com")
        resp = client.get("/users?page=1&limit=2", headers=_auth(token))
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 6  # admin + 5 users

    def test_list_users_searches_full_name_and_ignores_invisible_chars(self, client: TestClient, db: Session):
        _make_user(db, email="admin-search@example.com", role=UserRole.admin)
        _make_user(
            db,
            email="papon.doctor@example.com",
            role=UserRole.doctor,
            first_name="Papon",
            last_name="Moonkonburee",
        )
        token = _login(client, "admin-search@example.com")

        resp = client.get("/users?q=papon\u200b moonkonburee", headers=_auth(token))

        assert resp.status_code == 200
        emails = {item["email"] for item in resp.json()["items"]}
        assert "papon.doctor@example.com" in emails

    def test_cannot_demote_admin_when_minimum_admins_reached(self, client: TestClient, db: Session):
        admin1 = _make_user(db, email="admin-demote-a@example.com", role=UserRole.admin)
        admin2 = _make_user(db, email="admin-demote-b@example.com", role=UserRole.admin)
        token = _login(client, "admin-demote-a@example.com")

        resp = client.put(
            f"/users/{admin2.id}",
            json={"role": "staff"},
            headers=_auth(token),
        )
        assert resp.status_code == 400
        assert "At least" in resp.json()["detail"]


# ──────────────────────────────────────────────────────────
# Soft Delete
# ──────────────────────────────────────────────────────────

class TestSoftDelete:
    def test_delete_sets_deleted_at(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-del@example.com", role=UserRole.admin)
        target = _make_user(db, email="delme@example.com", role=UserRole.staff)
        token = _login(client, "admin-del@example.com")
        resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert resp.status_code == 204

        db.refresh(target)
        assert target.deleted_at is not None
        assert target.is_active is False

    def test_deleted_user_excluded_from_list(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-excl@example.com", role=UserRole.admin)
        target = _make_user(db, email="hidden@example.com")
        token = _login(client, "admin-excl@example.com")

        # Delete user
        client.delete(f"/users/{target.id}", headers=_auth(token))

        # List should not include deleted user
        resp = client.get("/users", headers=_auth(token))
        emails = [u["email"] for u in resp.json()["items"]]
        assert "hidden@example.com" not in emails

    def test_deleted_user_cannot_login(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-nologin@example.com", role=UserRole.admin)
        target = _make_user(db, email="nologin@example.com")
        token = _login(client, "admin-nologin@example.com")

        client.delete(f"/users/{target.id}", headers=_auth(token))

        resp = client.post("/auth/login", json={
            "email": "nologin@example.com",
            "password": "TestPass123",
        })
        assert resp.status_code == 401

    def test_can_reuse_email_after_soft_delete(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-reuse@example.com", role=UserRole.admin)
        target = _make_user(db, email="reuse@example.com", role=UserRole.staff)
        token = _login(client, "admin-reuse@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        create_resp = client.post(
            "/users",
            json={
                "email": "reuse@example.com",
                "password": "NewPass123",
                "first_name": "Reuse",
                "last_name": "Account",
                "role": "staff",
            },
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        created = create_resp.json()
        assert created["email"] == "reuse@example.com"
        assert created["id"] != str(target.id)

        db.refresh(target)
        assert target.email.startswith("deleted+")
        assert target.deleted_at is not None

    def test_prevent_self_delete(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-self@example.com", role=UserRole.admin)
        token = _login(client, "admin-self@example.com")
        resp = client.delete(f"/users/{admin.id}", headers=_auth(token))
        assert resp.status_code == 400
        assert "Cannot delete yourself" in resp.json()["detail"]

    def test_prevent_delete_when_would_drop_below_min_admins(self, client: TestClient, db: Session):
        admin1 = _make_user(db, email="lastadmin@example.com", role=UserRole.admin)
        admin2 = _make_user(db, email="admin2@example.com", role=UserRole.admin)
        token = _login(client, "admin2@example.com")

        # With minimum active admins = 2, this should be blocked.
        resp = client.delete(f"/users/{admin1.id}", headers=_auth(token))
        assert resp.status_code == 400
        assert "At least" in resp.json()["detail"]

        # Self-delete is still blocked.
        resp = client.delete(f"/users/{admin2.id}", headers=_auth(token))
        assert resp.status_code == 400  # self-delete

    def test_delete_admin_allowed_when_more_than_minimum(self, client: TestClient, db: Session):
        admin1 = _make_user(db, email="admin-a@example.com", role=UserRole.admin)
        admin2 = _make_user(db, email="admin-b@example.com", role=UserRole.admin)
        admin3 = _make_user(db, email="admin-c@example.com", role=UserRole.admin)
        token = _login(client, "admin-a@example.com")

        resp = client.delete(f"/users/{admin3.id}", headers=_auth(token))
        assert resp.status_code == 204

    def test_restore_soft_deleted_user(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-restore@example.com", role=UserRole.admin)
        target = _make_user(db, email="restore-target@example.com", role=UserRole.staff)
        token = _login(client, "admin-restore@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        restore_resp = client.post(f"/users/{target.id}/restore", headers=_auth(token))
        assert restore_resp.status_code == 200, restore_resp.text
        restored = restore_resp.json()
        assert restored["email"] == "restore-target@example.com"
        assert restored["deleted_at"] is None
        assert restored["is_active"] is True

    def test_restore_soft_deleted_user_from_legacy_string_audit_details(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-restore-legacy@example.com", role=UserRole.admin)
        target = _make_user(db, email="restore-legacy@example.com", role=UserRole.staff)
        token = _login(client, "admin-restore-legacy@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        latest_delete_log = db.query(AuditLog).filter(
            AuditLog.action == "user_delete",
            AuditLog.resource_id == PyUUID(str(target.id)),
        ).order_by(AuditLog.created_at.desc()).first()
        assert latest_delete_log is not None

        import json
        latest_delete_log.details = json.dumps({"before": {"email": "restore-legacy@example.com"}})
        db.add(latest_delete_log)
        db.commit()

        restore_resp = client.post(f"/users/{target.id}/restore", headers=_auth(token))
        assert restore_resp.status_code == 200, restore_resp.text
        restored = restore_resp.json()
        assert restored["email"] == "restore-legacy@example.com"
        assert restored["deleted_at"] is None
        assert restored["is_active"] is True

    def test_restore_keeps_retired_email_when_original_is_taken(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-restore2@example.com", role=UserRole.admin)
        target = _make_user(db, email="restore-conflict@example.com", role=UserRole.staff)
        token = _login(client, "admin-restore2@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        create_resp = client.post(
            "/users",
            json={
                "email": "restore-conflict@example.com",
                "password": "NewPass123",
                "first_name": "Conflict",
                "last_name": "Owner",
                "role": "staff",
            },
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text

        restore_resp = client.post(f"/users/{target.id}/restore", headers=_auth(token))
        assert restore_resp.status_code == 200, restore_resp.text
        restored = restore_resp.json()
        assert restored["email"].startswith("deleted+")
        assert restored["deleted_at"] is None
        assert restored["is_active"] is True

    def test_bulk_delete_requires_confirm_text_when_more_than_three(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-bulk-confirm@example.com", role=UserRole.admin)
        users = [
            _make_user(db, email="bulk-c1@example.com", role=UserRole.staff),
            _make_user(db, email="bulk-c2@example.com", role=UserRole.staff),
            _make_user(db, email="bulk-c3@example.com", role=UserRole.staff),
            _make_user(db, email="bulk-c4@example.com", role=UserRole.staff),
        ]
        token = _login(client, "admin-bulk-confirm@example.com")

        resp = client.post(
            "/users/bulk-delete",
            json={"ids": [str(user.id) for user in users]},
            headers=_auth(token),
        )
        assert resp.status_code == 400
        assert "confirm_text" in resp.json()["detail"]

        ok_resp = client.post(
            "/users/bulk-delete",
            json={"ids": [str(user.id) for user in users], "confirm_text": "DELETE"},
            headers=_auth(token),
        )
        assert ok_resp.status_code == 200
        assert ok_resp.json()["deleted"] == 4

    def test_bulk_restore_users(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-bulk-restore@example.com", role=UserRole.admin)
        users = [
            _make_user(db, email="bulk-r1@example.com", role=UserRole.staff),
            _make_user(db, email="bulk-r2@example.com", role=UserRole.staff),
        ]
        token = _login(client, "admin-bulk-restore@example.com")

        delete_resp = client.post(
            "/users/bulk-delete",
            json={"ids": [str(user.id) for user in users]},
            headers=_auth(token),
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"] == 2

        restore_resp = client.post(
            "/users/bulk-restore",
            json={"ids": [str(user.id) for user in users]},
            headers=_auth(token),
        )
        assert restore_resp.status_code == 200
        assert restore_resp.json()["restored"] == 2

    def test_purge_deleted_requires_confirm_text(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-purge-confirm@example.com", role=UserRole.admin)
        token = _login(client, "admin-purge-confirm@example.com")

        resp = client.post(
            "/users/purge-deleted",
            json={"older_than_days": 90, "confirm_text": "DELETE", "reason": "Quarterly retention policy"},
            headers=_auth(token),
        )
        assert resp.status_code == 400
        assert "confirm_text" in resp.json()["detail"]

    def test_purge_deleted_requires_reason(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-purge-reason@example.com", role=UserRole.admin)
        token = _login(client, "admin-purge-reason@example.com")

        resp = client.post(
            "/users/purge-deleted",
            json={"older_than_days": 90, "confirm_text": "PURGE"},
            headers=_auth(token),
        )
        assert resp.status_code == 422

    def test_purge_deleted_hard_deletes_old_soft_deleted_accounts(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-purge@example.com", role=UserRole.admin)
        target = _make_user(db, email="purge-target@example.com", role=UserRole.staff)
        target_id = target.id
        token = _login(client, "admin-purge@example.com")

        delete_resp = client.delete(f"/users/{target_id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        db.refresh(target)
        target.deleted_at = datetime.now(timezone.utc) - timedelta(days=120)
        db.add(target)
        db.commit()

        purge_resp = client.post(
            "/users/purge-deleted",
            json={
                "older_than_days": 90,
                "confirm_text": "PURGE",
                "reason": "Cleanup soft-deleted records after retention window",
            },
            headers=_auth(token),
        )
        assert purge_resp.status_code == 200
        assert purge_resp.json()["purged"] >= 1

        still_exists = db.query(User).filter(User.id == target_id).first()
        assert still_exists is None


# ──────────────────────────────────────────────────────────
# Validation – clinical roles
# ──────────────────────────────────────────────────────────

class TestValidation:
    def test_direct_create_clinical_role_blocked_when_invite_only(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-val@example.com", role=UserRole.admin)
        token = _login(client, "admin-val@example.com")
        resp = client.post("/users", json={
            "email": "doc-no-lic@example.com",
            "password": "DocPass123",
            "role": "doctor",
            "license_no": "MD-TEST",
        }, headers=_auth(token))
        assert resp.status_code == 400
        assert "invite flow" in resp.json()["detail"].lower()

    def test_direct_create_non_clinical_role_still_allowed(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-val2@example.com", role=UserRole.admin)
        token = _login(client, "admin-val2@example.com")
        resp = client.post("/users", json={
            "email": "staff-direct@example.com",
            "password": "StaffPass123",
            "role": "staff",
        }, headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "staff"


# ──────────────────────────────────────────────────────────
# Invite lifecycle
# ──────────────────────────────────────────────────────────

class TestInviteLifecycle:
    def test_list_active_invites(self, client: TestClient, db: Session):
        _make_user(db, email="admin-invite-list@example.com", role=UserRole.admin)
        token = _login(client, "admin-invite-list@example.com")

        create_resp = client.post(
            "/users/invites",
            json={"email": "doctor-invite-list@example.com", "role": "doctor"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text

        list_resp = client.get("/users/invites?status_filter=active", headers=_auth(token))
        assert list_resp.status_code == 200
        payload = list_resp.json()
        assert payload["total"] >= 1
        matched = [item for item in payload["items"] if item["email"] == "doctor-invite-list@example.com"]
        assert len(matched) == 1
        assert matched[0]["status"] == "active"

    def test_revoke_invite(self, client: TestClient, db: Session):
        _make_user(db, email="admin-invite-revoke@example.com", role=UserRole.admin)
        token = _login(client, "admin-invite-revoke@example.com")

        create_resp = client.post(
            "/users/invites",
            json={"email": "doctor-invite-revoke@example.com", "role": "doctor"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200

        invite = db.query(UserInvite).filter(
            UserInvite.email == "doctor-invite-revoke@example.com"
        ).order_by(UserInvite.created_at.desc()).first()
        assert invite is not None

        revoke_resp = client.post(f"/users/invites/{invite.id}/revoke", headers=_auth(token))
        assert revoke_resp.status_code == 200
        assert "revoked" in revoke_resp.json()["message"].lower()

        list_closed = client.get("/users/invites?status_filter=closed", headers=_auth(token))
        assert list_closed.status_code == 200
        assert any(item["id"] == str(invite.id) for item in list_closed.json()["items"])

    def test_resend_invite_rotates_active_invite(self, client: TestClient, db: Session):
        _make_user(db, email="admin-invite-resend@example.com", role=UserRole.admin)
        token = _login(client, "admin-invite-resend@example.com")

        create_resp = client.post(
            "/users/invites",
            json={"email": "doctor-invite-resend@example.com", "role": "doctor"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200

        first_invite = db.query(UserInvite).filter(
            UserInvite.email == "doctor-invite-resend@example.com"
        ).order_by(UserInvite.created_at.desc()).first()
        assert first_invite is not None

        resend_resp = client.post(f"/users/invites/{first_invite.id}/resend", headers=_auth(token))
        assert resend_resp.status_code == 200
        assert "/invite#token=" in resend_resp.json()["invite_url"]

        active_list = client.get(
            "/users/invites?status_filter=active&q=doctor-invite-resend@example.com",
            headers=_auth(token),
        )
        assert active_list.status_code == 200
        assert active_list.json()["total"] == 1

        closed_list = client.get(
            "/users/invites?status_filter=closed&q=doctor-invite-resend@example.com",
            headers=_auth(token),
        )
        assert closed_list.status_code == 200
        assert closed_list.json()["total"] >= 1

    def test_list_expired_invites(self, client: TestClient, db: Session):
        _make_user(db, email="admin-invite-expired@example.com", role=UserRole.admin)
        token = _login(client, "admin-invite-expired@example.com")

        create_resp = client.post(
            "/users/invites",
            json={"email": "doctor-invite-expired@example.com", "role": "doctor"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200

        invite = db.query(UserInvite).filter(
            UserInvite.email == "doctor-invite-expired@example.com"
        ).order_by(UserInvite.created_at.desc()).first()
        assert invite is not None
        invite.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.add(invite)
        db.commit()

        expired_list = client.get(
            "/users/invites?status_filter=expired&q=doctor-invite-expired@example.com",
            headers=_auth(token),
        )
        assert expired_list.status_code == 200
        assert expired_list.json()["total"] == 1


# ──────────────────────────────────────────────────────────
# Verify Endpoint
# ──────────────────────────────────────────────────────────

class TestVerify:
    def test_admin_can_verify_user(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-ver@example.com", role=UserRole.admin)
        doc = _make_user(db, email="doc-ver@example.com", role=UserRole.doctor)
        token = _login(client, "admin-ver@example.com")
        resp = client.post(f"/users/{doc.id}/verify", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["verification_status"] == "verified"

    def test_staff_cannot_verify_user(self, client: TestClient, db: Session):
        doc = _make_user(db, email="doc-nver@example.com", role=UserRole.doctor)
        staff = _make_user(db, email="staff-nver@example.com", role=UserRole.staff)
        token = _login(client, "staff-nver@example.com")
        resp = client.post(f"/users/{doc.id}/verify", headers=_auth(token))
        assert resp.status_code == 403


# ──────────────────────────────────────────────────────────
# Audit Logging
# ──────────────────────────────────────────────────────────

class TestAuditLog:
    def test_create_user_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-aud@example.com", role=UserRole.admin)
        token = _login(client, "admin-aud@example.com")
        resp = client.post("/users", json={
            "email": "audited@example.com",
            "password": "AuditPass123",
        }, headers=_auth(token))
        assert resp.status_code == 200
        new_id = PyUUID(resp.json()["id"])

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_create",
            AuditLog.resource_id == new_id,
        ).all()
        assert len(logs) == 1
        assert logs[0].user_id == admin.id
        detail = _parse_details(logs[0].details)
        assert "after" in detail

    def test_update_user_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-audupd@example.com", role=UserRole.admin)
        target = _make_user(db, email="audupd@example.com")
        token = _login(client, "admin-audupd@example.com")
        client.put(f"/users/{target.id}", json={"first_name": "Changed"}, headers=_auth(token))

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_update",
            AuditLog.resource_id == PyUUID(str(target.id)),
        ).all()
        assert len(logs) == 1
        detail = _parse_details(logs[0].details)
        assert "before" in detail
        assert "after" in detail

    def test_delete_user_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-auddel@example.com", role=UserRole.admin)
        target = _make_user(db, email="auddel@example.com")
        token = _login(client, "admin-auddel@example.com")
        client.delete(f"/users/{target.id}", headers=_auth(token))

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_delete",
            AuditLog.resource_id == PyUUID(str(target.id)),
        ).all()
        assert len(logs) == 1

    def test_verify_user_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-audver@example.com", role=UserRole.admin)
        doc = _make_user(db, email="audver-doc@example.com", role=UserRole.doctor)
        token = _login(client, "admin-audver@example.com")
        client.post(f"/users/{doc.id}/verify", headers=_auth(token))

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_verify",
            AuditLog.resource_id == PyUUID(str(doc.id)),
        ).all()
        assert len(logs) == 1
        detail = _parse_details(logs[0].details)
        assert detail["after"] == "verified"

    def test_delete_denied_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-denied@example.com", role=UserRole.admin)
        token = _login(client, "admin-denied@example.com")

        resp = client.delete(f"/users/{admin.id}", headers=_auth(token))
        assert resp.status_code == 400

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_delete_denied",
            AuditLog.resource_id == PyUUID(str(admin.id)),
        ).all()
        assert len(logs) >= 1
        detail = _parse_details(logs[-1].details)
        assert detail["reason"] == "cannot_delete_self"

    def test_bulk_delete_logs_summary_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-bulk-aud@example.com", role=UserRole.admin)
        target = _make_user(db, email="bulk-aud-target@example.com", role=UserRole.staff)
        token = _login(client, "admin-bulk-aud@example.com")

        invalid_id = "not-a-uuid"
        resp = client.post(
            "/users/bulk-delete",
            json={"ids": [str(target.id), invalid_id]},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] == 1
        assert len(data["skipped"]) == 1

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_bulk_delete_summary",
            AuditLog.user_id == admin.id,
        ).all()
        assert len(logs) >= 1
        summary = _parse_details(logs[-1].details)
        assert summary["deleted"] == 1
        assert invalid_id in summary["requested_ids"]
        assert any("invalid ID" in item for item in summary["skipped"])

    def test_restore_user_logs_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-audrestore@example.com", role=UserRole.admin)
        target = _make_user(db, email="audrestore-target@example.com", role=UserRole.staff)
        token = _login(client, "admin-audrestore@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204

        restore_resp = client.post(f"/users/{target.id}/restore", headers=_auth(token))
        assert restore_resp.status_code == 200

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_restore",
            AuditLog.resource_id == PyUUID(str(target.id)),
        ).all()
        assert len(logs) >= 1
        detail = _parse_details(logs[-1].details)
        assert detail["after"]["deleted_at"] is None

    def test_bulk_restore_logs_summary_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-audbulkrestore@example.com", role=UserRole.admin)
        target = _make_user(db, email="audbulkrestore-target@example.com", role=UserRole.staff)
        token = _login(client, "admin-audbulkrestore@example.com")

        delete_resp = client.post(
            "/users/bulk-delete",
            json={"ids": [str(target.id)]},
            headers=_auth(token),
        )
        assert delete_resp.status_code == 200

        restore_resp = client.post(
            "/users/bulk-restore",
            json={"ids": [str(target.id)]},
            headers=_auth(token),
        )
        assert restore_resp.status_code == 200

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_bulk_restore_summary",
            AuditLog.user_id == admin.id,
        ).all()
        assert len(logs) >= 1
        detail = _parse_details(logs[-1].details)
        assert detail["restored"] == 1

    def test_purge_deleted_logs_summary_audit(self, client: TestClient, db: Session):
        admin = _make_user(db, email="admin-audpurge@example.com", role=UserRole.admin)
        target = _make_user(db, email="audpurge-target@example.com", role=UserRole.staff)
        token = _login(client, "admin-audpurge@example.com")

        delete_resp = client.delete(f"/users/{target.id}", headers=_auth(token))
        assert delete_resp.status_code == 204
        db.refresh(target)
        target.deleted_at = datetime.now(timezone.utc) - timedelta(days=120)
        db.add(target)
        db.commit()

        purge_resp = client.post(
            "/users/purge-deleted",
            json={
                "older_than_days": 90,
                "confirm_text": "PURGE",
                "reason": "Cleanup soft-deleted records after retention window",
            },
            headers=_auth(token),
        )
        assert purge_resp.status_code == 200

        logs = db.query(AuditLog).filter(
            AuditLog.action == "user_purge_deleted_summary",
            AuditLog.user_id == admin.id,
        ).all()
        assert len(logs) >= 1
        detail = _parse_details(logs[-1].details)
        assert detail["older_than_days"] == 90
        assert "retention window" in detail["reason"]
