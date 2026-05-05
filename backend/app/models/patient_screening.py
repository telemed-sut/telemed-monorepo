"""Daily heart-failure screening submitted by the patient or their caregiver
from the mobile app.

Captures self-reported symptoms (4 flags), vital signs (BP, HR, SpO2, weight),
and warning sign flags. The patient may submit multiple times per day; the
latest record is treated as canonical for that day. Days with no submission
are considered "normal" by convention (no row, no symptoms).

`recorded_at` is always server-generated — clients do not supply it.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class PatientScreening(Base):
    __tablename__ = "patient_screenings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
    )

    # ---- Symptoms (any of these = abnormal) ----
    symptom_more_tired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    symptom_cannot_lie_flat: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    symptom_paroxysmal_nocturnal_dyspnea: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    symptom_more_than_one_pillow: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    # ---- Vital signs (all optional; client may submit a partial set) ----
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    oxygen_saturation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ---- Warning signs (patient self-flag) ----
    warning_dyspnea_orthopnea: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    warning_abnormal_vitals: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    patient = relationship("Patient")

    __table_args__ = (
        Index("ix_patient_screenings_patient_id", "patient_id"),
        Index("ix_patient_screenings_recorded_at", "recorded_at"),
        Index(
            "ix_patient_screenings_patient_recorded",
            "patient_id",
            "recorded_at",
        ),
    )
