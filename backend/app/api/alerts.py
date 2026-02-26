from datetime import datetime, timezone
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.models.alert import Alert
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.alert import AlertAcknowledge
from app.services import audit as audit_service
from app.services.auth import get_db, get_doctor_user, _has_active_assignment
from app.core.request_utils import get_client_ip

router = APIRouter(prefix="/alerts", tags=["alerts"])
logger = logging.getLogger(__name__)


@router.post("/{alert_id}/acknowledge", status_code=status.HTTP_200_OK)
@limiter.limit("30/minute")
def acknowledge_alert(
    request: Request,
    alert_id: UUID,
    payload: AlertAcknowledge,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_doctor_user),
):
    """Acknowledge a clinical alert. User must be assigned to the alert's patient."""
    alert = db.scalar(select(Alert).where(Alert.id == alert_id))
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.is_acknowledged:
        raise HTTPException(status_code=400, detail="Alert already acknowledged")

    # Verify user-patient relationship (admin bypass only)
    if current_user.role != UserRole.admin:
        patient_id = alert.patient_id
        if not _has_active_assignment(db, current_user.id, patient_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this patient. Contact admin to assign access.",
            )

    alert.is_acknowledged = True
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.add(alert)
    db.commit()

    audit_service.log_action(
        db,
        current_user.id,
        "acknowledge_alert",
        resource_type="alert",
        resource_id=alert_id,
        details={"reason": payload.reason},
        ip_address=get_client_ip(request),
        status="success",
    )
    logger.info(
        "Alert acknowledged: alert=%s actor_id=%s reason=%s",
        alert_id,
        current_user.id,
        payload.reason or "none",
    )
    return {"message": "Alert acknowledged", "alert_id": str(alert_id)}
