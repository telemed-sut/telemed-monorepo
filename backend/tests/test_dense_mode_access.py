"""Tests for dense-mode access control with assignment-only doctor/admin policy."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.alert import Alert
from app.models.audit_log import AuditLog
from app.models.doctor_patient_assignment import DoctorPatientAssignment
from app.models.enums import AlertCategory, AlertSeverity, UserRole
from app.models.patient import Patient
from app.models.user import User


def _create_user(db: Session, email: str, role: UserRole) -> User:
    user = User(
        email=email,
        first_name="Test",
        last_name="User",
        password_hash=get_password_hash("TestPass123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_patient(db: Session) -> Patient:
    patient = Patient(
        first_name="John",
        last_name="Doe",
        date_of_birth=date(1990, 1, 1),
        gender="male",
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


def _assign_doctor(db: Session, doctor_id, patient_id, role: str = "primary") -> DoctorPatientAssignment:
    assignment = DoctorPatientAssignment(
        doctor_id=doctor_id,
        patient_id=patient_id,
        role=role,
    )
    db.add(assignment)
    db.commit()
    return assignment


def _create_alert(db: Session, patient_id) -> Alert:
    alert = Alert(
        patient_id=patient_id,
        severity=AlertSeverity.warning,
        category=AlertCategory.vital_sign,
        title="High blood pressure",
        message="BP 180/120",
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


def _login(client: TestClient, email: str) -> str:
    resp = client.post("/auth/login", json={"email": email, "password": "TestPass123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAssignmentGate:
    def test_assigned_doctor_can_access_summary(self, client: TestClient, db: Session):
        doctor = _create_user(db, "doc@test.com", UserRole.doctor)
        patient = _create_patient(db)
        _assign_doctor(db, doctor.id, patient.id)

        token = _login(client, "doc@test.com")
        resp = client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))
        assert resp.status_code == 200

    def test_unassigned_doctor_is_blocked(self, client: TestClient, db: Session):
        doctor = _create_user(db, "doc2@test.com", UserRole.doctor)
        patient = _create_patient(db)

        token = _login(client, "doc2@test.com")
        resp = client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))
        assert resp.status_code == 403
        assert "not assigned" in resp.json()["detail"].lower()

    def test_admin_bypasses_assignment_check(self, client: TestClient, db: Session):
        admin = _create_user(db, "admin@test.com", UserRole.admin)
        patient = _create_patient(db)

        token = _login(client, "admin@test.com")
        resp = client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))
        assert resp.status_code == 200

    def test_staff_blocked_from_clinical_data(self, client: TestClient, db: Session):
        staff = _create_user(db, "staff@test.com", UserRole.staff)
        patient = _create_patient(db)

        token = _login(client, "staff@test.com")
        resp = client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))
        assert resp.status_code == 403

    def test_non_doctor_clinical_roles_are_blocked(self, client: TestClient, db: Session):
        nurse = _create_user(db, "nurse@test.com", UserRole.nurse)
        patient = _create_patient(db)
        _assign_doctor(db, nurse.id, patient.id)

        token = _login(client, "nurse@test.com")
        resp = client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))
        assert resp.status_code == 403

    def test_unassigned_doctor_blocked_on_timeline_orders_and_trends(self, client: TestClient, db: Session):
        doctor = _create_user(db, "doc3@test.com", UserRole.doctor)
        patient = _create_patient(db)

        token = _login(client, "doc3@test.com")
        headers = _auth_headers(token)

        timeline_resp = client.get(f"/patients/{patient.id}/timeline", headers=headers)
        assert timeline_resp.status_code == 403

        orders_resp = client.get(f"/patients/{patient.id}/active-orders", headers=headers)
        assert orders_resp.status_code == 403

        trends_resp = client.get(f"/patients/{patient.id}/results/trends", headers=headers)
        assert trends_resp.status_code == 403


class TestBreakGlassDisabled:
    def test_break_glass_returns_403_by_policy(self, client: TestClient, db: Session):
        doctor = _create_user(db, "bg-doc@test.com", UserRole.doctor)
        patient = _create_patient(db)

        token = _login(client, "bg-doc@test.com")
        resp = client.post(
            f"/patients/{patient.id}/break-glass",
            json={"reason": "Emergency transfer"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 403
        assert "disabled by policy" in resp.json()["detail"].lower()

    def test_break_glass_does_not_write_audit_when_disabled(self, client: TestClient, db: Session):
        doctor = _create_user(db, "bg-doc2@test.com", UserRole.doctor)
        patient = _create_patient(db)

        token = _login(client, "bg-doc2@test.com")
        client.post(
            f"/patients/{patient.id}/break-glass",
            json={"reason": "Emergency code blue"},
            headers=_auth_headers(token),
        )

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.user_id == doctor.id,
                AuditLog.action == "break_glass",
            )
        )
        assert audit is None


class TestAlertAcknowledge:
    def test_assigned_doctor_can_acknowledge(self, client: TestClient, db: Session):
        doctor = _create_user(db, "ack-doc@test.com", UserRole.doctor)
        patient = _create_patient(db)
        _assign_doctor(db, doctor.id, patient.id)
        alert = _create_alert(db, patient.id)

        token = _login(client, "ack-doc@test.com")
        resp = client.post(
            f"/alerts/{alert.id}/acknowledge",
            json={"reason": "Noted and acting on it"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200

    def test_unassigned_doctor_cannot_acknowledge(self, client: TestClient, db: Session):
        doctor = _create_user(db, "ack-doc2@test.com", UserRole.doctor)
        patient = _create_patient(db)
        alert = _create_alert(db, patient.id)

        token = _login(client, "ack-doc2@test.com")
        resp = client.post(
            f"/alerts/{alert.id}/acknowledge",
            json={"reason": "Trying to ack"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 403

    def test_admin_can_acknowledge_any_alert(self, client: TestClient, db: Session):
        admin = _create_user(db, "ack-admin@test.com", UserRole.admin)
        patient = _create_patient(db)
        alert = _create_alert(db, patient.id)

        token = _login(client, "ack-admin@test.com")
        resp = client.post(
            f"/alerts/{alert.id}/acknowledge",
            json={"reason": "Admin override"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200

    def test_staff_cannot_acknowledge_alert(self, client: TestClient, db: Session):
        staff = _create_user(db, "ack-staff@test.com", UserRole.staff)
        patient = _create_patient(db)
        alert = _create_alert(db, patient.id)

        token = _login(client, "ack-staff@test.com")
        resp = client.post(
            f"/alerts/{alert.id}/acknowledge",
            json={"reason": "No permission"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 403


class TestAuditLogging:
    def test_summary_access_is_audited(self, client: TestClient, db: Session):
        admin = _create_user(db, "audit-admin@test.com", UserRole.admin)
        patient = _create_patient(db)

        token = _login(client, "audit-admin@test.com")
        client.get(f"/patients/{patient.id}/summary", headers=_auth_headers(token))

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.user_id == admin.id,
                AuditLog.action == "view_patient_summary",
            )
        )
        assert audit is not None
        assert audit.resource_id == patient.id

    def test_timeline_access_is_audited(self, client: TestClient, db: Session):
        admin = _create_user(db, "audit-admin2@test.com", UserRole.admin)
        patient = _create_patient(db)

        token = _login(client, "audit-admin2@test.com")
        client.get(f"/patients/{patient.id}/timeline", headers=_auth_headers(token))

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.user_id == admin.id,
                AuditLog.action == "view_patient_timeline",
            )
        )
        assert audit is not None

    def test_active_orders_access_is_audited(self, client: TestClient, db: Session):
        admin = _create_user(db, "audit-admin3@test.com", UserRole.admin)
        patient = _create_patient(db)

        token = _login(client, "audit-admin3@test.com")
        client.get(f"/patients/{patient.id}/active-orders", headers=_auth_headers(token))

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.user_id == admin.id,
                AuditLog.action == "view_active_orders",
            )
        )
        assert audit is not None

    def test_lab_trends_access_is_audited(self, client: TestClient, db: Session):
        admin = _create_user(db, "audit-admin4@test.com", UserRole.admin)
        patient = _create_patient(db)

        token = _login(client, "audit-admin4@test.com")
        client.get(f"/patients/{patient.id}/results/trends", headers=_auth_headers(token))

        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.user_id == admin.id,
                AuditLog.action == "view_lab_trends",
            )
        )
        assert audit is not None
