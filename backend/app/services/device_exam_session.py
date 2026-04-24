import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.device_exam_session import DeviceExamSession
from app.models.device_registration import DeviceRegistration
from app.models.encounter import Encounter
from app.models.enums import (
    DeviceExamMeasurementType,
    DeviceExamSessionResolutionReason,
    DeviceExamSessionStatus,
    DeviceMeasurementRoutingStatus,
    UserRole,
)
from app.models.patient import Patient
from app.models.user import User
from app.services.device_session_events import publish_device_session_event_sync
from app.services.patient import verify_doctor_patient_access


settings = get_settings()
OPEN_DEVICE_SESSION_STATUSES = (
    DeviceExamSessionStatus.pending_pair,
    DeviceExamSessionStatus.active,
    DeviceExamSessionStatus.stale,
)
TRANSITION_WINDOW_SECONDS = max(1, settings.device_session_transition_window_seconds)
LATE_PACKET_GRACE_SECONDS = max(0, settings.device_session_late_packet_grace_seconds)
STALE_THRESHOLD_SECONDS = max(1, settings.device_session_stale_threshold_seconds)
AUTO_CLOSE_TIMEOUT_SECONDS = max(STALE_THRESHOLD_SECONDS, settings.device_session_auto_close_timeout_seconds)


@dataclass(frozen=True)
class MeasurementRouteDecision:
    patient_id: UUID | None
    session_id: UUID | None
    routing_status: DeviceMeasurementRoutingStatus
    conflict_metadata: dict[str, Any] | None = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _build_pairing_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _is_open_device_session_status(status_value: DeviceExamSessionStatus) -> bool:
    return status_value in OPEN_DEVICE_SESSION_STATUSES


