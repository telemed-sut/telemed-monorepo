from functools import lru_cache
from typing import List, Literal, Union

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
    max_limit: int = 10000
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
    # Security: IP auto-ban
    ip_ban_threshold: int = 20
    ip_ban_duration_minutes: int = 30
    ip_attempt_window_minutes: int = 15
    security_whitelisted_ips: str = "127.0.0.1,::1"
    
    # Device API Security
    device_api_secret: str | None = None

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
    def validate_device_api_secret(cls, v: str) -> str:
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
            raise ValueError("DEVICE_API_SECRET is too weak. Please set a strong secret.")
        if len(value) < 32:
            raise ValueError("DEVICE_API_SECRET must be at least 32 characters long.")
        return value

    @model_validator(mode="after")
    def apply_device_api_secret_fallback(self):
        # Fallback to JWT secret when DEVICE_API_SECRET is not explicitly configured.
        if not self.device_api_secret:
            self.device_api_secret = self.jwt_secret

        value = self.device_api_secret.strip()
        if not value:
            raise ValueError("DEVICE_API_SECRET is required.")
        self.device_api_secret = value
        return self

    model_config = {
        "env_file": ".env",
        "env_prefix": "",
        "case_sensitive": False,
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
