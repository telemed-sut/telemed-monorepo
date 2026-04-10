"""Pydantic response models for dashboard statistics."""

from pydantic import BaseModel, Field


class MonthlyStatsItem(BaseModel):
    """Aggregated stats for a single month."""

    month: str = Field(..., description="Three-letter month abbreviation")
    new_patients: int = Field(..., description="Number of new patients registered in this month")
    consultations: int = Field(..., description="Number of consultations held in this month")


class StatsTotals(BaseModel):
    """Lifetime totals across all time."""

    patients: int = Field(..., description="Total active patients")
    meetings: int = Field(..., description="Total consultations ever scheduled")


class StatsKPIs(BaseModel):
    """Current-period key performance indicators."""

    today_consultations: int = Field(..., description="Consultations scheduled today")
    this_week_consultations: int = Field(..., description="Consultations scheduled this week")
    this_month_new_patients: int = Field(..., description="New patients registered this month")


class StatsOverviewResponse(BaseModel):
    """Complete overview statistics for the dashboard chart."""

    year: int = Field(..., description="Year being aggregated")
    monthly: list[MonthlyStatsItem] = Field(..., description="Monthly breakdown across all 12 months")
    totals: StatsTotals = Field(..., description="Lifetime totals")
    kpis: StatsKPIs = Field(..., description="Current-period KPIs")
