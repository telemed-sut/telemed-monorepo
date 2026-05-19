from datetime import datetime, timedelta, timezone
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


def test_create_app_sets_content_security_policy_header(monkeypatch):
    monkeypatch.setattr(app_main, "_run_database_healthcheck", lambda: "ok")
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.headers["content-security-policy"].startswith("default-src 'none';")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_ip_ban_middleware_uses_shared_security_runtime_state(monkeypatch):
    ip_ban_app = FastAPI()
    ip_ban_app.add_middleware(app_middleware.IPBanMiddleware)

    @ip_ban_app.get("/health")
    async def health():
        return {"status": "ok"}

    monkeypatch.setattr(app_middleware, "_get_client_ip", lambda request: "8.8.8.8")
    monkeypatch.setattr(app_middleware.security_service, "is_ip_whitelisted", lambda ip: False)
    monkeypatch.setattr(
        app_middleware.security_service,
        "check_ip_banned",
        lambda db, ip: SimpleNamespace(
            ip_address=ip,
            banned_until=datetime.now(timezone.utc) + timedelta(minutes=5),
        ),
    )

    with TestClient(ip_ban_app) as client:
        response = client.get("/health")

    assert response.status_code == 403
    assert response.json()["detail"] == "Access denied. Your IP has been temporarily blocked."


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
