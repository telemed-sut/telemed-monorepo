"""Tests for user management API – RBAC, CRUD, soft-delete, validation, audit."""

import json
from uuid import UUID as PyUUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole, VerificationStatus
from app.models.user import User


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────

def _make_user(db: Session, *, email: str, role: UserRole = UserRole.staff, password: str = "TestPass123") -> User:
    user = User(
        email=email,
        password_hash=get_password_hash(password),
        first_name="Test",
        last_name="User",
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
        detail = json.loads(logs[0].details)
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
        detail = json.loads(logs[0].details)
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
        detail = json.loads(logs[0].details)
        assert detail["after"] == "verified"
