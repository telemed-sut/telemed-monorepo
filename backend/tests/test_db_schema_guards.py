from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

from app.models.alert import Alert
from app.models.device_error_log import DeviceErrorLog
from app.models.device_request_nonce import DeviceRequestNonce
from app.models.encounter import Encounter
from app.models.heart_sound_record import HeartSoundRecord
from app.models.login_attempt import LoginAttempt
from app.models.pressure_record import PressureRecord
from app.models.user_privileged_role_assignment import (
    UserPrivilegedRoleAssignment,
)


def _index_names(table) -> set[str]:
    return {index.name for index in table.indexes}


def _load_migration_module(filename: str):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = spec_from_file_location(filename.replace(".py", ""), migration_path)
    module = module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_heart_sound_record_uses_cascade_delete_and_unique_blob_url_index():
    patient_fk = next(iter(HeartSoundRecord.__table__.c.patient_id.foreign_keys))

    assert patient_fk.ondelete == "CASCADE"
    assert "ix_heart_sound_records_blob_url" in _index_names(HeartSoundRecord.__table__)


def test_pressure_record_uses_cascade_delete_for_patient_fk():
    patient_fk = next(iter(PressureRecord.__table__.c.patient_id.foreign_keys))

    assert patient_fk.ondelete == "CASCADE"


def test_device_models_do_not_add_redundant_primary_key_indexes():
    assert DeviceErrorLog.__table__.c.id.index is None
    assert DeviceRequestNonce.__table__.c.id.index is None


def test_query_focused_indexes_are_present_in_models():
    assert "ix_encounters_status" in _index_names(Encounter.__table__)
    assert "ix_alerts_patient_id_is_acknowledged" in _index_names(Alert.__table__)
    assert "ix_login_attempts_email_created_at" in _index_names(LoginAttempt.__table__)
    assert "ix_user_privileged_role_assignments_created_by" in _index_names(
        UserPrivilegedRoleAssignment.__table__
    )
    assert "ix_user_privileged_role_assignments_revoked_by" in _index_names(
        UserPrivilegedRoleAssignment.__table__
    )


def test_seed_migration_is_blocked_in_production(monkeypatch):
    migration = _load_migration_module("20260215_0007_seed_admin_doctor_users.py")
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(ValueError, match="Seed migration is blocked in production"):
        migration.upgrade()
