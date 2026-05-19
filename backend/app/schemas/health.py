"""Pydantic response models for health check and root endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class HealthCheckResponse(BaseModel):
    """Comprehensive health check with component status."""

    status: Literal["ok", "degraded"] = Field(..., description="Overall service health")
    db: Literal["ok", "error"] = Field(..., description="Database connectivity status")


class LiveHealthCheckResponse(BaseModel):
    """Minimal liveness probe response."""

    status: Literal["ok"] = Field(..., description="Service is alive")


class RootResponse(BaseModel):
    """Root endpoint service identification."""

    message: str = Field(..., description="Service name and purpose")
    status: Literal["running"] = Field(..., description="Service running state")
