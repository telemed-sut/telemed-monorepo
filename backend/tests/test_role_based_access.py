from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.services.auth import create_login_response


def create_test_user(db: Session, email: str, role: UserRole = UserRole.staff) -> User:
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


def test_staff_cannot_access_patient_crud_endpoints(client: TestClient, db: Session):
    admin_user = create_test_user(db, "admin2@test.com", UserRole.admin)
    staff_user = create_test_user(db, "staff@test.com", UserRole.staff)

    admin_headers = get_auth_headers(admin_user)
    staff_headers = get_auth_headers(staff_user)

    patient_id = _create_patient_as_admin(client, admin_headers)

    create_response = client.post(
        "/patients",
        json={
            "first_name": "No",
            "last_name": "Access",
            "date_of_birth": "1995-02-01",
        },
        headers=staff_headers,
    )
    assert create_response.status_code == 403

    get_response = client.get(f"/patients/{patient_id}", headers=staff_headers)
    assert get_response.status_code == 403

    list_response = client.get("/patients", headers=staff_headers)
    assert list_response.status_code == 403

    update_response = client.put(
        f"/patients/{patient_id}",
        json={"first_name": "Blocked"},
        headers=staff_headers,
    )
    assert update_response.status_code == 403

    delete_response = client.delete(f"/patients/{patient_id}", headers=staff_headers)
    assert delete_response.status_code == 403


def test_role_requirements_in_jwt(client: TestClient, db: Session):
    admin_user = create_test_user(db, "jwtadmin@test.com", UserRole.admin)
    staff_user = create_test_user(db, "jwtstaff@test.com", UserRole.staff)

    admin_login = client.post(
        "/auth/login",
        json={"email": "jwtadmin@test.com", "password": "TestPassword123"},
    )
    assert admin_login.status_code == 200

    staff_login = client.post(
        "/auth/login",
        json={"email": "jwtstaff@test.com", "password": "TestPassword123"},
    )
    assert staff_login.status_code == 200

    admin_token = admin_login.json()["access_token"]
    staff_token = staff_login.json()["access_token"]

    assert admin_token != staff_token
    assert len(admin_token) > 0
    assert len(staff_token) > 0
