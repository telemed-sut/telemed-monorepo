import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure required secrets are available in test environment.
os.environ.setdefault("DEVICE_API_SECRET", "test_device_secret_1234567890abcdef1234567890abcdef")
os.environ.setdefault("ADMIN_2FA_REQUIRED", "false")

from app.core.config import get_settings
from app.db.base import Base
from app.main import app
from app.services.auth import get_db

# Allow PostgreSQL JSONB columns to compile under SQLite test database.
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
    yield


@pytest.fixture(scope="function", autouse=True)
def setup_database():
    """Create tables for each test"""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


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
