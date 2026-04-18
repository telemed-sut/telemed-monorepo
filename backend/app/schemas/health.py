"""Pydantic response models for health check and root endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class RedisRuntimeDiagnosticsResponse(BaseModel):
    """Best-effort Redis runtime diagnostics for operational visibility."""

    unavailable_scopes: list[str] = Field(default_factory=list, description="Redis-backed scopes currently degrading to fallbacks")
    unavailable_scope_counts: dict[str, int] = Field(default_factory=dict, description="Number of times each scope has observed Redis unavailability")
    unavailable_scope_total: int = Field(default=0, description="Total number of Redis unavailability events observed across all scopes")
    degraded_scope_count: int = Field(default=0, description="Number of distinct Redis-backed scopes currently marked as degraded")
    last_unavailable_at: str | None = Field(default=None, description="Most recent UTC timestamp when a Redis-backed scope observed Redis unavailability")
    operation_failures: dict[str, int] = Field(default_factory=dict, description="Redis operation failures grouped by scope and operation")
    operation_failure_total: int = Field(default=0, description="Total number of Redis operation failures observed across all scopes")
    last_operation_failure_at: str | None = Field(default=None, description="Most recent UTC timestamp when a Redis operation failure was recorded")


class RedisRuntimeAlertResponse(BaseModel):
    """Threshold-based Redis runtime alert view for monitors and operators."""

    status: Literal["ok", "warning", "critical"] = Field(..., description="Derived alert severity for Redis runtime degradation")
    should_alert: bool = Field(default=False, description="Whether the current Redis runtime state should trigger an operational alert")
    reasons: list[str] = Field(default_factory=list, description="Human-readable reasons why the alert status was raised")
    degraded_scope_threshold: int = Field(default=0, description="Configured threshold for distinct degraded Redis-backed scopes")
    operation_failure_threshold: int = Field(default=0, description="Configured threshold for total Redis operation failures")


class HealthCheckResponse(BaseModel):
    """Comprehensive health check with component status."""

    status: Literal["ok", "degraded"] = Field(..., description="Overall service health")
    db: Literal["ok", "error"] = Field(..., description="Database connectivity status")
    redis: Literal["disabled", "ok", "error"] = Field(..., description="Redis connectivity status")
    redis_runtime: RedisRuntimeDiagnosticsResponse = Field(
        default_factory=RedisRuntimeDiagnosticsResponse,
        description="Best-effort runtime diagnostics for Redis-backed fallbacks and failures",
    )
    redis_runtime_alert: RedisRuntimeAlertResponse = Field(
        default_factory=lambda: RedisRuntimeAlertResponse(status="ok"),
        description="Threshold-based alert summary derived from Redis runtime diagnostics",
    )


class LiveHealthCheckResponse(BaseModel):
    """Minimal liveness probe response."""

    status: Literal["ok"] = Field(..., description="Service is alive")


class RootResponse(BaseModel):
    """Root endpoint service identification."""

    message: str = Field(..., description="Service name and purpose")
    status: Literal["running"] = Field(..., description="Service running state")
