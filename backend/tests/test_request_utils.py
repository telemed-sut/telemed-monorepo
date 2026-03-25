from starlette.requests import Request

from app.core import limiter as limiter_module
from app.core import request_utils
from app.core.limiter import (
    get_client_ip_rate_limit_key,
    get_failed_login_key,
    get_real_user_key,
)
from app.core.request_utils import get_client_ip


def _build_request(
    *,
    client_host: str,
    headers: dict[str, str] | None = None,
) -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [
            (key.lower().encode("latin-1"), value.encode("latin-1"))
            for key, value in (headers or {}).items()
        ],
        "client": (client_host, 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


def test_get_client_ip_prefers_proxy_headers_for_trusted_proxy(monkeypatch):
    monkeypatch.setattr(request_utils.settings, "trusted_proxy_ips", ["10.0.0.1"])
    request = _build_request(
        client_host="10.0.0.1",
        headers={
            "cf-connecting-ip": "198.51.100.77",
            "x-forwarded-for": "198.51.100.88, 10.0.0.1",
        },
    )

    assert get_client_ip(request) == "198.51.100.77"


def test_real_user_key_uses_forwarded_client_ip_for_whitelist(monkeypatch):
    monkeypatch.setattr(request_utils.settings, "trusted_proxy_ips", ["10.0.0.1"])
    monkeypatch.setattr(limiter_module.settings, "rate_limit_whitelist", ["198.51.100.77"])
    request = _build_request(
        client_host="10.0.0.1",
        headers={"x-forwarded-for": "198.51.100.77, 10.0.0.1"},
    )

    assert get_real_user_key(request) is None


def test_failed_login_key_uses_forwarded_client_ip(monkeypatch):
    monkeypatch.setattr(request_utils.settings, "trusted_proxy_ips", ["10.0.0.1"])
    monkeypatch.setattr(limiter_module.settings, "rate_limit_whitelist", [])
    request = _build_request(
        client_host="10.0.0.1",
        headers={"x-forwarded-for": "198.51.100.77, 10.0.0.1"},
    )

    assert get_failed_login_key(request) == "login:198.51.100.77"


def test_client_ip_rate_limit_key_uses_forwarded_client_ip(monkeypatch):
    monkeypatch.setattr(request_utils.settings, "trusted_proxy_ips", ["10.0.0.1"])
    monkeypatch.setattr(limiter_module.settings, "rate_limit_whitelist", [])
    request = _build_request(
        client_host="10.0.0.1",
        headers={"x-forwarded-for": "198.51.100.77, 10.0.0.1"},
    )

    assert get_client_ip_rate_limit_key(request) == "ip:198.51.100.77"
