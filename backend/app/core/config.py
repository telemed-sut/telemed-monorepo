import json
from functools import lru_cache
from typing import Dict, List, Literal, Union

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Patient Management API"
    database_url: str
    jwt_secret: str
    jwt_expires_in: int
    password_reset_expires_in: int = 900
    password_reset_return_token_in_response: bool = False
    frontend_base_url: str = "http://localhost:3000"
    invite_expires_in_hours: int = 24
    cors_origins: Union[List[str], str] = ["http://localhost:3000", "http://localhost:8080"]
    default_page: int = 1
    default_limit: int = 20
    max_limit: int = 200
    # Novu settings
    novu_api_key: str = ""
    novu_enabled: bool = False
    # Security: brute force protection
    max_login_attempts: int = 10
    account_lockout_minutes: int = 15
    admin_max_login_attempts: int = 15
    admin_account_lockout_minutes: int = 3
    min_active_admin_accounts: int = 2
    super_admin_emails: Union[List[str], str] = ["admin@example.com"]
    admin_unlock_whitelisted_ips: Union[List[str], str] = ["127.0.0.1", "::1"]
    admin_2fa_required: bool = True
    admin_2fa_issuer: str = "Telemed Admin"
    trusted_device_cookie_name: str = "trusted_device_token"
    admin_trusted_device_days: int = 7
    user_trusted_device_days: int = 30
    backup_code_count: int = 10
    backup_code_expires_days: int = 365
    # Phase policy toggles
    specialist_invite_only: bool = True
    enable_break_glass_access: bool = False
    # Security: IP auto-ban
    ip_ban_threshold: int = 20
    ip_ban_duration_minutes: int = 30
    ip_attempt_window_minutes: int = 15
    security_whitelisted_ips: str = "127.0.0.1,::1"
    trusted_proxy_ips: Union[List[str], str] = ["127.0.0.1", "::1"]
    security_403_spike_threshold_1h: int = 25
    
    # Device API Security
    device_api_secret: str | None = None
    device_api_secrets: Dict[str, str] = {}
    device_api_allow_jwt_secret_fallback: bool = True
    device_api_require_registered_device: bool = False
    device_api_require_body_hash_signature: bool = False
    device_api_require_nonce: bool = False
    device_api_nonce_ttl_seconds: int = 300
    device_api_max_body_bytes: int = 262_144

    # Auth cookie settings
    auth_cookie_name: str = "access_token"
    auth_cookie_secure: bool = False
    auth_cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # Rate Limiting
    redis_url: str | None = None
    rate_limit_whitelist: Union[List[str], str] = ["127.0.0.1", "::1"]

    @field_validator(
        "cors_origins",
        "rate_limit_whitelist",
        "super_admin_emails",
        "admin_unlock_whitelisted_ips",
        "trusted_proxy_ips",
        mode="before",
    )
    @classmethod
    def split_origins(cls, v):
        if isinstance(v, str):
            # Split by comma and strip whitespace, return as plain strings
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("device_api_secret")
    @classmethod
    def validate_device_api_secret(cls, v: str | None) -> str | None:
        if v is None:
            return None
        value = cls._validate_device_secret_value(v, "DEVICE_API_SECRET")
        return value

    @classmethod
    def _validate_device_secret_value(cls, v: str, source_name: str) -> str:
        value = (v or "").strip()
        if not value:
            return value
        weak_values = {
            "change_this_to_a_strong_secret",
            "changeme",
            "default",
            "secret",
        }
        if value.lower() in weak_values:
            raise ValueError(f"{source_name} is too weak. Please set a strong secret.")
        if len(value) < 32:
            raise ValueError(f"{source_name} must be at least 32 characters long.")
        return value

    @field_validator("device_api_secrets", mode="before")
    @classmethod
    def parse_device_api_secrets(cls, v):
        if v is None:
            return {}

        raw_map: Dict[str, str]
        if isinstance(v, dict):
            raw_map = {str(k): str(val) for k, val in v.items()}
        elif isinstance(v, str):
            value = v.strip()
            if not value:
                return {}

            # Preferred format: JSON object {"device_id":"secret", ...}
            try:
                parsed = json.loads(value)
                if not isinstance(parsed, dict):
                    raise ValueError("DEVICE_API_SECRETS JSON must be an object")
                raw_map = {str(k): str(val) for k, val in parsed.items()}
            except json.JSONDecodeError:
                # Backward-friendly format: "deviceA=secretA,deviceB=secretB"
                raw_map = {}
                for pair in value.split(","):
                    item = pair.strip()
                    if not item:
                        continue
                    device_id, sep, secret = item.partition("=")
                    if not sep:
                        raise ValueError(
                            "DEVICE_API_SECRETS must be JSON object or comma-separated 'device=secret' pairs."
                        )
                    raw_map[device_id.strip()] = secret.strip()
        else:
            raise ValueError("DEVICE_API_SECRETS must be a mapping or string.")

        normalized: Dict[str, str] = {}
        for raw_device_id, raw_secret in raw_map.items():
            device_id = (raw_device_id or "").strip()
            if not device_id:
                raise ValueError("DEVICE_API_SECRETS contains an empty device_id.")
            secret = cls._validate_device_secret_value(
                str(raw_secret),
                f"DEVICE_API_SECRETS[{device_id}]",
            )
            if not secret:
                raise ValueError(f"DEVICE_API_SECRETS[{device_id}] must not be empty.")
            normalized[device_id] = secret
        return normalized

    @field_validator("device_api_nonce_ttl_seconds")
    @classmethod
    def validate_device_api_nonce_ttl_seconds(cls, v: int) -> int:
        if v < 30:
            raise ValueError("DEVICE_API_NONCE_TTL_SECONDS must be at least 30.")
        if v > 86400:
            raise ValueError("DEVICE_API_NONCE_TTL_SECONDS must be <= 86400.")
        return v

    @field_validator("device_api_max_body_bytes")
    @classmethod
    def validate_device_api_max_body_bytes(cls, v: int) -> int:
        if v < 1024:
            raise ValueError("DEVICE_API_MAX_BODY_BYTES must be at least 1024.")
        if v > 10_485_760:
            raise ValueError("DEVICE_API_MAX_BODY_BYTES must be <= 10485760.")
        return v

    @model_validator(mode="after")
    def apply_device_api_secret_fallback(self):
        # Backward-compatible fallback for legacy environments.
        # In production, set DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false.
        if not self.device_api_secret:
            if self.device_api_allow_jwt_secret_fallback:
                self.device_api_secret = self.jwt_secret
            elif not self.device_api_secrets:
                raise ValueError(
                    "DEVICE_API_SECRET is required when DEVICE_API_ALLOW_JWT_SECRET_FALLBACK=false and DEVICE_API_SECRETS is empty."
                )

        if self.device_api_secret is not None:
            value = self.device_api_secret.strip()
            if not value:
                if not self.device_api_secrets:
                    raise ValueError("DEVICE_API_SECRET is required when DEVICE_API_SECRETS is empty.")
                self.device_api_secret = None
            else:
                self.device_api_secret = value

        if self.device_api_require_registered_device and not self.device_api_secrets:
            raise ValueError(
                "DEVICE_API_REQUIRE_REGISTERED_DEVICE=true requires DEVICE_API_SECRETS to be configured."
            )
        return self

    model_config = {
        "env_file": ".env",
        "env_prefix": "",
        "case_sensitive": False,
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
