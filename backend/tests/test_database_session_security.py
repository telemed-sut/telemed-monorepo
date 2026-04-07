from types import SimpleNamespace

import app.db.session as session_module


def test_remote_database_url_requires_sslmode():
    try:
        session_module._require_sslmode_for_remote_database_url(
            "postgresql+psycopg://user:password@db.internal:5432/patient_db"
        )
    except ValueError as exc:
        assert "sslmode" in str(exc)
    else:
        raise AssertionError("Expected remote database URL without sslmode to be rejected.")


def test_local_database_url_allows_missing_sslmode():
    session_module._require_sslmode_for_remote_database_url(
        "postgresql+psycopg://user:password@localhost:5432/patient_db"
    )
    session_module._require_sslmode_for_remote_database_url(
        "postgresql+psycopg://user:password@127.0.0.1:5432/patient_db"
    )
    session_module._require_sslmode_for_remote_database_url(
        "postgresql+psycopg://user:password@[::1]:5432/patient_db"
    )


def test_remote_database_url_allows_explicit_sslmode():
    session_module._require_sslmode_for_remote_database_url(
        "postgresql+psycopg://user:password@db.internal:5432/patient_db?sslmode=require"
    )


def test_remote_database_url_rejects_whitespace_only_sslmode():
    try:
        session_module._require_sslmode_for_remote_database_url(
            "postgresql+psycopg://user:password@db.internal:5432/patient_db?sslmode=%20%20"
        )
    except ValueError as exc:
        assert "sslmode" in str(exc)
    else:
        raise AssertionError("Expected whitespace-only sslmode to be rejected.")


def test_remote_database_url_rejects_non_string_sslmode(monkeypatch):
    fake_url = SimpleNamespace(host="db.internal", query={"sslmode": 123})
    monkeypatch.setattr(session_module, "make_url", lambda _database_url: fake_url)

    try:
        session_module._require_sslmode_for_remote_database_url(
            "postgresql+psycopg://user:password@db.internal:5432/patient_db?sslmode=require"
        )
    except ValueError as exc:
        assert "sslmode" in str(exc)
    else:
        raise AssertionError("Expected non-string sslmode to be rejected.")
