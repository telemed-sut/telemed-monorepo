from __future__ import annotations

import argparse
from uuid import UUID

from app.db.session import SessionLocal
from app.services.blob_storage import BlobStorageConfigurationError
from app.services.heart_sound_storage_audit import heart_sound_storage_audit_service


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit heart-sound storage consistency between the database and Azure Blob Storage."
    )
    parser.add_argument("--limit", type=int, default=100, help="Maximum number of records to scan.")
    parser.add_argument("--offset", type=int, default=0, help="Number of records to skip before scanning.")
    parser.add_argument("--patient-id", type=str, default=None, help="Optional patient UUID to scope the audit.")
    parser.add_argument(
        "--mismatches-only",
        action="store_true",
        help="Only print records that have one or more consistency issues.",
    )
    parser.add_argument(
        "--fail-on-mismatch",
        action="store_true",
        help="Exit with status code 1 when any inconsistency is found.",
    )
    args = parser.parse_args()

    patient_id = UUID(args.patient_id) if args.patient_id else None

    try:
        with SessionLocal() as db:
            summary = heart_sound_storage_audit_service.audit_records(
                db,
                limit=max(int(args.limit), 1),
                offset=max(int(args.offset), 0),
                patient_id=patient_id,
                mismatches_only=args.mismatches_only,
            )
    except BlobStorageConfigurationError as exc:
        raise SystemExit(str(exc)) from exc

    print(
        {
            "total_records": summary.total_records,
            "scanned_count": summary.scanned_count,
            "inconsistent_count": summary.inconsistent_count,
            "issue_counts": summary.issue_counts,
        }
    )
    for item in summary.items:
        print(
            {
                "record_id": str(item.record.id),
                "patient_id": str(item.record.patient_id),
                "storage_key": item.record.storage_key,
                "normalized_storage_key": item.normalized_storage_key,
                "blob_exists": item.blob_exists,
                "canonical_blob_url": item.canonical_blob_url,
                "issues": item.issues,
            }
        )

    if args.fail_on_mismatch and summary.inconsistent_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
