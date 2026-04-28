import base64
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api import passkeys as passkeys_api
from app.core.security import get_password_hash
from app.models.enums import UserRole
from app.models.user import User
from app.models.user_passkey import UserPasskey
from app.services import passkey_store


def test_passkey_store_preserves_base64url_and_metadata():
    raw_challenge = b"\xfb\xef\xff-passkey-challenge"
    expected_challenge = base64.urlsafe_b64encode(raw_challenge).rstrip(b"=").decode("ascii")

    passkey_store.store_challenge(
        "test-passkey-session",
        raw_challenge,
        origin="http://localhost:3000",
        rp_id="localhost",
        user_verification="required",
    )

    stored = passkey_store.pop_challenge("test-passkey-session")

    assert stored == {
        "challenge": expected_challenge,
        "origin": "http://localhost:3000",
        "rp_id": "localhost",
        "user_verification": "required",
    }


def test_passkey_store_requires_redis_backed_state_outside_dev(monkeypatch):
    monkeypatch.setattr(passkey_store, "_allows_local_fallback", lambda: False)
    monkeypatch.setattr(passkey_store, "get_redis_client", lambda: None)

    with pytest.raises(RuntimeError, match="passkey challenge store requires Redis-backed shared runtime state"):
        passkey_store.store_challenge("prod-like-passkey-session", b"challenge")


def test_passkey_registration_options_unauthorized(client: TestClient):
    """Verify that registration options require authentication."""
    response = client.get("/passkeys/register-options")
    assert response.status_code == 401

def test_passkey_registration_options_success(client: TestClient, db: Session):
    """Verify that an authenticated user can get registration options."""
    # Create a test user
    user = User(
        email="test_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True
    )
    db.add(user)
    db.commit()

    # Login to get token
    login_resp = client.post("/auth/login", json={
        "email": "test_passkey@example.com",
        "password": "password123"
    })
    assert login_resp.status_code == 200
    # Auth is usually via cookies in this app, check if we have access_token
    # If using cookies, TestClient handles them automatically if we use the same client instance.

    response = client.get("/passkeys/register-options")
    assert response.status_code == 200
    data = response.json()
    
    assert "challenge" in data
    assert "temp_sid" in data
    assert "user" in data
    assert data["user"]["name"] == "test_passkey@example.com"
    assert "rp" in data
    assert "pubKeyCredParams" in data

    stored = passkey_store.pop_challenge(data["temp_sid"])
    assert stored is not None
    assert stored["challenge"] == data["challenge"]
    assert stored["origin"] == "http://localhost:3000"
    assert stored["rp_id"] == data["rp"]["id"] == urlparse(stored["origin"]).hostname


def test_passkey_registration_options_include_existing_credentials(client: TestClient, db: Session):
    user = User(
        email="existing_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    existing_credential_id = base64.urlsafe_b64encode(b"existing-credential").rstrip(b"=").decode("ascii")
    db.add(
        UserPasskey(
            user_id=user.id,
            credential_id=existing_credential_id,
            public_key=b"existing-public-key",
            sign_count=3,
            name="Existing Device",
            transports=["internal", "usb"],
        )
    )
    db.commit()

    login_resp = client.post("/auth/login", json={
        "email": "existing_passkey@example.com",
        "password": "password123",
    })
    assert login_resp.status_code == 200

    response = client.get("/passkeys/register-options")
    assert response.status_code == 200
    data = response.json()

    assert data["excludeCredentials"] == [
        {
            "id": existing_credential_id,
            "type": "public-key",
            "transports": ["internal", "usb"],
        }
    ]


def test_passkey_registration_options_issue_independent_temp_sessions(
    client: TestClient,
    db: Session,
):
    user = User(
        email="repeat_register@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    login_resp = client.post("/auth/login", json={
        "email": "repeat_register@example.com",
        "password": "password123",
    })
    assert login_resp.status_code == 200

    first_response = client.get("/passkeys/register-options")
    second_response = client.get("/passkeys/register-options")

    assert first_response.status_code == 200
    assert second_response.status_code == 200

    first_data = first_response.json()
    second_data = second_response.json()

    assert first_data["temp_sid"] != second_data["temp_sid"]

    first_stored = passkey_store.pop_challenge(first_data["temp_sid"])
    second_stored = passkey_store.pop_challenge(second_data["temp_sid"])

    assert first_stored is not None
    assert second_stored is not None
    assert first_stored["challenge"] == first_data["challenge"]
    assert second_stored["challenge"] == second_data["challenge"]

