from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.config import get_settings
from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.models.user import User
from app.services import admin_sso, admin_sso_store
from app.services.admin_sso import AdminSsoIdentity


def _make_user(db: Session, *, email: str, role: UserRole = UserRole.admin) -> User:
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


def test_admin_sso_status_disabled_by_default(client: TestClient):
    response = client.get("/auth/admin/sso/status")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "provider": None,
        "enforced_for_admin": False,
        "login_path": None,
        "logout_path": None,
    }


def test_admin_sso_health_reports_disabled_by_default(client: TestClient):
    response = client.get("/auth/admin/sso/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "disabled",
        "provider": None,
        "issuer": None,
        "details": None,
        "metadata_endpoint": None,
    }


def test_admin_sso_health_reports_healthy_when_metadata_is_reachable(client: TestClient, monkeypatch):
    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_PROVIDER_NAME", "authentik")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    monkeypatch.setattr(
        "app.services.admin_sso._fetch_metadata",
        lambda: {"authorization_endpoint": "https://auth.example.com/start"},
    )

    response = client.get("/auth/admin/sso/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "provider": "authentik",
        "issuer": "https://auth.example.com/application/o/telemed",
        "details": None,
        "metadata_endpoint": "https://auth.example.com/application/o/telemed/.well-known/openid-configuration",
    }

    get_settings.cache_clear()


def test_admin_sso_health_reports_misconfigured_when_config_is_invalid(client: TestClient, monkeypatch):
    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_PROVIDER_NAME", "authentik")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    monkeypatch.setattr(
        "app.services.admin_sso._fetch_metadata",
        lambda: (_ for _ in ()).throw(admin_sso.AdminSsoConfigurationError("ADMIN_OIDC_ISSUER_URL is required.")),
    )

    response = client.get("/auth/admin/sso/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "misconfigured",
        "provider": "authentik",
        "issuer": "https://auth.example.com/application/o/telemed",
        "details": "ADMIN_OIDC_ISSUER_URL is required.",
        "metadata_endpoint": "https://auth.example.com/application/o/telemed/.well-known/openid-configuration",
    }

    get_settings.cache_clear()


def test_admin_sso_health_reports_unreachable_when_metadata_fetch_fails(client: TestClient, monkeypatch):
    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_PROVIDER_NAME", "authentik")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    monkeypatch.setattr(
        "app.services.admin_sso._fetch_metadata",
        lambda: (_ for _ in ()).throw(RuntimeError("network down")),
    )

    response = client.get("/auth/admin/sso/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "unreachable",
        "provider": "authentik",
        "issuer": "https://auth.example.com/application/o/telemed",
        "details": "OIDC metadata endpoint is unreachable.",
        "metadata_endpoint": "https://auth.example.com/application/o/telemed/.well-known/openid-configuration",
    }

    get_settings.cache_clear()


