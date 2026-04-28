import importlib.util
from pathlib import Path

import pytest


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260215_0007_seed_admin_doctor_users.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("seed_admin_doctor_users", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_seed_migration_requires_seed_password_env_vars(monkeypatch):
    module = _load_migration_module()
    monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("SEED_DOCTOR_PASSWORD", raising=False)

    with pytest.raises(ValueError, match="SEED_ADMIN_PASSWORD must be set"):
        module.upgrade()


def test_seed_migration_reads_passwords_from_environment(monkeypatch):
    module = _load_migration_module()
    inserted_rows = []

    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "AdminSeedFromEnv123!")
    monkeypatch.setenv("SEED_DOCTOR_PASSWORD", "DoctorSeedFromEnv123!")
    monkeypatch.setattr(
        module.op,
        "bulk_insert",
        lambda _table, rows: inserted_rows.extend(rows),
    )

    module.upgrade()

    assert [row["email"] for row in inserted_rows] == [
        "admin@emedhelp.example.com",
        "doctor@emedhelp.example.com",
    ]
    assert inserted_rows[0]["password_hash"] != "AdminSeedFromEnv123!"
    assert inserted_rows[1]["password_hash"] != "DoctorSeedFromEnv123!"
