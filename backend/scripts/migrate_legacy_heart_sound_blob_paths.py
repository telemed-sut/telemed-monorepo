from __future__ import annotations

import argparse
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import or_, select

from app.db.session import SessionLocal
from app.models.heart_sound_record import HeartSoundRecord
from app.services.blob_storage import (
    BlobStorageConfigurationError,
    UploadedBlob,
    azure_blob_storage_service,
)


@dataclass(frozen=True)
class LegacyHeartSoundCandidate:
    source_key: str
    destination_key: str


def _extract_storage_key_from_blob_url(blob_url: str) -> str | None:
    container = (azure_blob_storage_service.settings.azure_blob_storage_container or "").strip().strip("/")
    if not container:
        return None

    parsed = urlparse(blob_url)
    path = parsed.path.lstrip("/")
    prefix = f"{container}/"
    if not path.startswith(prefix):
        return None
    return path[len(prefix) :]


def _get_legacy_candidate(record: HeartSoundRecord) -> LegacyHeartSoundCandidate | None:
    raw_source_key = record.storage_key or _extract_storage_key_from_blob_url(record.blob_url)
    if not raw_source_key:
        return None

    normalized_source = raw_source_key.strip().lstrip("/")
    normalized_destination = azure_blob_storage_service.normalize_legacy_storage_key(normalized_source)
    if not normalized_destination or normalized_destination == normalized_source:
        return None

    return LegacyHeartSoundCandidate(
        source_key=normalized_source,
        destination_key=normalized_destination,
    )


def _copy_or_reuse_destination(candidate: LegacyHeartSoundCandidate) -> UploadedBlob:
    if azure_blob_storage_service.blob_exists(candidate.destination_key):
        return UploadedBlob(
            blob_url=azure_blob_storage_service.build_blob_url(candidate.destination_key),
            storage_key=candidate.destination_key,
        )

    return azure_blob_storage_service.copy_blob(
        source_key=candidate.source_key,
        destination_key=candidate.destination_key,
        overwrite=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Move legacy heart-sound blobs stored with a duplicated container prefix "
            "(for example heart-sounds/heart-sounds/...) to the cleaned path format."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the migration. Without this flag the script only reports what would change.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only inspect or migrate the first N matching records.",
    )
    parser.add_argument(
        "--keep-source",
        action="store_true",
        help="Keep the old blob after copying and updating the database.",
    )
    args = parser.parse_args()

    try:
        azure_blob_storage_service.assert_ready()
    except BlobStorageConfigurationError as exc:
        raise SystemExit(str(exc)) from exc

    container = (azure_blob_storage_service.settings.azure_blob_storage_container or "").strip().strip("/")
    blob_url_pattern = f"%/{container}/{container}/%" if container else None

    with SessionLocal() as db:
        filters = [HeartSoundRecord.storage_key.like(f"{container}/%")] if container else []
        if blob_url_pattern:
            filters.append(HeartSoundRecord.blob_url.like(blob_url_pattern))

        if not filters:
            print("No Azure Blob container configured. Nothing to migrate.")
            return 0

        stmt = (
            select(HeartSoundRecord)
            .where(or_(*filters))
            .order_by(HeartSoundRecord.created_at.asc())
        )
        if args.limit is not None and args.limit > 0:
            stmt = stmt.limit(args.limit)

        records = list(db.scalars(stmt).all())
        if not records:
            print("No legacy heart-sound blob paths found.")
            return 0

        print(
            f"Found {len(records)} legacy heart-sound record(s) with duplicated container prefixes."
        )
        migrated = 0
        skipped = 0
        failed = 0

        for record in records:
            candidate = _get_legacy_candidate(record)
            if candidate is None:
                skipped += 1
                print(f"SKIP {record.id}: already clean or could not derive a legacy key.")
                continue

            if not args.apply:
                print(
                    f"DRY-RUN {record.id}: {candidate.source_key} -> {candidate.destination_key}"
                )
                continue

            print(f"MIGRATE {record.id}: {candidate.source_key} -> {candidate.destination_key}")
            try:
                migrated_blob = _copy_or_reuse_destination(candidate)
                record.storage_key = migrated_blob.storage_key
                record.blob_url = migrated_blob.blob_url
                db.add(record)
                db.commit()

                if not args.keep_source:
                    azure_blob_storage_service.delete_blob(candidate.source_key)

                migrated += 1
            except Exception as exc:
                db.rollback()
                failed += 1
                print(f"ERROR {record.id}: {exc}")

        mode = "applied" if args.apply else "previewed"
        print(
            f"Legacy heart-sound cleanup {mode}. migrated={migrated} skipped={skipped} failed={failed}"
        )
        return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