def test_local_admin_password_login_is_denied_when_sso_is_enforced(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="sso-enforced-admin@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ENFORCED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    response = client.post(
        "/auth/login",
        json={"email": "sso-enforced-admin@example.com", "password": "TestPass123"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "admin_sso_required"

    audit = db.scalar(select(AuditLog).where(AuditLog.action == "admin_sso_login_denied"))
    assert audit is not None
    assert audit.status == "failure"

    get_settings.cache_clear()


def test_bootstrap_admin_can_still_use_local_password_when_sso_is_enforced(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ENFORCED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    monkeypatch.setenv("SUPER_ADMIN_EMAILS", "admin@example.com")
    get_settings.cache_clear()

    response = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "TestPass123"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["auth_source"] == "local"

    get_settings.cache_clear()


def test_admin_sso_login_redirect_sets_state_cookie(
    client: TestClient,
    monkeypatch,
):
    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    monkeypatch.setattr(
        "app.services.admin_sso._fetch_metadata",
        lambda: {"authorization_endpoint": "https://auth.example.com/start"},
    )

    response = client.get("/auth/admin/sso/login?next=/patients", follow_redirects=False)

    assert response.status_code == 303
    parsed = urlparse(response.headers["location"])
    query = parse_qs(parsed.query)
    assert parsed.scheme == "https"
    assert parsed.netloc == "auth.example.com"
    assert parsed.path == "/start"
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"]
    assert "admin_sso_state=" in response.headers.get("set-cookie", "")

    get_settings.cache_clear()


def test_admin_sso_callback_uses_strict_ip_limiter_key(client: TestClient):
    limits = auth_api.limiter._route_limits["app.api.auth.complete_admin_sso_login"]
    strict_limit = next(
        limit
        for limit in limits
        if str(limit.limit) == "10 per 1 minute"
        and limit.key_func is auth_api.get_strict_client_ip_rate_limit_key
    )

    assert strict_limit.limit is not None


def test_admin_sso_callback_creates_cookie_session_and_redirects(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin-sso@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    state_token = auth_api._build_admin_sso_state_token(nonce="nonce-123", next_path="/patients")
    client.cookies.set("admin_sso_state", state_token)
    admin_sso_store.store_login_artifact(
        state_token=state_token,
        nonce="nonce-123",
        code_verifier="pkce-verifier-123",
        next_path="/patients",
    )
    captured: dict[str, str] = {}
    monkeypatch.setattr(
        "app.services.admin_sso.complete_callback",
        lambda *, code, expected_nonce, code_verifier: captured.update(
            {"code": code, "expected_nonce": expected_nonce, "code_verifier": code_verifier}
        ) or AdminSsoIdentity(
            email="admin-sso@example.com",
            email_verified=True,
            auth_time=datetime.now(timezone.utc),
            amr=("pwd", "otp"),
            groups=("telemed-admins",),
            mfa_verified=True,
            id_token="id-token-hint",
            provider="authentik",
            claims={"email": "admin-sso@example.com"},
        ),
    )

    response = client.get(
        f"/auth/admin/sso/callback?code=demo-code&state={state_token}",
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000/patients"
    cookie_header = response.headers.get("set-cookie", "")
    assert "access_token=" in cookie_header
    assert f"Max-Age={auth_api.settings.admin_jwt_expires_in}" in cookie_header
    assert "admin_sso_logout_hint" not in cookie_header
    assert captured == {
        "code": "demo-code",
        "expected_nonce": "nonce-123",
        "code_verifier": "pkce-verifier-123",
    }

    audit = db.scalar(select(AuditLog).where(AuditLog.action == "admin_sso_login_success"))
    assert audit is not None
    assert audit.status == "success"

    get_settings.cache_clear()


def test_admin_sso_callback_denies_when_required_group_is_missing(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin-group@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    monkeypatch.setenv("ADMIN_OIDC_REQUIRED_GROUP", "telemed-admins")
    get_settings.cache_clear()

    state_token = auth_api._build_admin_sso_state_token(nonce="nonce-456", next_path="/patients")
    client.cookies.set("admin_sso_state", state_token)
    admin_sso_store.store_login_artifact(
        state_token=state_token,
        nonce="nonce-456",
        code_verifier="pkce-verifier-456",
        next_path="/patients",
    )
    monkeypatch.setattr(
        "app.services.admin_sso.complete_callback",
        lambda *, code, expected_nonce, code_verifier: AdminSsoIdentity(
            email="admin-group@example.com",
            email_verified=True,
            auth_time=datetime.now(timezone.utc),
            amr=("pwd", "otp"),
            groups=("other-group",),
            mfa_verified=True,
            id_token="id-token-hint",
            provider="authentik",
            claims={"email": "admin-group@example.com"},
        ),
    )

    response = client.get(
        f"/auth/admin/sso/callback?code=demo-code&state={state_token}",
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000/login?error=admin_sso_failed&reason=required_group_missing"

    audit = db.scalar(select(AuditLog).where(AuditLog.action == "admin_sso_group_denied"))
    assert audit is not None
    assert audit.status == "failure"

    get_settings.cache_clear()


def test_admin_sso_callback_denies_when_state_cookie_is_missing(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin-missing-cookie@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    state_token = auth_api._build_admin_sso_state_token(nonce="nonce-789", next_path="/patients")
    admin_sso_store.store_login_artifact(
        state_token=state_token,
        nonce="nonce-789",
        code_verifier="pkce-verifier-789",
        next_path="/patients",
    )

    response = client.get(
        f"/auth/admin/sso/callback?code=demo-code&state={state_token}",
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000/login?error=admin_sso_failed&reason=missing_state_cookie"

    audit = db.scalar(select(AuditLog).where(AuditLog.action == "admin_sso_login_denied"))
    assert audit is not None
    assert audit.details["reason"] == "missing_state_cookie"

    get_settings.cache_clear()


def test_admin_sso_callback_denies_when_state_artifact_has_expired(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin-expired-state@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    state_token = auth_api._build_admin_sso_state_token(nonce="nonce-999", next_path="/patients")
    client.cookies.set("admin_sso_state", state_token)

    response = client.get(
        f"/auth/admin/sso/callback?code=demo-code&state={state_token}",
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000/login?error=admin_sso_failed&reason=expired_sso_session"

    audit = db.scalar(select(AuditLog).where(AuditLog.action == "admin_sso_login_denied"))
    assert audit is not None
    assert audit.details["reason"] == "expired_sso_session"

    get_settings.cache_clear()


def test_admin_sso_logout_uses_server_side_logout_hint(
    client: TestClient,
    db: Session,
    monkeypatch,
):
    _make_user(db, email="admin-logout@example.com", role=UserRole.admin)

    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    login_response = auth_api.auth_service.create_login_response(
        _make_user(db, email="admin-logout-session@example.com", role=UserRole.admin),
        db=db,
        auth_source="sso",
        sso_provider="authentik",
    )
    token = login_response["access_token"]
    session_id = auth_api.decode_token(token)["session_id"]
    admin_sso_store.store_logout_hint(
        session_id=session_id,
        id_token_hint="server-side-id-token",
        ttl_seconds=3600,
    )
    client.cookies.set(auth_api.settings.auth_cookie_name, token)
    monkeypatch.setattr(
        "app.services.admin_sso.build_logout_redirect_url",
        lambda *, id_token_hint: f"https://auth.example.com/logout?id_token_hint={id_token_hint}",
    )

    response = client.get("/auth/admin/sso/logout", follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "https://auth.example.com/logout?id_token_hint=server-side-id-token"
    assert admin_sso_store.pop_logout_hint(session_id) is None

    get_settings.cache_clear()


def test_oidc_metadata_and_jwks_are_cached(monkeypatch):
    admin_sso.reset_runtime_caches()
    monkeypatch.setenv("ADMIN_OIDC_ENABLED", "true")
    monkeypatch.setenv("ADMIN_OIDC_ISSUER_URL", "https://auth.example.com/application/o/telemed")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_ID", "telemed-admin")
    monkeypatch.setenv("ADMIN_OIDC_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("ADMIN_OIDC_REDIRECT_URI", "http://localhost:3000/api/auth/admin/sso/callback")
    get_settings.cache_clear()

    calls = {"count": 0}

    class DummyResponse:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url, headers):
            calls["count"] += 1
            if url.endswith("/.well-known/openid-configuration"):
                return DummyResponse({"authorization_endpoint": "https://auth.example.com/start", "jwks_uri": "https://auth.example.com/jwks"})
            return DummyResponse({"keys": []})

    monkeypatch.setattr("app.services.admin_sso.httpx.Client", DummyClient)

    first_metadata = admin_sso._fetch_metadata()
    second_metadata = admin_sso._fetch_metadata()
    first_jwks = admin_sso._fetch_jwks("https://auth.example.com/jwks")
    second_jwks = admin_sso._fetch_jwks("https://auth.example.com/jwks")

    assert first_metadata == second_metadata
    assert first_jwks == second_jwks
    assert calls["count"] == 2

    get_settings.cache_clear()
