from types import SimpleNamespace

from app.services.blob_storage import AzureBlobStorageService


class _FakeDownload:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def readall(self) -> bytes:
        return self.payload


class _FakeBlobClient:
    def __init__(self, url: str, payload: bytes = b"", content_type: str = "audio/wav") -> None:
        self.url = url
        self._payload = payload
        self._content_type = content_type
        self.upload_calls: list[dict[str, object]] = []

    def get_blob_properties(self):
        return SimpleNamespace(
            metadata={"source": "legacy"},
            content_settings=SimpleNamespace(
                content_type=self._content_type,
                content_encoding=None,
                content_language=None,
                content_disposition=None,
                cache_control=None,
                content_md5=None,
            ),
        )

    def download_blob(self):
        return _FakeDownload(self._payload)

    def upload_blob(self, content, overwrite=False, content_settings=None, metadata=None):
        self.upload_calls.append(
            {
                "content": content,
                "overwrite": overwrite,
                "content_settings": content_settings,
                "metadata": metadata,
            }
        )


class _FakeBlobServiceClient:
    def __init__(self, clients: dict[str, _FakeBlobClient]) -> None:
        self.clients = clients

    def get_blob_client(self, *, container: str, blob: str):
        return self.clients[blob]


def test_normalize_legacy_storage_key_strips_container_prefix():
    service = AzureBlobStorageService()
    service.settings.azure_blob_storage_container = "heart-sounds"

    assert (
        service.normalize_legacy_storage_key("heart-sounds/patient-a/2026/04/file.wav")
        == "patient-a/2026/04/file.wav"
    )
    assert (
        service.normalize_legacy_storage_key("/heart-sounds/patient-a/2026/04/file.wav")
        == "patient-a/2026/04/file.wav"
    )
    assert service.normalize_legacy_storage_key("patient-a/2026/04/file.wav") == "patient-a/2026/04/file.wav"


def test_copy_blob_preserves_source_payload_and_metadata(monkeypatch):
    service = AzureBlobStorageService()
    service.settings.azure_blob_storage_container = "heart-sounds"
    source_key = "heart-sounds/patient-a/2026/04/file.wav"
    destination_key = "patient-a/2026/04/file.wav"
    source_client = _FakeBlobClient(
        url="https://example.blob.core.windows.net/heart-sounds/heart-sounds/patient-a/2026/04/file.wav",
        payload=b"RIFF....",
        content_type="audio/wav",
    )
    destination_client = _FakeBlobClient(
        url="https://example.blob.core.windows.net/heart-sounds/patient-a/2026/04/file.wav"
    )
    fake_client = _FakeBlobServiceClient(
        {
            source_key: source_client,
            destination_key: destination_client,
        }
    )

    monkeypatch.setattr(service, "assert_ready", lambda: None)
    monkeypatch.setattr(service, "_blob_service_client", lambda: fake_client)

    uploaded_blob = service.copy_blob(source_key=source_key, destination_key=destination_key)

    assert uploaded_blob.storage_key == destination_key
    assert uploaded_blob.blob_url == destination_client.url
    assert len(destination_client.upload_calls) == 1
    upload_call = destination_client.upload_calls[0]
    assert upload_call["content"] == b"RIFF...."
    assert upload_call["overwrite"] is False
    assert upload_call["metadata"] == {"source": "legacy"}
    assert upload_call["content_settings"].content_type == "audio/wav"


def test_prepare_heart_sound_upload_generates_write_url(monkeypatch):
    service = AzureBlobStorageService()
    service.settings.azure_blob_storage_container = "heart-sounds"
    service.settings.azure_blob_storage_url_ttl_seconds = 900
    fake_client = _FakeBlobServiceClient(
        {
            "patient-a/2026/04/file.wav": _FakeBlobClient(
                url="https://example.blob.core.windows.net/heart-sounds/patient-a/2026/04/file.wav"
            )
        }
    )

    monkeypatch.setattr(service, "assert_ready", lambda: None)
    monkeypatch.setattr(service, "_build_storage_key", lambda **_: "patient-a/2026/04/file.wav")
    monkeypatch.setattr(service, "_blob_service_client", lambda: fake_client)
    monkeypatch.setattr(
        "app.services.blob_storage.generate_blob_sas",
        lambda **_: "sig=write",
    )
    monkeypatch.setattr(
        service,
        "_connection_details",
        lambda: SimpleNamespace(account_name="demo", account_key="secret"),
    )

    prepared = service.prepare_heart_sound_upload(
        patient_id="ignored",
        filename="file.wav",
        ttl_seconds=900,
    )

    assert prepared.storage_key == "patient-a/2026/04/file.wav"
    assert prepared.blob_url == (
        "https://example.blob.core.windows.net/heart-sounds/patient-a/2026/04/file.wav"
    )
    assert prepared.upload_url.endswith("?sig=write")
