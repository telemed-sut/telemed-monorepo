from __future__ import annotations

import re
import os
import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.core.config import get_settings

try:
    from azure.storage.blob import BlobSasPermissions, BlobServiceClient, ContentSettings, generate_blob_sas
except ImportError:  # pragma: no cover - optional until the dependency is installed in the runtime
    BlobSasPermissions = None
    BlobServiceClient = None
    ContentSettings = None
    generate_blob_sas = None


_FILENAME_SANITIZER = re.compile(r"[^A-Za-z0-9._-]+")


class BlobStorageConfigurationError(RuntimeError):
    """Raised when Azure Blob Storage is not configured for this environment."""


@dataclass(frozen=True)
class UploadedBlob:
    blob_url: str
    storage_key: str


@dataclass(frozen=True)
class PreparedBlobUpload:
    blob_url: str
    storage_key: str
    upload_url: str
    expires_at: datetime


@dataclass(frozen=True)
class AzureBlobConnectionDetails:
    account_name: str
    account_key: str


def _parse_connection_string(connection_string: str) -> AzureBlobConnectionDetails:
    parts = {}
    for segment in connection_string.split(";"):
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        parts[key.strip().lower()] = value.strip()

    account_name = parts.get("accountname", "")
    account_key = parts.get("accountkey", "")
    if not account_name or not account_key:
        raise BlobStorageConfigurationError(
            "Azure Blob Storage connection string must include AccountName and AccountKey."
        )
    return AzureBlobConnectionDetails(account_name=account_name, account_key=account_key)


def _sanitize_filename(filename: str) -> str:
    raw_name = Path(filename or "upload").name
    stem = _FILENAME_SANITIZER.sub("-", Path(raw_name).stem).strip("-") or "heart-sound"
    suffix = _FILENAME_SANITIZER.sub("", Path(raw_name).suffix)[:16]
    return f"{stem}{suffix}" if suffix else stem


class BlobStorageService(ABC):
    @abstractmethod
    def is_configured(self) -> bool:
        ...

    @abstractmethod
    def assert_ready(self) -> None:
        ...

    @abstractmethod
    def upload_heart_sound(
        self,
        *,
        patient_id: UUID,
        filename: str,
        content: bytes,
        content_type: str | None,
    ) -> UploadedBlob:
        ...

    @abstractmethod
    def prepare_heart_sound_upload(
        self,
        *,
        patient_id: UUID,
        filename: str,
        ttl_seconds: int | None = None,
    ) -> PreparedBlobUpload:
        ...

    @abstractmethod
    def delete_blob(self, storage_key: str | None) -> None:
        ...

    @abstractmethod
    def copy_blob(
        self,
        *,
        source_key: str,
        destination_key: str,
        overwrite: bool = False,
    ) -> UploadedBlob:
        ...

    @abstractmethod
    def build_read_url(self, storage_key: str | None, fallback_url: str) -> str:
        ...

    @abstractmethod
    def normalize_legacy_storage_key(self, storage_key: str | None) -> str | None:
        ...

    @abstractmethod
    def build_blob_url(self, storage_key: str) -> str:
        ...

    @abstractmethod
    def blob_exists(self, storage_key: str | None) -> bool:
        ...


