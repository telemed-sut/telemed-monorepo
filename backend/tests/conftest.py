import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import MutableMapping

# Load .env.test before any app imports
from dotenv import dotenv_values, load_dotenv
_project_root = Path(__file__).resolve().parent.parent
_TEST_ENV_PATH = _project_root / ".env.test"
_ENFORCED_TEST_ENV_KEYS = {
    "ADMIN_2FA_REQUIRED",
    "ADMIN_JWT_EXPIRES_IN",
    "ADMIN_UNLOCK_WHITELISTED_IPS",
    "ALLOW_INSECURE_SECRET_STORAGE",
    "APP_ENV",
    "AUTH_COOKIE_SECURE",
    "DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE",
    "DEVICE_API_REQUIRE_NONCE",
    "DEVICE_API_REQUIRE_REGISTERED_DEVICE",
    "DEVICE_API_SECRET",
    "DEVICE_SECRET_ENCRYPTION_KEY",
    "JWT_EXPIRES_IN",
    "JWT_SECRET",
    "MEETING_SIGNING_SECRET",
    "PASSWORD_RESET_EXPIRES_IN",
    "PRIVILEGED_ACTION_MFA_MAX_AGE_SECONDS",
    "SUPER_ADMIN_EMAILS",
    "TRUSTED_PROXY_IPS",
    "TWO_FACTOR_SECRET_ENCRYPTION_KEY",
}


def _load_enforced_test_environment(
    *,
    env_path: Path,
    environ: MutableMapping[str, str] | None = None,
) -> dict[str, str]:
    target_env = os.environ if environ is None else environ
    values = {
        key: value
        for key, value in dotenv_values(env_path).items()
        if value is not None
    }

    missing_keys = sorted(
        key
        for key in _ENFORCED_TEST_ENV_KEYS
        if key != "APP_ENV" and key not in values
    )
    if missing_keys:
        raise RuntimeError(
            ".env.test is missing required security test settings: "
            + ", ".join(missing_keys)
        )

    target_env["APP_ENV"] = "test"
    for key in sorted(_ENFORCED_TEST_ENV_KEYS - {"APP_ENV"}):
        target_env[key] = values[key]

    return values


_load_enforced_test_environment(env_path=_TEST_ENV_PATH)
load_dotenv(_TEST_ENV_PATH, override=False)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure required secrets are available in test environment.
os.environ.setdefault("DEVICE_API_SECRET", "test_device_secret_1234567890abcdef1234567890abcdef")
os.environ.setdefault(
    "DEVICE_SECRET_ENCRYPTION_KEY",
    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
)
os.environ.setdefault(
    "TWO_FACTOR_SECRET_ENCRYPTION_KEY",
    "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=",
)
os.environ.setdefault("ALLOW_INSECURE_SECRET_STORAGE", "false")
os.environ.setdefault(
    "MEETING_SIGNING_SECRET",
    "test_meeting_signing_secret_1234567890abcdef1234567890abcd",
)
# Most tests assume plain admin login unless they explicitly opt into MFA.
os.environ["ADMIN_2FA_REQUIRED"] = "false"
os.environ.setdefault("DEVICE_API_REQUIRE_REGISTERED_DEVICE", "false")
os.environ.setdefault("DEVICE_API_REQUIRE_BODY_HASH_SIGNATURE", "false")
os.environ.setdefault("DEVICE_API_REQUIRE_NONCE", "false")
os.environ.setdefault("ADMIN_UNLOCK_WHITELISTED_IPS", "127.0.0.1,::1,testclient")
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine as app_engine
from app.main import app
from app.api import pressure as pressure_api
from app.services.auth import get_db
from app.services import admin_sso, admin_sso_store, passkey_store
from app.services import heart_sound_upload_sessions as heart_sound_upload_session_service
from app.services import redis_runtime as redis_runtime_service

# Disable rate limiting during tests
app.state.limiter.enabled = False

# Allow PostgreSQL JSONB and UUID columns to compile under SQLite test database.
from sqlalchemy.dialects.postgresql import UUID

@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(_type, _compiler, **_kw):
    return "VARCHAR"

@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(_type, _compiler, **_kw):
    return "JSON"

