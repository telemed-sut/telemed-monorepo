"""Re-encrypt legacy plaintext secrets stored in the database.

Usage:
    PYTHONPATH=. venv/bin/python scripts/reencrypt_secrets_at_rest.py --dry-run
    PYTHONPATH=. venv/bin/python scripts/reencrypt_secrets_at_rest.py --write

This helper is idempotent:
- rows already marked as encrypted with the current envelope are skipped
- legacy plaintext rows are re-written through the model setters
- legacy values using the historical `encv1:` prefix are reported as ambiguous
  so operators can review them manually instead of being skipped silently
- no rows are modified unless `--write` is provided
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.core.secret_crypto import (
    has_legacy_encrypted_secret_prefix,
    is_current_encrypted_secret_value,
)
from app.db.session import SessionLocal
from app.models.device_registration import DeviceRegistration


def classify_secret_for_reencryption(value: str | None) -> str:
    if not value:
        return "empty"
    if is_current_encrypted_secret_value(value):
        return "encrypted"
    if has_legacy_encrypted_secret_prefix(value):
        return "ambiguous_legacy_prefixed"
    return "legacy_plaintext"


def _reencrypt_secret_rows(*, write: bool) -> dict[str, int]:
    updated_device_rows = 0
    ambiguous_device_rows = 0

    with SessionLocal() as db:
        device_rows = db.scalars(select(DeviceRegistration)).all()
        for device in device_rows:
            raw_secret = device._device_secret_encrypted
            disposition = classify_secret_for_reencryption(raw_secret)
            if disposition == "legacy_plaintext":
                if write:
                    plaintext = raw_secret
                    device.device_secret = plaintext
                    db.add(device)
                updated_device_rows += 1
            elif disposition == "ambiguous_legacy_prefixed":
                ambiguous_device_rows += 1

        if write:
            db.commit()
        else:
            db.rollback()

    return {
        "device_registrations": updated_device_rows,
        "ambiguous_device_registrations": ambiguous_device_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Persist the re-encrypted values. Without this flag the script is a dry run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the rows that would be re-encrypted without modifying data.",
    )
    args = parser.parse_args()

    write = bool(args.write)
    if args.dry_run:
        write = False

    summary = _reencrypt_secret_rows(write=write)
    mode = "write" if write else "dry-run"
    print(
        " ".join(
            [
                f"mode={mode}",
                f"device_registrations={summary['device_registrations']}",
                f"ambiguous_device_registrations={summary['ambiguous_device_registrations']}",
            ]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
