import { describe, expect, it } from "vitest";

import type { Meeting } from "@/lib/api";
import { getPresenceAwareStatus } from "@/components/dashboard/meeting-presence";

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "meeting-1",
    date_time: "2026-03-17T10:00:00.000Z",
    status: "scheduled",
    description: null,
    doctor_id: null,
    note: null,
    room: null,
    user_id: null,
    created_at: "2026-03-17T09:00:00.000Z",
    updated_at: "2026-03-17T09:00:00.000Z",
    doctor: null,
    patient: null,
    room_presence: null,
    ...overrides,
  };
}

describe("meeting presence helpers", () => {
  it("treats both participants in room as in progress", () => {
    const meeting = buildMeeting({
      status: "scheduled",
      room_presence: {
        meeting_id: "meeting-1",
        state: "both_in_room",
        doctor_online: true,
        patient_online: true,
      },
    });

    expect(getPresenceAwareStatus(meeting)).toBe("in_progress");
  });

  it("demotes stale waiting status when presence shows nobody waiting", () => {
    const meeting = buildMeeting({
      status: "waiting",
      room_presence: {
        meeting_id: "meeting-1",
        state: "none",
        doctor_online: false,
        patient_online: false,
      },
    });

    expect(getPresenceAwareStatus(meeting)).toBe("scheduled");
  });

  it("demotes stale in-progress status when only the doctor heartbeat remains", () => {
    const meeting = buildMeeting({
      status: "in_progress",
      room_presence: {
        meeting_id: "meeting-1",
        state: "doctor_only",
        doctor_online: true,
        patient_online: false,
      },
    });

    expect(getPresenceAwareStatus(meeting)).toBe("scheduled");
  });
});
