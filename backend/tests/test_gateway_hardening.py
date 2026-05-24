from app.api import device_sessions, events, heart_sound, passkeys, patient_app, patient_stream, users
from app.core import limiter as limiter_module


def _registered_limits(endpoint) -> set[str]:
    key = f"{endpoint.__module__}.{endpoint.__name__}"
    return {str(limit.limit) for limit in limiter_module.limiter._route_limits[key]}


def test_limiter_uses_configured_storage_uri(monkeypatch):
    monkeypatch.setattr(
        limiter_module.settings,
        "rate_limit_storage_uri",
        "memory://",
    )

    storage_uri, storage_options = limiter_module._build_limiter_storage_configuration()

    assert storage_uri == "memory://"
    assert storage_options == {}


def test_passkey_public_flows_have_explicit_strict_limits():
    assert _registered_limits(passkeys.get_login_options) == {"20 per 1 minute"}
    assert _registered_limits(passkeys.verify_login) == {"10 per 1 minute"}
    assert _registered_limits(passkeys.get_registration_options) == {"20 per 1 minute"}
    assert _registered_limits(passkeys.verify_registration) == {"20 per 1 minute"}


def test_admin_user_management_routes_have_explicit_limits():
    assert _registered_limits(users.get_users) == {"60 per 1 minute"}
    assert _registered_limits(users.create_user) == {"20 per 1 minute"}
    assert _registered_limits(users.bulk_delete_users) == {"10 per 1 minute"}
    assert _registered_limits(users.purge_deleted_users) == {"10 per 1 minute"}


def test_stream_and_local_file_routes_have_explicit_limits():
    assert _registered_limits(events.stream_user_events) == {"30 per 1 minute"}
    assert _registered_limits(patient_stream.stream_patient_events) == {"30 per 1 minute"}
    assert _registered_limits(patient_app.stream_patient_app_events) == {"30 per 1 minute"}
    assert _registered_limits(device_sessions.stream_device_session_events) == {"30 per 1 minute"}
    assert _registered_limits(heart_sound.serve_local_heart_sound) == {"60 per 1 minute"}
