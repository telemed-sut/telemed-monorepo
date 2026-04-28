import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.secret_crypto import (
    LEGACY_SECRET_VALUE_PREFIX,
    SECRET_VALUE_PREFIX,
    SecretDecryptionError,
    encrypt_secret_value,
)
from app.models.device_registration import DeviceRegistration
from scripts.reencrypt_secrets_at_rest import classify_secret_for_reencryption


def test_device_secret_encrypts_on_write_and_decrypts_on_read(db: Session):
    device = DeviceRegistration(
        device_id="secret-device-001",
        display_name="Secret Device",
        device_secret="device_secret_plaintext_1234567890abcdef",
        is_active=True,
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    assert device.device_secret == "device_secret_plaintext_1234567890abcdef"
    assert device._device_secret_encrypted.startswith(SECRET_VALUE_PREFIX)
    assert device._device_secret_encrypted != "device_secret_plaintext_1234567890abcdef"

def test_legacy_plaintext_secret_rows_remain_readable(db: Session):
    device = DeviceRegistration(
        device_id="legacy-device-001",
        display_name="Legacy Device",
        device_secret="legacy_plaintext_secret_1234567890abcdef",
        is_active=True,
    )
    db.add(device)
    db.commit()

    device._device_secret_encrypted = "legacy_plaintext_secret_1234567890abcdef"
    db.add(device)
    db.commit()
    db.refresh(device)

    assert device.device_secret == "legacy_plaintext_secret_1234567890abcdef"


def test_legacy_encrypted_secret_rows_remain_readable(db: Session):
    current_value = encrypt_secret_value(
        "legacy_ciphertext_secret_1234567890abcdef",
        config_name="device_secret_encryption_key",
        purpose="device_registration.device_secret",
    )
    assert current_value is not None

    device = DeviceRegistration(
        device_id="legacy-cipher-device-001",
        display_name="Legacy Cipher Device",
        device_secret="bootstrap_secret_1234567890abcdef",
        is_active=True,
    )
    db.add(device)
    db.commit()

    device._device_secret_encrypted = LEGACY_SECRET_VALUE_PREFIX + current_value[len(SECRET_VALUE_PREFIX) :]
    db.add(device)
    db.commit()
    db.refresh(device)

    assert device.device_secret == "legacy_ciphertext_secret_1234567890abcdef"


def test_malformed_encrypted_secret_fails_safely(db: Session):
    device = DeviceRegistration(
        device_id="malformed-device-001",
        display_name="Malformed Device",
        device_secret="valid_device_secret_1234567890abcdef",
        is_active=True,
    )
    db.add(device)
    db.commit()

    device._device_secret_encrypted = f"{SECRET_VALUE_PREFIX}not-valid"
    db.add(device)
    db.commit()
    db.expire(device, ["_device_secret_encrypted"])

    with pytest.raises(SecretDecryptionError):
        _ = device.device_secret


def test_reencrypt_helper_flags_legacy_prefixed_values_as_ambiguous():
    assert (
        classify_secret_for_reencryption("encv1:this-is-plaintext-not-current-envelope")
        == "ambiguous_legacy_prefixed"
    )
    assert classify_secret_for_reencryption("plain_legacy_secret_1234567890abcdef") == "legacy_plaintext"


def test_encrypted_secrets_are_query_compatible_for_migration_helper(db: Session):
    device = DeviceRegistration(
        device_id="migration-device-001",
        display_name="Migration Device",
        device_secret="migration_device_secret_1234567890abcdef",
        is_active=True,
    )
    db.add(device)
    db.commit()

    refreshed = db.scalar(
        select(DeviceRegistration).where(DeviceRegistration.device_id == "migration-device-001")
    )
    assert refreshed is not None
    assert refreshed._device_secret_encrypted.startswith(SECRET_VALUE_PREFIX)
