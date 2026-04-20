from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.heart_sound_record import HeartSoundRecord
from app.services.blob_storage import BlobStorageConfigurationError, azure_blob_storage_service


@dataclass(frozen=True)
class HeartSoundStorageAuditResult:
    record: HeartSoundRecord
    normalized_storage_key: str | None
    canonical_blob_url: str | None
    blob_exists: bool
    issues: list[str]

    @property
    def is_consistent(self) -> bool:
        return not self.issues


@dataclass(frozen=True)
class HeartSoundStorageAuditSummary:
    items: list[HeartSoundStorageAuditResult]
    total_records: int
    scanned_count: int
    inconsistent_count: int
    issue_counts: dict[str, int]


class HeartSoundStorageAuditService:
    def _extract_storage_key_from_blob_url(self, blob_url: str) -> str | None:
        container = (azure_blob_storage_service.settings.azure_blob_storage_container or "").strip().strip("/")
        if not container:
            return None

        parsed = urlparse(blob_url)
        path = parsed.path.lstrip("/")
        prefix = f"{container}/"
        if not path.startswith(prefix):
            return None
        return path[len(prefix) :]

    def audit_record(self, record: HeartSoundRecord) -> HeartSoundStorageAuditResult:
        issues: list[str] = []
        storage_key = record.storage_key.strip() if record.storage_key else None
        derived_storage_key = storage_key or self._extract_storage_key_from_blob_url(record.blob_url)
        normalized_storage_key = azure_blob_storage_service.normalize_legacy_storage_key(derived_storage_key)
        canonical_blob_url = None
        blob_exists = False

        if not storage_key:
            issues.append("missing_storage_key")
        if not derived_storage_key:
            issues.append("unparseable_blob_url")

        if storage_key and normalized_storage_key and normalized_storage_key != storage_key:
            issues.append("legacy_storage_key_prefix")

        audit_key = storage_key or derived_storage_key
        if audit_key:
            canonical_blob_url = azure_blob_storage_service.build_blob_url(audit_key)
            blob_exists = azure_blob_storage_service.blob_exists(audit_key)
            if not blob_exists:
                issues.append("blob_missing")
            if record.blob_url.strip() != canonical_blob_url:
                issues.append("blob_url_mismatch")

        return HeartSoundStorageAuditResult(
            record=record,
            normalized_storage_key=normalized_storage_key,
            canonical_blob_url=canonical_blob_url,
            blob_exists=blob_exists,
            issues=issues,
        )

    def audit_records(
        self,
        db: Session,
        *,
        limit: int = 100,
        offset: int = 0,
        patient_id: UUID | None = None,
        mismatches_only: bool = False,
    ) -> HeartSoundStorageAuditSummary:
        try:
            azure_blob_storage_service.assert_ready()
        except BlobStorageConfigurationError:
            raise

        filters = []
        if patient_id is not None:
            filters.append(HeartSoundRecord.patient_id == patient_id)

        total_stmt = select(func.count(HeartSoundRecord.id))
        if filters:
            total_stmt = total_stmt.where(*filters)
        total_records = int(db.scalar(total_stmt) or 0)

        stmt = select(HeartSoundRecord).order_by(
            HeartSoundRecord.recorded_at.desc(),
            HeartSoundRecord.created_at.desc(),
        )
        if filters:
            stmt = stmt.where(*filters)
        stmt = stmt.limit(limit).offset(offset)

        scanned_records = list(db.scalars(stmt).all())
        issue_counts: Counter[str] = Counter()
        items: list[HeartSoundStorageAuditResult] = []
        inconsistent_count = 0

        for audit_result in map(self.audit_record, scanned_records):
            issue_counts.update(audit_result.issues)
            if not audit_result.is_consistent:
                inconsistent_count += 1
            if mismatches_only and audit_result.is_consistent:
                continue
            items.append(audit_result)

        return HeartSoundStorageAuditSummary(
            items=items,
            total_records=total_records,
            scanned_count=len(scanned_records),
            inconsistent_count=inconsistent_count,
            issue_counts=dict(issue_counts),
        )


heart_sound_storage_audit_service = HeartSoundStorageAuditService()