class AzureBlobStorageService(BlobStorageService):
    def __init__(self) -> None:
        self.settings = get_settings()

    def is_configured(self) -> bool:
        return bool(
            self.settings.azure_blob_storage_connection_string
            and self.settings.azure_blob_storage_container
        )

    def assert_ready(self) -> None:
        if not self.is_configured():
            raise BlobStorageConfigurationError(
                "Azure Blob Storage is not configured. Set AZURE_BLOB_STORAGE_CONNECTION_STRING and "
                "AZURE_BLOB_STORAGE_CONTAINER before uploading heart-sound files."
            )
        if BlobServiceClient is None or ContentSettings is None:
            raise BlobStorageConfigurationError(
                "Azure Blob Storage dependency is not installed. Install azure-storage-blob to enable uploads."
            )

    @lru_cache(maxsize=1)
    def _connection_details(self) -> AzureBlobConnectionDetails:
        connection_string = self.settings.azure_blob_storage_connection_string or ""
        return _parse_connection_string(connection_string)

    @lru_cache(maxsize=1)
    def _blob_service_client(self):
        self.assert_ready()
        return BlobServiceClient.from_connection_string(  # type: ignore[union-attr]
            self.settings.azure_blob_storage_connection_string
        )

    def _build_storage_key(self, *, patient_id: UUID, filename: str) -> str:
        now = datetime.now(timezone.utc)
        safe_name = _sanitize_filename(filename)
        segments = [
            self.settings.azure_blob_storage_path_prefix,
            str(patient_id),
            now.strftime("%Y"),
            now.strftime("%m"),
            f"{uuid4().hex}-{safe_name}",
        ]
        return "/".join(segment for segment in segments if segment)

    def normalize_legacy_storage_key(self, storage_key: str | None) -> str | None:
        if storage_key is None:
            return None

        normalized_key = storage_key.strip().lstrip("/")
        container = (self.settings.azure_blob_storage_container or "").strip().strip("/")
        legacy_prefix = f"{container}/" if container else ""
        if legacy_prefix and normalized_key.startswith(legacy_prefix):
            return normalized_key[len(legacy_prefix) :]
        return normalized_key

    def build_blob_url(self, storage_key: str) -> str:
        self.assert_ready()
        normalized_key = storage_key.strip().lstrip("/")
        blob_client = self._blob_service_client().get_blob_client(
            container=self.settings.azure_blob_storage_container,
            blob=normalized_key,
        )
        return blob_client.url

    def blob_exists(self, storage_key: str | None) -> bool:
        if not storage_key or not self.is_configured() or BlobServiceClient is None:
            return False

        normalized_key = storage_key.strip().lstrip("/")
        try:
            return bool(
                self._blob_service_client().get_blob_client(
                    container=self.settings.azure_blob_storage_container,
                    blob=normalized_key,
                ).exists()
            )
        except Exception:
            return False

    def upload_heart_sound(
        self,
        *,
        patient_id: UUID,
        filename: str,
        content: bytes,
        content_type: str | None,
    ) -> UploadedBlob:
        self.assert_ready()
        storage_key = self._build_storage_key(patient_id=patient_id, filename=filename)
        blob_client = self._blob_service_client().get_blob_client(
            container=self.settings.azure_blob_storage_container,
            blob=storage_key,
        )
        blob_client.upload_blob(
            content,
            overwrite=False,
            content_settings=ContentSettings(  # type: ignore[operator]
                content_type=content_type or "application/octet-stream"
            ),
        )
        return UploadedBlob(blob_url=blob_client.url, storage_key=storage_key)

    def prepare_heart_sound_upload(
        self,
        *,
        patient_id: UUID,
        filename: str,
        ttl_seconds: int | None = None,
    ) -> PreparedBlobUpload:
        self.assert_ready()
        storage_key = self._build_storage_key(patient_id=patient_id, filename=filename)
        blob_url = self.build_blob_url(storage_key)
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=ttl_seconds or self.settings.azure_blob_storage_url_ttl_seconds
        )

        if generate_blob_sas is None or BlobSasPermissions is None:
            raise BlobStorageConfigurationError(
                "Azure Blob Storage SAS generation is unavailable in this runtime."
            )

        details = self._connection_details()
        sas_token = generate_blob_sas(
            account_name=details.account_name,
            container_name=self.settings.azure_blob_storage_container,
            blob_name=storage_key,
            account_key=details.account_key,
            permission=BlobSasPermissions(create=True, write=True),
            expiry=expires_at,
        )
        if not sas_token:
            raise BlobStorageConfigurationError(
                "Unable to generate an Azure Blob Storage upload URL."
            )

        return PreparedBlobUpload(
            blob_url=blob_url,
            storage_key=storage_key,
            upload_url=f"{blob_url}?{sas_token}",
            expires_at=expires_at,
        )

    def delete_blob(self, storage_key: str | None) -> None:
        if not storage_key or not self.is_configured() or BlobServiceClient is None:
            return

        blob_client = self._blob_service_client().get_blob_client(
            container=self.settings.azure_blob_storage_container,
            blob=storage_key,
        )
        try:
            blob_client.delete_blob(delete_snapshots="include")
        except Exception:
            # Deleting the blob is best effort only. The API caller handles the main failure path.
            return

    def copy_blob(
        self,
        *,
        source_key: str,
        destination_key: str,
        overwrite: bool = False,
    ) -> UploadedBlob:
        self.assert_ready()

        normalized_source = source_key.strip().lstrip("/")
        normalized_destination = destination_key.strip().lstrip("/")
        source_blob = self._blob_service_client().get_blob_client(
            container=self.settings.azure_blob_storage_container,
            blob=normalized_source,
        )
        destination_blob = self._blob_service_client().get_blob_client(
            container=self.settings.azure_blob_storage_container,
            blob=normalized_destination,
        )

        source_properties = source_blob.get_blob_properties()
        source_content_settings = getattr(source_properties, "content_settings", None)
        content_settings = None
        if ContentSettings is not None:
            content_settings = ContentSettings(
                content_type=getattr(source_content_settings, "content_type", None),
                content_encoding=getattr(source_content_settings, "content_encoding", None),
                content_language=getattr(source_content_settings, "content_language", None),
                content_disposition=getattr(source_content_settings, "content_disposition", None),
                cache_control=getattr(source_content_settings, "cache_control", None),
                content_md5=getattr(source_content_settings, "content_md5", None),
            )

        destination_blob.upload_blob(
            source_blob.download_blob().readall(),
            overwrite=overwrite,
            content_settings=content_settings,
            metadata=getattr(source_properties, "metadata", None),
        )
        return UploadedBlob(blob_url=destination_blob.url, storage_key=normalized_destination)

    def build_read_url(self, storage_key: str | None, fallback_url: str) -> str:
        if (
            not storage_key
            or not self.is_configured()
            or generate_blob_sas is None
            or BlobSasPermissions is None
        ):
            return fallback_url

        try:
            details = self._connection_details()
            sas_token = generate_blob_sas(
                account_name=details.account_name,
                container_name=self.settings.azure_blob_storage_container,
                blob_name=storage_key,
                account_key=details.account_key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.now(timezone.utc)
                + timedelta(seconds=self.settings.azure_blob_storage_url_ttl_seconds),
            )
            if not sas_token:
                return fallback_url

            blob_client = self._blob_service_client().get_blob_client(
                container=self.settings.azure_blob_storage_container,
                blob=storage_key,
            )
            return f"{blob_client.url}?{sas_token}"
        except Exception:
            return fallback_url