@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(_type, _compiler, **_kw):
    return "JSON"

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite:///:memory:")
IS_SQLITE = TEST_DATABASE_URL.startswith("sqlite")
RUN_TEST_MIGRATIONS = os.getenv("RUN_TEST_MIGRATIONS", "false").lower() in {"1", "true", "yes"}

if IS_SQLITE:
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
else:
    engine = create_engine(
        TEST_DATABASE_URL,
        pool_pre_ping=True,
        future=True,
        echo=False,
    )

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="session", autouse=True)
def apply_test_migrations():
    """Optional: apply Alembic migrations for PostgreSQL test runs."""
    if IS_SQLITE or not RUN_TEST_MIGRATIONS:
        yield
        return

    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")
    # Keep Postgres test schema aligned with ORM metadata even when a migration
    # lags behind a newly added table used by the test suite.
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(scope="function", autouse=True)
def setup_database():
    """Create tables for each test"""
    if IS_SQLITE or not RUN_TEST_MIGRATIONS:
        Base.metadata.create_all(bind=engine)
        yield
        Base.metadata.drop_all(bind=engine)
        return

    _truncate_all_tables()
    yield
    _truncate_all_tables()


@pytest.fixture(scope="function", autouse=True)
def reset_admin_sso_runtime_state():
    admin_sso.reset_runtime_caches()
    admin_sso_store.reset_runtime_state()
    passkey_store.reset_runtime_state()
    heart_sound_upload_session_service.reset_runtime_state()
    redis_runtime_service.reset_runtime_diagnostics()
    yield
    admin_sso.reset_runtime_caches()
    admin_sso_store.reset_runtime_state()
    passkey_store.reset_runtime_state()
    heart_sound_upload_session_service.reset_runtime_state()
    redis_runtime_service.reset_runtime_diagnostics()


@pytest.fixture(scope="function", autouse=True)
def reset_device_api_runtime_settings():
    original_secret = pressure_api.settings.device_api_secret
    original_secret_map = dict(pressure_api.settings.device_api_secrets)
    original_require_registered = pressure_api.settings.device_api_require_registered_device
    original_require_body_hash = pressure_api.settings.device_api_require_body_hash_signature
    original_require_nonce = pressure_api.settings.device_api_require_nonce

    yield

    pressure_api.settings.device_api_secret = original_secret
    pressure_api.settings.device_api_secrets = original_secret_map
    pressure_api.settings.device_api_require_registered_device = original_require_registered
    pressure_api.settings.device_api_require_body_hash_signature = original_require_body_hash
    pressure_api.settings.device_api_require_nonce = original_require_nonce


@pytest.fixture
def db():
    """Get database session for tests"""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def test_settings():
    return get_settings()


def _truncate_all_tables():
    app_engine.dispose()
    engine.dispose()
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names(schema="public") or inspector.get_table_names())
    table_names = [
        table.name
        for table in reversed(Base.metadata.sorted_tables)
        if table.schema in (None, "public") and table.name in existing_tables
    ]
    if not table_names:
        return

    joined_tables = ", ".join(f'"{name}"' for name in table_names)
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE {joined_tables} RESTART IDENTITY CASCADE"))


class FakeRedisConnectionPool:
    created_pools = []

    def __init__(self, url: str, **kwargs):
        self.url = url
        self.kwargs = kwargs
        self.disconnected = False
        type(self).created_pools.append(self)

    @classmethod
    def from_url(cls, url: str, **kwargs):
        return cls(url, **kwargs)

    def disconnect(self):
        self.disconnected = True


class FakeRedisClient:
    created_clients = []

    def __init__(self, connection_pool=None, **kwargs):
        self.connection_pool = connection_pool
        self.kwargs = kwargs
        type(self).created_clients.append(self)

    @classmethod
    def from_url(cls, url: str, **kwargs):
        pool = FakeRedisConnectionPool.from_url(url, **kwargs)
        return cls(connection_pool=pool, **kwargs)


@pytest.fixture
def mock_redis_module(monkeypatch):
    FakeRedisConnectionPool.created_pools.clear()
    FakeRedisClient.created_clients.clear()
    module = SimpleNamespace(
        ConnectionPool=FakeRedisConnectionPool,
        Redis=FakeRedisClient,
        connection=SimpleNamespace(ConnectionPool=FakeRedisConnectionPool),
    )
    monkeypatch.setitem(sys.modules, "redis", module)
    return module
