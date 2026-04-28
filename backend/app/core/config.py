import json
import re
from functools import lru_cache
from typing import Dict, List, Literal, Union

from pydantic import field_validator, model_validator
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
)


class RawDeviceSecretsEnvSettingsSource(EnvSettingsSource):
    def prepare_field_value(self, field_name, field, value, value_is_complex):
        if field_name == "device_api_secrets" and isinstance(value, str):
            return value
        return super().prepare_field_value(field_name, field, value, value_is_complex)


class RawDeviceSecretsDotEnvSettingsSource(DotEnvSettingsSource):
    def prepare_field_value(self, field_name, field, value, value_is_complex):
        if field_name == "device_api_secrets" and isinstance(value, str):
            return value
        return super().prepare_field_value(field_name, field, value, value_is_complex)


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
    device_api_allow_jwt_secret_fallback: bool = False
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
    # Video meeting integration
    meeting_video_provider: Literal["disabled", "mock", "zego"] = "disabled"
    zego_app_id: int | None = None
    zego_server_secret: str | None = None
    meeting_video_token_ttl_seconds: int = 900
    meeting_patient_invite_ttl_seconds: int = 86_400
    meeting_patient_join_base_url: str | None = None
    meeting_video_room_prefix: str = "telemed"

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if not isinstance(v, str):
            return v

        value = v.strip()
        if value.startswith("postgres://"):
            return f"postgresql+psycopg://{value[len('postgres://'):]}"
        if value.startswith("postgresql://"):
            return f"postgresql+psycopg://{value[len('postgresql://'):]}"
        return value

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

    @field_validator("meeting_video_token_ttl_seconds")
    @classmethod
    def validate_meeting_video_token_ttl_seconds(cls, v: int) -> int:
        if v < 60:
            raise ValueError("MEETING_VIDEO_TOKEN_TTL_SECONDS must be at least 60.")
        if v > 7_200:
            raise ValueError("MEETING_VIDEO_TOKEN_TTL_SECONDS must be <= 7200.")
        return v

    @field_validator("meeting_patient_invite_ttl_seconds")
    @classmethod
    def validate_meeting_patient_invite_ttl_seconds(cls, v: int) -> int:
        if v < 300:
            raise ValueError("MEETING_PATIENT_INVITE_TTL_SECONDS must be at least 300.")
        if v > 604_800:
            raise ValueError("MEETING_PATIENT_INVITE_TTL_SECONDS must be <= 604800.")
        return v

    @field_validator("meeting_video_room_prefix")
    @classmethod
    def validate_meeting_video_room_prefix(cls, v: str) -> str:
        value = (v or "").strip().lower()
        if not value:
            raise ValueError("MEETING_VIDEO_ROOM_PREFIX must not be empty.")
        if not re.fullmatch(r"[a-z0-9-]{2,32}", value):
            raise ValueError(
                "MEETING_VIDEO_ROOM_PREFIX must match [a-z0-9-]{2,32}."
            )
        return value

    @field_validator("meeting_patient_join_base_url")
    @classmethod
    def validate_meeting_patient_join_base_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        value = v.strip()
        if not value:
            return None
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("MEETING_PATIENT_JOIN_BASE_URL must start with http:// or https://.")
        return value.rstrip("/")

    @field_validator("zego_app_id", mode="before")
    @classmethod
    def parse_optional_zego_app_id(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def apply_device_api_secret_fallback(self):
        if self.device_api_allow_jwt_secret_fallback:
            raise ValueError("DEVICE_API_ALLOW_JWT_SECRET_FALLBACK is not allowed for security reasons.")

        if not self.device_api_secret and not self.device_api_secrets and not self.device_api_require_registered_device:
            raise ValueError(
                "DEVICE_API_SECRET is required when DEVICE_API_SECRETS is empty and DEVICE_API_REQUIRE_REGISTERED_DEVICE=false."
            )

        if self.device_api_secret is not None:
            value = self.device_api_secret.strip()
            if not value:
                if not self.device_api_secrets and not self.device_api_require_registered_device:
                    raise ValueError("DEVICE_API_SECRET is required when DEVICE_API_SECRETS is empty.")
                self.device_api_secret = None
            else:
                self.device_api_secret = value

        if self.frontend_base_url.startswith("https://") and not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be true when FRONTEND_BASE_URL is HTTPS.")

        if self.meeting_video_provider == "zego":
            if self.zego_app_id is None:
                raise ValueError("ZEGO_APP_ID is required when MEETING_VIDEO_PROVIDER=zego.")
            if self.zego_app_id <= 0:
                raise ValueError("ZEGO_APP_ID must be > 0.")
            secret = (self.zego_server_secret or "").strip()
            if len(secret) < 16:
                raise ValueError(
                    "ZEGO_SERVER_SECRET must be at least 16 characters when MEETING_VIDEO_PROVIDER=zego."
                )
            self.zego_server_secret = secret

        return self

    model_config = {
        "env_prefix": "",
        "env_file": ".env",
        "case_sensitive": False,
        "extra": "ignore",
    }

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            RawDeviceSecretsEnvSettingsSource(settings_cls),
            RawDeviceSecretsDotEnvSettingsSource(settings_cls),
            file_secret_settings,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
