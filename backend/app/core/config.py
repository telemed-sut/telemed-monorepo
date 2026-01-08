from functools import lru_cache
from typing import List, Union

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Patient Management API"
    database_url: str
    jwt_secret: str
    jwt_expires_in: int
    cors_origins: Union[List[AnyHttpUrl], str] = ["http://localhost:3000", "http://localhost:8080"]
    default_page: int = 1
    default_limit: int = 20
    max_limit: int = 10000

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, v):
        if isinstance(v, str):
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