from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import main as app_main
from app import middleware as app_middleware
from app.core.config import get_settings
from app.main import create_app
from app.models.audit_log import AuditLog
from app.services.auth import get_db


def test_create_app_disables_docs_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("REDIS_URL", "redis://rate-limit-cache:6379/0")
    monkeypatch.setenv("ALLOWED_HOSTS", "testserver")
    monkeypatch.setenv("DEVICE_API_REQUIRE_REGISTERED_DEVICE", "true")
    monkeypatch.setenv("DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE", "true")
    monkeypatch.setenv("DEVICE_API_REQUIRE_NONCE", "true")
    monkeypatch.setenv(
        "MEETING_SIGNING_SECRET",
        "production_meeting_signing_secret_1234567890abcdef",
    )
    monkeypatch.setenv("API_DOCS_ENABLED", "false")
    get_settings.cache_clear()

    try:
        app = create_app()
        with TestClient(app) as client:
            response = client.get("/docs", headers={"host": "testserver"})
        assert response.status_code == 404
        assert app.openapi_url is None
    finally:
        get_settings.cache_clear()


def test_create_app_enforces_allowed_hosts(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("REDIS_URL", "redis://rate-limit-cache:6379/0")
    monkeypatch.setenv("DEVICE_API_REQUIRE_REGISTERED_DEVICE", "true")
    monkeypatch.setenv("DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE", "true")
    monkeypatch.setenv("DEVICE_API_REQUIRE_NONCE", "true")
    monkeypatch.setenv(
        "MEETING_SIGNING_SECRET",
        "production_meeting_signing_secret_1234567890abcdef",
    )
    monkeypatch.setenv("ALLOWED_HOSTS", "api.example.com")
    monkeypatch.setattr(app_main, "_run_redis_healthcheck", lambda settings: "ok")
    get_settings.cache_clear()

    try:
        app = create_app()
        with TestClient(app) as client:
            allowed = client.get("/health", headers={"host": "api.example.com"})
            blocked = client.get("/health", headers={"host": "malicious.example.com"})

        assert allowed.status_code == 200
        assert blocked.status_code == 400
    finally:
        get_settings.cache_clear()


def test_create_app_sets_content_security_policy_header():
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.headers["content-security-policy"].startswith("default-src 'none';")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_ip_ban_cache_is_bounded_lru():
    app_middleware._ip_ban_cache.clear()

    max_entries = app_middleware._IP_BAN_CACHE_MAX_ENTRIES
    for index in range(max_entries):
        app_middleware._set_ip_ban_cache_entry(f"ip-{index}", float(index), float(index))

    app_middleware._get_ip_ban_cache_entry("ip-0", now=0.0)
    app_middleware._set_ip_ban_cache_entry("ip-overflow", 99_999.0, 99_999.0)

    assert len(app_middleware._ip_ban_cache) == max_entries
    assert "ip-0" in app_middleware._ip_ban_cache
    assert "ip-1" not in app_middleware._ip_ban_cache
    assert "ip-overflow" in app_middleware._ip_ban_cache

    app_middleware._ip_ban_cache.clear()


def test_middleware_db_session_uses_dependency_override():
    sentinel_session = object()
    cleanup_called = False

    def override_get_db():
        nonlocal cleanup_called
        yield sentinel_session
        cleanup_called = True

    request = SimpleNamespace(
        app=SimpleNamespace(dependency_overrides={get_db: override_get_db})
    )

    with app_middleware._get_middleware_db_session(request) as db:
        assert db is sentinel_session

    assert cleanup_called is True


def test_security_audit_middleware_sanitizes_query_string_values(db):
    audit_app = FastAPI()
    audit_app.add_middleware(app_middleware.SecurityAuditMiddleware)

    def override_get_db():
        yield db

    audit_app.dependency_overrides[get_db] = override_get_db

    @audit_app.get("/forbidden")
    async def forbidden():
        return JSONResponse(status_code=403, content={"detail": "forbidden"})

    with TestClient(audit_app) as client:
        response = client.get(
            "/forbidden?email=user@example.com&token=secret-token&next=/patients",
            headers={"user-agent": "security-audit-test-agent"},
        )

    assert response.status_code == 403

    audit_entry = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "http_403_denied")
        .order_by(AuditLog.created_at.desc())
    )

    assert audit_entry is not None
    assert audit_entry.details["query_present"] is True
    assert audit_entry.details["query_keys"] == ["email", "next", "token"]
    assert "query" not in audit_entry.details

    serialized_details = str(audit_entry.details)
    assert "user@example.com" not in serialized_details
    assert "secret-token" not in serialized_details
    assert "/patients" not in serialized_details


def test_security_audit_middleware_records_empty_query_metadata(db):
    audit_app = FastAPI()
    audit_app.add_middleware(app_middleware.SecurityAuditMiddleware)

    def override_get_db():
        yield db

    audit_app.dependency_overrides[get_db] = override_get_db

    @audit_app.get("/forbidden-no-query")
    async def forbidden():
        return JSONResponse(status_code=403, content={"detail": "forbidden"})

    with TestClient(audit_app) as client:
        response = client.get(
            "/forbidden-no-query",
            headers={"user-agent": "security-audit-test-agent"},
        )

    assert response.status_code == 403

    audit_entry = db.scalar(
        select(AuditLog)
        .where(AuditLog.action == "http_403_denied")
        .order_by(AuditLog.created_at.desc())
    )

    assert audit_entry is not None
    assert audit_entry.details["query_present"] is False
    assert audit_entry.details["query_keys"] == []