class LocalStorageService(BlobStorageService):
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_dir = Path("storage/uploads")

    def is_configured(self) -> bool:
        return True

    def assert_ready(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _build_storage_key(self, *, patient_id: UUID, filename: str) -> str:
        now = datetime.now(timezone.utc)
        safe_name = _sanitize_filename(filename)
        segments = [
            str(patient_id),
            now.strftime("%Y"),
            now.strftime("%m"),
            f"{uuid4().hex}-{safe_name}",
        ]
        return "/".join(segment for segment in segments if segment)

    def upload_heart_sound(
        self,
        *,
        patient_id: UUID,
        filename: str,
        content: bytes,
        content_type: str | None,
    ) -> UploadedBlob:
        self.assert_ready()
        storage_key = self._build_storage_key(patient_id=patient_id, filename=filename)
        file_path = self.base_dir / storage_key
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(content)
        
        # In local mode, the URL is just a path that the backend can serve or proxy
        blob_url = f"/api/heart-sounds/local/{storage_key}"
        return UploadedBlob(blob_url=blob_url, storage_key=storage_key)

    def prepare_heart_sound_upload(
        self,
        *,
        patient_id: UUID,
        filename: str,
        ttl_seconds: int | None = None,
    ) -> PreparedBlobUpload:
        self.assert_ready()
        storage_key = self._build_storage_key(patient_id=patient_id, filename=filename)
        blob_url = f"/api/heart-sounds/local/{storage_key}"
        # For local, we redirect the frontend to use a special backend proxy upload endpoint
        upload_url = f"/api/patients/{patient_id}/heart-sounds/upload-local-proxy"
        
        return PreparedBlobUpload(
            blob_url=blob_url,
            storage_key=storage_key,
            upload_url=upload_url,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )

    def delete_blob(self, storage_key: str | None) -> None:
        if not storage_key:
            return
        file_path = self.base_dir / storage_key
        if file_path.exists():
            file_path.unlink()

    def copy_blob(
        self,
        *,
        source_key: str,
        destination_key: str,
        overwrite: bool = False,
    ) -> UploadedBlob:
        self.assert_ready()
        source_path = self.base_dir / source_key
        dest_path = self.base_dir / destination_key
        
        if not source_path.exists():
            raise FileNotFoundError(f"Source blob {source_key} not found.")
            
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        if dest_path.exists() and not overwrite:
             raise FileExistsError(f"Destination blob {destination_key} already exists.")
             
        shutil.copy2(source_path, dest_path)
        blob_url = f"/api/heart-sounds/local/{destination_key}"
        return UploadedBlob(blob_url=blob_url, storage_key=destination_key)

    def build_read_url(self, storage_key: str | None, fallback_url: str) -> str:
        if not storage_key:
            return fallback_url
        return f"/api/heart-sounds/local/{storage_key}"

    def normalize_legacy_storage_key(self, storage_key: str | None) -> str | None:
        return storage_key

    def build_blob_url(self, storage_key: str) -> str:
        return f"/api/heart-sounds/local/{storage_key}"

    def blob_exists(self, storage_key: str | None) -> bool:
        if not storage_key:
            return False
        return (self.base_dir / storage_key).exists()


def get_blob_storage_service() -> BlobStorageService:
    settings = get_settings()
    if settings.storage_provider == "local" or not settings.azure_blob_storage_connection_string:
        return LocalStorageService()
    return AzureBlobStorageService()


azure_blob_storage_service = get_blob_storage_service()
