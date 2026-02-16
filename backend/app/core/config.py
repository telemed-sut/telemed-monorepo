from functools import lru_cache
from typing import List, Union

from pydantic import field_validator
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
    # Security: IP auto-ban
    ip_ban_threshold: int = 20
    ip_ban_duration_minutes: int = 30
    ip_attempt_window_minutes: int = 15
    security_whitelisted_ips: str = "127.0.0.1,::1"
    
    # Device API Security
    device_api_secret: str = "change_this_to_a_strong_secret"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, v):
        if isinstance(v, str):
            # Split by comma and strip whitespace, return as plain strings
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    model_config = {
        "env_file": ".env",
        "env_prefix": "",
        "case_sensitive": False,
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