class DeviceExamSessionService:
    def _measurement_type_matches(
        self,
        *,
        session_measurement_type: DeviceExamMeasurementType,
        requested_measurement_type: DeviceExamMeasurementType,
    ) -> bool:
        return (
            session_measurement_type == DeviceExamMeasurementType.multi
            or session_measurement_type == requested_measurement_type
        )

    def _get_registered_device(self, db: Session, *, device_id: str) -> DeviceRegistration:
        device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == device_id))
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found",
            )
        if not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device {device_id} is inactive",
            )
        return device

    def _lock_registered_device(self, db: Session, *, device_id: str) -> DeviceRegistration:
        device = db.scalar(
            select(DeviceRegistration)
            .where(DeviceRegistration.device_id == device_id)
            .with_for_update()
        )
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found",
            )
        if not device.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device {device_id} is inactive",
            )
        return device

    def _get_patient(self, db: Session, *, patient_id: UUID) -> Patient:
        patient = db.scalar(
            select(Patient).where(
                Patient.id == patient_id,
                Patient.deleted_at.is_(None),
                Patient.is_active == True,  # noqa: E712
            )
        )
        if patient is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
        return patient

    def _validate_encounter(
        self,
        db: Session,
        *,
        encounter_id: UUID | None,
        patient_id: UUID,
    ) -> Encounter | None:
        if encounter_id is None:
            return None

        encounter = db.scalar(select(Encounter).where(Encounter.id == encounter_id))
        if encounter is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")
        if encounter.patient_id != patient_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Encounter does not belong to patient",
            )
        return encounter

    def _assert_actor_can_access_patient(
        self,
        db: Session,
        *,
        actor: User,
        patient_id: UUID,
        ip_address: str | None,
    ) -> None:
        if actor.role == UserRole.admin:
            return
        verify_doctor_patient_access(
            db,
            current_user=actor,
            patient_id=patient_id,
            ip_address=ip_address,
        )

    def _assert_actor_can_access_session(
        self,
        db: Session,
        *,
        actor: User,
        session: DeviceExamSession,
        ip_address: str | None,
    ) -> None:
        self._assert_actor_can_access_patient(
            db,
            actor=actor,
            patient_id=session.patient_id,
            ip_address=ip_address,
        )

    def _get_open_device_sessions(self, db: Session, *, device_id: str) -> list[DeviceExamSession]:
        return list(
            db.scalars(
                select(DeviceExamSession)
                .where(
                    DeviceExamSession.device_id == device_id,
                    DeviceExamSession.status.in_(OPEN_DEVICE_SESSION_STATUSES),
                )
                .order_by(DeviceExamSession.created_at.desc())
            ).all()
        )

    def _get_latest_open_device_session(self, db: Session, *, device_id: str) -> DeviceExamSession | None:
        return db.scalar(
            select(DeviceExamSession)
            .where(
                DeviceExamSession.device_id == device_id,
                DeviceExamSession.status.in_(OPEN_DEVICE_SESSION_STATUSES),
            )
            .order_by(DeviceExamSession.created_at.desc())
        )

    def _get_active_device_session(self, db: Session, *, device_id: str) -> DeviceExamSession | None:
        return db.scalar(
            select(DeviceExamSession)
            .where(
                DeviceExamSession.device_id == device_id,
                DeviceExamSession.status == DeviceExamSessionStatus.active,
            )
            .order_by(DeviceExamSession.created_at.desc())
        )

    def _touch_registration_last_seen(
        self,
        db: Session,
        *,
        device_id: str,
        seen_at: datetime,
    ) -> None:
        device = db.scalar(select(DeviceRegistration).where(DeviceRegistration.device_id == device_id))
        if device is None:
            return
        device.last_seen_at = seen_at
        db.add(device)

    def _promote_session_for_ingest(
        self,
        db: Session,
        *,
        session: DeviceExamSession,
        seen_at: datetime,
    ) -> None:
        if session.status in (DeviceExamSessionStatus.pending_pair, DeviceExamSessionStatus.stale):
            session.status = DeviceExamSessionStatus.active
            if session.started_at is None:
                session.started_at = seen_at
        session.last_seen_at = seen_at
        db.add(session)

    def _resolve_transition_conflict_metadata(
        self,
        db: Session,
        *,
        session: DeviceExamSession,
        received_at: datetime,
    ) -> dict[str, Any] | None:
        window_start = received_at.timestamp() - TRANSITION_WINDOW_SECONDS
        window_end = received_at.timestamp() + TRANSITION_WINDOW_SECONDS

        previous_session = db.scalar(
            select(DeviceExamSession)
            .where(
                DeviceExamSession.device_id == session.device_id,
                DeviceExamSession.id != session.id,
                DeviceExamSession.status == DeviceExamSessionStatus.review_needed,
                DeviceExamSession.resolution_reason
                == DeviceExamSessionResolutionReason.preempted_by_new_session,
                DeviceExamSession.ended_at.is_not(None),
            )
            .order_by(DeviceExamSession.ended_at.desc())
        )
        if previous_session is None or previous_session.ended_at is None:
            return None

        previous_ended_at = previous_session.ended_at
        if previous_ended_at.tzinfo is None:
            previous_ended_at = previous_ended_at.replace(tzinfo=timezone.utc)
        previous_seconds = previous_ended_at.timestamp()
        if not (window_start <= previous_seconds <= window_end):
            return None

        return {
            "reason": "transition_window_overlap",
            "window_seconds": TRANSITION_WINDOW_SECONDS,
            "preempted_session_id": str(previous_session.id),
            "current_session_id": str(session.id),
            "preempted_patient_id": str(previous_session.patient_id),
            "current_patient_id": str(session.patient_id),
            "preempted_ended_at": previous_ended_at.isoformat(),
        }

    def _maybe_route_closed_session_for_review(
        self,
        *,
        session: DeviceExamSession,
        received_at: datetime,
    ) -> MeasurementRouteDecision | None:
        if session.ended_at is None:
            return None

        ended_at = session.ended_at if session.ended_at.tzinfo else session.ended_at.replace(tzinfo=timezone.utc)
        if (received_at - ended_at).total_seconds() > LATE_PACKET_GRACE_SECONDS:
            return None

        return MeasurementRouteDecision(
            patient_id=None,
            session_id=session.id,
            routing_status=DeviceMeasurementRoutingStatus.needs_review,
            conflict_metadata={
                "reason": "late_packet_after_session_closed",
                "closed_session_id": str(session.id),
                "closed_session_status": session.status.value,
                "grace_seconds": LATE_PACKET_GRACE_SECONDS,
            },
        )

    def create_session(
        self,
        db: Session,
        *,
        actor: User,
        patient_id: UUID,
        device_id: str,
        measurement_type,
        encounter_id: UUID | None,
        notes: str | None,
        activate_now: bool,
        ip_address: str | None,
    ) -> DeviceExamSession:
        self._get_patient(db, patient_id=patient_id)
        self._assert_actor_can_access_patient(db, actor=actor, patient_id=patient_id, ip_address=ip_address)
        self._validate_encounter(db, encounter_id=encounter_id, patient_id=patient_id)

        now = _now_utc()
        preempted_sessions: list[DeviceExamSession] = []
        session = DeviceExamSession(
            patient_id=patient_id,
            encounter_id=encounter_id,
            device_id=device_id,
            measurement_type=measurement_type,
            status=DeviceExamSessionStatus.active if activate_now else DeviceExamSessionStatus.pending_pair,
            pairing_code=_build_pairing_code(),
            notes=notes,
            started_by=actor.id if activate_now else None,
            started_at=now if activate_now else None,
        )

        self._lock_registered_device(db, device_id=device_id)
        open_sessions = list(
            db.scalars(
                select(DeviceExamSession)
                .where(
                    DeviceExamSession.device_id == device_id,
                    DeviceExamSession.status.in_(OPEN_DEVICE_SESSION_STATUSES),
                )
                .order_by(DeviceExamSession.created_at.desc())
                .with_for_update()
            ).all()
        )
        for existing in open_sessions:
            existing.status = DeviceExamSessionStatus.review_needed
            existing.resolution_reason = DeviceExamSessionResolutionReason.preempted_by_new_session
            existing.ended_by = actor.id
            existing.ended_at = now
            existing.last_seen_at = existing.last_seen_at or now
            db.add(existing)
            preempted_sessions.append(existing)
        db.add(session)
        db.commit()
        db.refresh(session)
        for preempted_session in preempted_sessions:
            publish_device_session_event_sync(
                event_type="device_session.review_needed",
                session=preempted_session,
                extra={"reason": DeviceExamSessionResolutionReason.preempted_by_new_session.value},
            )
        publish_device_session_event_sync(
            event_type="device_session.created",
            session=session,
        )
        return session

    def list_sessions(
        self,
        db: Session,
        *,
        actor: User,
        ip_address: str | None,
        patient_id: UUID | None = None,
        device_id: str | None = None,
        status_filter: DeviceExamSessionStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[DeviceExamSession], int]:
        if actor.role != UserRole.admin:
            if patient_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="patient_id is required when listing sessions as a doctor",
                )
            self._assert_actor_can_access_patient(
                db,
                actor=actor,
                patient_id=patient_id,
                ip_address=ip_address,
            )

        filters = []
        if patient_id is not None:
            filters.append(DeviceExamSession.patient_id == patient_id)
        if device_id is not None:
            filters.append(DeviceExamSession.device_id == device_id)
        if status_filter is not None:
            filters.append(DeviceExamSession.status == status_filter)

        total = db.scalar(select(func.count(DeviceExamSession.id)).where(*filters)) or 0
        items = db.scalars(
            select(DeviceExamSession)
            .where(*filters)
            .order_by(DeviceExamSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        return list(items), int(total)

    def get_session(
        self,
        db: Session,
        *,
        session_id: UUID,
        actor: User | None = None,
        ip_address: str | None = None,
    ) -> DeviceExamSession:
        session = db.scalar(select(DeviceExamSession).where(DeviceExamSession.id == session_id))
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device exam session not found")
        if actor is not None:
            self._assert_actor_can_access_session(
                db,
                actor=actor,
                session=session,
                ip_address=ip_address,
            )
        return session

    def get_active_session_by_device(
        self,
        db: Session,
        *,
        device_id: str,
        actor: User | None = None,
        ip_address: str | None = None,
    ) -> DeviceExamSession:
        session = self._get_latest_open_device_session(db, device_id=device_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No open exam session for device {device_id}",
            )
        if actor is not None:
            self._assert_actor_can_access_session(
                db,
                actor=actor,
                session=session,
                ip_address=ip_address,
            )
        return session

    def resolve_ingest_context(
        self,
        db: Session,
        *,
        device_id: str,
        requested_patient_id: UUID | None,
        requested_session_id: UUID | None,
        measurement_type: DeviceExamMeasurementType,
    ) -> tuple[UUID, UUID | None]:
        decision = self.resolve_measurement_route(
            db,
            device_id=device_id,
            requested_patient_id=requested_patient_id,
            requested_session_id=requested_session_id,
            measurement_type=measurement_type,
            received_at=_now_utc(),
            allow_patient_fallback=True,
            allow_unmatched=False,
        )
        if decision.patient_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"No routable patient context for device {device_id}.",
            )
        return decision.patient_id, decision.session_id

    def _route_measurement_to_session(
        self,
        db: Session,
        *,
        session: DeviceExamSession,
        received_at: datetime,
        measurement_type: DeviceExamMeasurementType,
    ) -> MeasurementRouteDecision:
        if not self._measurement_type_matches(
            session_measurement_type=session.measurement_type,
            requested_measurement_type=measurement_type,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Active device session for {session.device_id} is not configured for "
                    f"{measurement_type.value} ingest."
                ),
            )

        if _is_open_device_session_status(session.status):
            conflict_metadata = self._resolve_transition_conflict_metadata(
                db,
                session=session,
                received_at=received_at,
            )
            if conflict_metadata is not None:
                return MeasurementRouteDecision(
                    patient_id=None,
                    session_id=session.id,
                    routing_status=DeviceMeasurementRoutingStatus.needs_review,
                    conflict_metadata=conflict_metadata,
                )

            self._promote_session_for_ingest(db, session=session, seen_at=received_at)
            return MeasurementRouteDecision(
                patient_id=session.patient_id,
                session_id=session.id,
                routing_status=DeviceMeasurementRoutingStatus.verified,
            )

        if session.status == DeviceExamSessionStatus.review_needed:
            return MeasurementRouteDecision(
                patient_id=None,
                session_id=session.id,
                routing_status=DeviceMeasurementRoutingStatus.needs_review,
                conflict_metadata={
                    "reason": "session_requires_review",
                    "session_id": str(session.id),
                },
            )

        late_packet_decision = self._maybe_route_closed_session_for_review(
            session=session,
            received_at=received_at,
        )
        if late_packet_decision is not None:
            return late_packet_decision

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payload session is not open for ingest.",
        )

    def resolve_measurement_route(
        self,
        db: Session,
        *,
        device_id: str,
        requested_patient_id: UUID | None,
        requested_session_id: UUID | None,
        measurement_type: DeviceExamMeasurementType,
        received_at: datetime,
        allow_patient_fallback: bool,
        allow_unmatched: bool,
    ) -> MeasurementRouteDecision:
        self._get_registered_device(db, device_id=device_id)

        if requested_session_id is not None:
            session = self.get_session(db, session_id=requested_session_id)
            if session.device_id != device_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Payload session does not belong to device {device_id}.",
                )
            if requested_patient_id is not None and requested_patient_id != session.patient_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Payload patient does not match provided session for device {device_id}.",
                )
            return self._route_measurement_to_session(
                db,
                session=session,
                received_at=received_at,
                measurement_type=measurement_type,
            )

        open_session = self._get_latest_open_device_session(db, device_id=device_id)
        if open_session is None:
            if allow_patient_fallback and requested_patient_id is not None:
                return MeasurementRouteDecision(
                    patient_id=requested_patient_id,
                    session_id=None,
                    routing_status=DeviceMeasurementRoutingStatus.verified,
                )
            if allow_unmatched:
                metadata: dict[str, Any] = {"reason": "no_open_session_for_device"}
                if requested_patient_id is not None:
                    metadata["requested_patient_id"] = str(requested_patient_id)
                return MeasurementRouteDecision(
                    patient_id=None,
                    session_id=None,
                    routing_status=DeviceMeasurementRoutingStatus.unmatched,
                    conflict_metadata=metadata,
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No active exam session for device {device_id}. "
                    "Provide user_id in payload or start a device exam session first."
                ),
            )

        if requested_patient_id is not None and requested_patient_id != open_session.patient_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Payload patient does not match active exam session for device {device_id}.",
            )

        return self._route_measurement_to_session(
            db,
            session=open_session,
            received_at=received_at,
            measurement_type=measurement_type,
        )

    def touch_session_last_seen(
        self,
        db: Session,
        *,
        session_id: UUID | None,
        device_id: str | None = None,
        seen_at: datetime | None = None,
    ) -> None:
        resolved_seen_at = seen_at or _now_utc()
        if device_id:
            self._touch_registration_last_seen(db, device_id=device_id, seen_at=resolved_seen_at)
        if session_id is None:
            return
        session = self.get_session(db, session_id=session_id)
        if session.status == DeviceExamSessionStatus.stale:
            session.status = DeviceExamSessionStatus.active
        session.last_seen_at = resolved_seen_at
        db.add(session)

    def activate_session(
        self,
        db: Session,
        *,
        actor: User,
        session_id: UUID,
        ip_address: str | None,
    ) -> DeviceExamSession:
        session = self.get_session(
            db,
            session_id=session_id,
            actor=actor,
            ip_address=ip_address,
        )
        if session.status != DeviceExamSessionStatus.pending_pair:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only pending_pair sessions can be activated",
            )
        existing_active_session = self._get_active_device_session(db, device_id=session.device_id)
        if existing_active_session is not None and existing_active_session.id != session.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device {session.device_id} already has an active exam session",
            )

        session.status = DeviceExamSessionStatus.active
        session.resolution_reason = None
        session.started_by = actor.id
        session.started_at = _now_utc()
        db.add(session)
        db.commit()
        db.refresh(session)
        publish_device_session_event_sync(
            event_type="device_session.activated",
            session=session,
        )
        return session

    def complete_session(
        self,
        db: Session,
        *,
        actor: User,
        session_id: UUID,
        notes: str | None,
        ip_address: str | None,
    ) -> DeviceExamSession:
        session = self.get_session(
            db,
            session_id=session_id,
            actor=actor,
            ip_address=ip_address,
        )
        if session.status not in (
            DeviceExamSessionStatus.active,
            DeviceExamSessionStatus.pending_pair,
            DeviceExamSessionStatus.stale,
            DeviceExamSessionStatus.review_needed,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only open or review_needed sessions can be completed",
            )

        now = _now_utc()
        session.status = DeviceExamSessionStatus.completed
        session.resolution_reason = DeviceExamSessionResolutionReason.manual_complete
        session.ended_by = actor.id
        session.ended_at = now
        session.last_seen_at = now
        if notes is not None:
            session.notes = notes
        db.add(session)
        db.commit()
        db.refresh(session)
        publish_device_session_event_sync(
            event_type="device_session.completed",
            session=session,
        )
        return session

    def cancel_session(
        self,
        db: Session,
        *,
        actor: User,
        session_id: UUID,
        notes: str | None,
        ip_address: str | None,
    ) -> DeviceExamSession:
        session = self.get_session(
            db,
            session_id=session_id,
            actor=actor,
            ip_address=ip_address,
        )
        if session.status in (DeviceExamSessionStatus.completed, DeviceExamSessionStatus.cancelled):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed or cancelled sessions cannot be cancelled again",
            )

        now = _now_utc()
        session.status = DeviceExamSessionStatus.cancelled
        session.resolution_reason = DeviceExamSessionResolutionReason.cancelled
        session.ended_by = actor.id
        session.ended_at = now
        if notes is not None:
            session.notes = notes
        db.add(session)
        db.commit()
        db.refresh(session)
        publish_device_session_event_sync(
            event_type="device_session.cancelled",
            session=session,
        )
        return session

    def record_heartbeat(
        self,
        db: Session,
        *,
        session_id: UUID,
        actor: User,
        ip_address: str | None,
    ) -> DeviceExamSession:
        now = _now_utc()
        session = self.get_session(
            db,
            session_id=session_id,
            actor=actor,
            ip_address=ip_address,
        )
        if session.status not in (DeviceExamSessionStatus.active, DeviceExamSessionStatus.stale):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only active or stale sessions can receive heartbeat updates",
            )
        if session.status == DeviceExamSessionStatus.stale:
            session.status = DeviceExamSessionStatus.active
        session.last_seen_at = now
        db.add(session)
        self._touch_registration_last_seen(db, device_id=session.device_id, seen_at=now)
        db.commit()
        db.refresh(session)
        publish_device_session_event_sync(
            event_type="device_session.heartbeat",
            session=session,
        )
        return session

    def record_device_heartbeat(
        self,
        db: Session,
        *,
        session_id: UUID,
        device_id: str,
    ) -> DeviceExamSession:
        now = _now_utc()
        session = self.get_session(db, session_id=session_id)
        if session.device_id != device_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Session {session_id} does not belong to device {device_id}",
            )
        if session.status not in (DeviceExamSessionStatus.active, DeviceExamSessionStatus.stale):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only active or stale sessions can receive heartbeat updates",
            )
        if session.status == DeviceExamSessionStatus.stale:
            session.status = DeviceExamSessionStatus.active
        session.last_seen_at = now
        db.add(session)
        self._touch_registration_last_seen(db, device_id=device_id, seen_at=now)
        db.commit()
        db.refresh(session)
        publish_device_session_event_sync(
            event_type="device_session.heartbeat",
            session=session,
            extra={"source": "device_heartbeat"},
        )
        return session

    def mark_stale_sessions(self, db: Session, *, now: datetime | None = None) -> int:
        reference_time = now or _now_utc()
        updated = 0
        for session in db.scalars(
            select(DeviceExamSession).where(DeviceExamSession.status == DeviceExamSessionStatus.active)
        ).all():
            if session.last_seen_at is None:
                continue
            last_seen_at = session.last_seen_at if session.last_seen_at.tzinfo else session.last_seen_at.replace(tzinfo=timezone.utc)
            if (reference_time - last_seen_at).total_seconds() < STALE_THRESHOLD_SECONDS:
                continue
            session.status = DeviceExamSessionStatus.stale
            db.add(session)
            updated += 1
        if updated:
            db.commit()
        return updated

    def auto_complete_sessions(self, db: Session, *, now: datetime | None = None) -> int:
        reference_time = now or _now_utc()
        updated = 0
        for session in db.scalars(
            select(DeviceExamSession).where(DeviceExamSession.status.in_(OPEN_DEVICE_SESSION_STATUSES))
        ).all():
            pivot = session.last_seen_at or session.started_at or session.created_at
            if pivot.tzinfo is None:
                pivot = pivot.replace(tzinfo=timezone.utc)
            if (reference_time - pivot).total_seconds() < AUTO_CLOSE_TIMEOUT_SECONDS:
                continue
            session.status = DeviceExamSessionStatus.completed
            session.resolution_reason = DeviceExamSessionResolutionReason.timeout
            session.ended_at = reference_time
            session.last_seen_at = session.last_seen_at or reference_time
            db.add(session)
            updated += 1
        if updated:
            db.commit()
        return updated


device_exam_session_service = DeviceExamSessionService()