def test_passkey_login_options_success(client: TestClient, db: Session):
    """Verify that anyone can get login options (with or without email)."""
    # 1. No email
    response = client.get("/passkeys/login-options")
    assert response.status_code == 200
    data = response.json()
    assert "challenge" in data
    assert "temp_sid" in data

    stored = passkey_store.pop_challenge(data["temp_sid"])
    assert stored is not None
    assert stored["challenge"] == data["challenge"]
    assert stored["origin"] == "http://localhost:3000"
    assert stored["rp_id"] == data["rpId"] == urlparse(stored["origin"]).hostname
    
    # 2. Existing email
    user = User(
        email="test_login@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True
    )
    db.add(user)
    db.commit()
    
    response = client.get("/passkeys/login-options?email=test_login@example.com")
    assert response.status_code == 200
    data = response.json()
    assert "challenge" in data
    assert "allowCredentials" in data # Should be empty as no passkeys registered yet


def test_passkey_login_options_include_registered_credentials_for_email(client: TestClient, db: Session):
    user = User(
        email="test_login_with_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    existing_credential_id = base64.urlsafe_b64encode(b"registered-login-credential").rstrip(b"=").decode("ascii")
    db.add(
        UserPasskey(
            user_id=user.id,
            credential_id=existing_credential_id,
            public_key=b"registered-public-key",
            sign_count=7,
            name="Registered Login Device",
            transports=["internal", "hybrid"],
        )
    )
    db.commit()

    response = client.get("/passkeys/login-options?email=test_login_with_passkey@example.com")
    assert response.status_code == 200
    data = response.json()
    assert data["allowCredentials"] == [
        {
            "id": existing_credential_id,
            "type": "public-key",
            "transports": ["internal", "hybrid"],
        }
    ]


def test_passkey_login_options_normalize_legacy_credential_ids(client: TestClient, db: Session):
    user = User(
        email="legacy_login_with_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    legacy_raw_id = bytes.fromhex("5a7f157f1611e11490e23f9ba2aa6cb4")
    db.add(
        UserPasskey(
            user_id=user.id,
            credential_id="\\x5a7f157f1611e11490e23f9ba2aa6cb4",
            public_key=b"legacy-public-key",
            sign_count=4,
            name="Legacy Device",
            transports=["internal", "hybrid"],
        )
    )
    db.commit()

    response = client.get("/passkeys/login-options?email=legacy_login_with_passkey@example.com")
    assert response.status_code == 200
    data = response.json()
    assert data["allowCredentials"] == [
        {
            "id": base64.urlsafe_b64encode(legacy_raw_id).rstrip(b"=").decode("ascii"),
            "type": "public-key",
            "transports": ["internal", "hybrid"],
        }
    ]


def test_passkey_registration_verify_decodes_base64url_challenge_and_persists_passkey(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    user = User(
        email="verify_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    login_resp = client.post("/auth/login", json={
        "email": "verify_passkey@example.com",
        "password": "password123",
    })
    assert login_resp.status_code == 200

    raw_challenge = b"register-challenge-123"
    passkey_store.store_challenge(
        "temp-register-session",
        raw_challenge,
        origin="http://localhost:3000",
        rp_id="localhost",
        user_verification="required",
    )

    captured: dict[str, object] = {}

    def fake_verify_registration_response(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            credential_id="cred-reg-123",
            credential_public_key=b"public-key-bytes",
            sign_count=11,
        )

    monkeypatch.setattr(
        passkeys_api,
        "verify_registration_response",
        fake_verify_registration_response,
    )

    csrf_token = client.cookies.get("csrf_token")
    response = client.post(
        "/passkeys/register-verify?temp_sid=temp-register-session",
        json={
            "name": "MacBook Passkey",
            "registration_response": {
                "id": "cred-reg-123",
                "rawId": "cred-reg-123",
                "type": "public-key",
                "response": {
                    "attestationObject": "attestation-object",
                    "clientDataJSON": "client-data-json",
                    "transports": ["internal"],
                },
                "clientExtensionResults": {},
            },
        },
        headers={"x-csrf-token": csrf_token} if csrf_token else {},
    )

    assert response.status_code == 201
    assert captured["expected_challenge"] == raw_challenge
    assert captured["expected_origin"] == "http://localhost:3000"
    assert captured["expected_rp_id"] == "localhost"
    assert captured["require_user_verification"] is True

    created_passkey = db.query(UserPasskey).filter(UserPasskey.credential_id == "cred-reg-123").one()
    assert created_passkey.user_id == user.id
    assert created_passkey.public_key == b"public-key-bytes"
    assert created_passkey.sign_count == 11
    assert created_passkey.transports == ["internal"]


def test_passkey_login_verify_decodes_base64url_challenge_and_updates_sign_count(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    user = User(
        email="login_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    passkey = UserPasskey(
        user_id=user.id,
        credential_id="cred-auth-123",
        public_key=b"stored-public-key",
        sign_count=5,
        name="Clinic Mac",
        transports=["internal"],
    )
    db.add(passkey)
    db.commit()

    raw_challenge = b"login-challenge-456"
    passkey_store.store_challenge(
        "temp-login-session",
        raw_challenge,
        origin="http://localhost:3000",
        rp_id="localhost",
        user_verification="required",
    )

    captured: dict[str, object] = {}

    def fake_verify_authentication_response(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(new_sign_count=9)

    def fake_create_login_response(*args, **kwargs):
        return {
            "access_token": "test-access-token",
            "expires_in": 3600,
            "user": {"id": str(user.id), "email": user.email},
        }

    monkeypatch.setattr(
        passkeys_api,
        "verify_authentication_response",
        fake_verify_authentication_response,
    )
    monkeypatch.setattr(
        passkeys_api.auth_service,
        "create_login_response",
        fake_create_login_response,
    )

    response = client.post(
        "/passkeys/login-verify?temp_sid=temp-login-session",
        json={
            "authentication_response": {
                "id": "cred-auth-123",
                "rawId": "cred-auth-123",
                "type": "public-key",
                "response": {
                    "authenticatorData": "authenticator-data",
                    "clientDataJSON": "client-data-json",
                    "signature": "assertion-signature",
                },
                "clientExtensionResults": {},
            },
        },
    )

    assert response.status_code == 200
    assert captured["expected_challenge"] == raw_challenge
    assert captured["expected_origin"] == "http://localhost:3000"
    assert captured["expected_rp_id"] == "localhost"
    assert captured["credential_public_key"] == b"stored-public-key"
    assert captured["credential_current_sign_count"] == 5
    assert captured["require_user_verification"] is True

    db.refresh(passkey)
    assert passkey.sign_count == 9
    assert passkey.last_used_at is not None
    assert response.cookies.get("access_token")
    assert response.cookies.get("csrf_token")


def test_passkey_login_verify_matches_legacy_credential_id_and_migrates_to_canonical(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    user = User(
        email="legacy_login_passkey@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.doctor,
        is_active=True,
    )
    db.add(user)
    db.commit()

    raw_credential_id = bytes.fromhex("5a7f157f1611e11490e23f9ba2aa6cb4")
    canonical_credential_id = base64.urlsafe_b64encode(raw_credential_id).rstrip(b"=").decode("ascii")

    passkey = UserPasskey(
        user_id=user.id,
        credential_id="\\x5a7f157f1611e11490e23f9ba2aa6cb4",
        public_key=b"legacy-stored-public-key",
        sign_count=2,
        name="Legacy Login Device",
        transports=["internal"],
    )
    db.add(passkey)
    db.commit()

    raw_challenge = b"legacy-login-challenge"
    passkey_store.store_challenge(
        "temp-legacy-login-session",
        raw_challenge,
        origin="http://localhost:3000",
        rp_id="localhost",
        user_verification="required",
    )

    captured: dict[str, object] = {}

    def fake_verify_authentication_response(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(new_sign_count=6)

    def fake_create_login_response(*args, **kwargs):
        return {
            "access_token": "legacy-access-token",
            "expires_in": 3600,
            "user": {"id": str(user.id), "email": user.email},
        }

    monkeypatch.setattr(
        passkeys_api,
        "verify_authentication_response",
        fake_verify_authentication_response,
    )
    monkeypatch.setattr(
        passkeys_api.auth_service,
        "create_login_response",
        fake_create_login_response,
    )

    response = client.post(
        "/passkeys/login-verify?temp_sid=temp-legacy-login-session",
        json={
            "authentication_response": {
                "id": canonical_credential_id,
                "rawId": canonical_credential_id,
                "type": "public-key",
                "response": {
                    "authenticatorData": "legacy-authenticator-data",
                    "clientDataJSON": "legacy-client-data-json",
                    "signature": "legacy-assertion-signature",
                },
                "clientExtensionResults": {},
            },
        },
    )

    assert response.status_code == 200
    assert captured["credential_current_sign_count"] == 2

    db.refresh(passkey)
    assert passkey.credential_id == canonical_credential_id
    assert passkey.sign_count == 6

def test_onboarding_dismiss(client: TestClient, db: Session):
    """Verify that onboarding can be dismissed."""
    user = User(
        email="test_onboard@example.com",
        password_hash=get_password_hash("password123"),
        role=UserRole.admin,
        is_active=True
    )
    db.add(user)
    db.commit()

    client.post("/auth/login", json={
        "email": "test_onboard@example.com",
        "password": "password123"
    })

    csrf_token = client.cookies.get("csrf_token")
    response = client.post(
        "/passkeys/onboarding/dismiss",
        headers={"x-csrf-token": csrf_token} if csrf_token else {},
    )
    assert response.status_code == 200
    
    db.refresh(user)
    assert user.passkey_onboarding_dismissed is True
    assert user.last_onboarding_prompt_at is not None
