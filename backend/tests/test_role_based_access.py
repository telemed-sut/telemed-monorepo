from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.services.auth import create_login_response


def create_test_user(db: Session, email: str, role: UserRole = UserRole.medical_student) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash("TestPassword123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_auth_headers(user: User) -> dict:
    token_response = create_login_response(user)
    return {"Authorization": f"Bearer {token_response['access_token']}"}


def _create_patient_as_admin(client: TestClient, headers: dict) -> str:
    response = client.post(
        "/patients",
        json={
            "first_name": "Access",
            "last_name": "Policy",
            "date_of_birth": "1990-01-01",
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_admin_can_delete_patient(client: TestClient, db: Session):
    admin_user = create_test_user(db, "admin@test.com", UserRole.admin)
    admin_headers = get_auth_headers(admin_user)

    patient_id = _create_patient_as_admin(client, admin_headers)

    delete_response = client.delete(f"/patients/{patient_id}", headers=admin_headers)
    assert delete_response.status_code == 204


def test_medical_student_has_read_only_patient_access(client: TestClient, db: Session):
    admin_user = create_test_user(db, "admin2@test.com", UserRole.admin)
    medical_student_user = create_test_user(db, "medical-student@test.com", UserRole.medical_student)

    admin_headers = get_auth_headers(admin_user)
    medical_student_headers = get_auth_headers(medical_student_user)

    patient_id = _create_patient_as_admin(client, admin_headers)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "No",
            "last_name": "Access",
            "date_of_birth": "1995-02-01",
        },
        headers=medical_student_headers,
    )
    assert create_response.status_code == 403

    get_response = client.get(f"/patients/{patient_id}", headers=medical_student_headers)
    assert get_response.status_code == 403

    list_response = client.get("/patients", headers=medical_student_headers)
    assert list_response.status_code == 200
    assert list_response.json()["total"] == 0

    update_response = client.put(
        f"/patients/{patient_id}",
        json={"first_name": "Blocked"},
        headers=medical_student_headers,
    )
    assert update_response.status_code == 403

    delete_response = client.delete(f"/patients/{patient_id}", headers=medical_student_headers)
    assert delete_response.status_code == 403


def test_role_requirements_in_jwt(client: TestClient, db: Session):
    admin_user = create_test_user(db, "jwtadmin@test.com", UserRole.admin)
    medical_student_user = create_test_user(db, "jwt-medical-student@test.com", UserRole.medical_student)

    admin_login = client.post(
        "/auth/login",
        json={"email": "jwtadmin@test.com", "password": "TestPassword123"},
    )
    assert admin_login.status_code == 200

    medical_student_login = client.post(
        "/auth/login",
        json={"email": "jwt-medical-student@test.com", "password": "TestPassword123"},
    )
    assert medical_student_login.status_code == 200

    admin_token = admin_login.json()["access_token"]
    medical_student_token = medical_student_login.json()["access_token"]

    assert admin_token != medical_student_token
    assert len(admin_token) > 0
    assert len(medical_student_token) > 0


def test_admin_only_endpoints_block_doctor_and_medical_student(client: TestClient, db: Session):
    admin_user = create_test_user(db, "admin-guard@test.com", UserRole.admin)
    doctor_user = create_test_user(db, "doctor-guard@test.com", UserRole.doctor)
    medical_student_user = create_test_user(db, "medical-student-guard@test.com", UserRole.medical_student)

    admin_headers = get_auth_headers(admin_user)
    doctor_headers = get_auth_headers(doctor_user)
    medical_student_headers = get_auth_headers(medical_student_user)

    invite_resp = client.post(
        "/users/invites",
        json={"email": "rbac-doctor-invite@example.com", "role": "doctor"},
        headers=admin_headers,
    )
    assert invite_resp.status_code == 200

    admin_paths = [
        ("/users", "GET"),
        ("/users/invites", "GET"),
        ("/audit/logs", "GET"),
        ("/security/stats", "GET"),
    ]

    for path, method in admin_paths:
        doctor_resp = client.request(method, path, headers=doctor_headers)
        medical_student_resp = client.request(method, path, headers=medical_student_headers)
        assert doctor_resp.status_code == 403, f"doctor should be blocked on {path}"
        assert medical_student_resp.status_code == 403, f"medical_student should be blocked on {path}"


def test_meeting_and_stats_access_matrix(client: TestClient, db: Session):
    admin_user = create_test_user(db, "admin-matrix@test.com", UserRole.admin)
    doctor_user = create_test_user(db, "doctor-matrix@test.com", UserRole.doctor)
    medical_student_user = create_test_user(db, "medical-student-matrix@test.com", UserRole.medical_student)

    admin_headers = get_auth_headers(admin_user)
    doctor_headers = get_auth_headers(doctor_user)
    medical_student_headers = get_auth_headers(medical_student_user)

    admin_meetings = client.get("/meetings", headers=admin_headers)
    doctor_meetings = client.get("/meetings", headers=doctor_headers)
    medical_student_meetings = client.get("/meetings", headers=medical_student_headers)
    assert admin_meetings.status_code == 200
    assert doctor_meetings.status_code == 200
    assert medical_student_meetings.status_code == 200

    admin_stats = client.get("/stats/overview", headers=admin_headers)
    doctor_stats = client.get("/stats/overview", headers=doctor_headers)
    medical_student_stats = client.get("/stats/overview", headers=medical_student_headers)
    assert admin_stats.status_code == 200
    assert doctor_stats.status_code == 200
    assert medical_student_stats.status_code == 200
