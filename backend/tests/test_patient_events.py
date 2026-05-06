import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.services import patient_events


@pytest.mark.anyio
async def test_patient_event_hub_delivers_only_matching_patient_events():
    hub = patient_events.PatientEventHub()
    patient_id = uuid4()
    other_patient_id = uuid4()

    queue = await hub.subscribe(patient_id)
    try:
        await hub.publish(
            patient_events.build_patient_event(
                patient_id=other_patient_id,
                event_type="new_patient_screening",
            )
        )
        assert queue.empty()

        event = patient_events.build_patient_event(
            patient_id=patient_id,
            event_type="new_patient_screening",
            recorded_at=datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc),
            data={"screening_id": "screening-1"},
        )
        await hub.publish(event)

        received = await asyncio.wait_for(queue.get(), timeout=1)
        assert received == event
    finally:
        await hub.unsubscribe(patient_id, queue)
