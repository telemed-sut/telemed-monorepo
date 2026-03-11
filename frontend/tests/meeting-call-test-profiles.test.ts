import { describe, expect, it } from "vitest";

import {
  MEETING_CALL_TEST_PROFILES,
  buildMeetingCallDiagnosticsReport,
} from "@/lib/meeting-call-test-profiles";

describe("meeting call test profiles", () => {
  it("exposes repeatable profiles for call QA", () => {
    expect(MEETING_CALL_TEST_PROFILES.length).toBeGreaterThanOrEqual(5);
    expect(MEETING_CALL_TEST_PROFILES[0]).toHaveProperty("networkCondition");
    expect(MEETING_CALL_TEST_PROFILES[0]).toHaveProperty("expectedResult");
  });

  it("builds a diagnostics report with selected profile and events", () => {
    const report = buildMeetingCallDiagnosticsReport({
      generatedAt: "2026-03-11T10:00:00Z",
      meetingId: "meeting-123",
      selectedProfile: MEETING_CALL_TEST_PROFILES[0],
      runStartedAt: "2026-03-11T09:55:00Z",
      runFinishedAt: "2026-03-11T10:05:00Z",
      qaNotes: "Observed delayed backend reconciliation once.",
      callHealth: "reconnecting",
      callHealthDetail: "Room presence heartbeat is failing.",
      callNotice: "Patient stream timed out.",
      reliabilitySnapshot: {
        meeting_status: "waiting",
        meeting_status_before_reconcile: "in_progress",
        meeting_status_reconciled: true,
        active_status_projection: "waiting",
        room_presence_state: "doctor_left_patient_waiting",
        doctor_online: false,
        patient_online: true,
        doctor_last_seen_age_seconds: 32,
        patient_last_seen_age_seconds: 4,
        heartbeat_timeout_seconds: 25,
      },
      diagnosticsEvents: [
        {
          at: "10:00:05",
          tone: "warning",
          message: "Room presence heartbeat is failing.",
        },
      ],
    });

    expect(report).toContain("Meeting Call Diagnostics");
    expect(report).toContain("Patient low bandwidth");
    expect(report).toContain("Status reconciled: yes");
    expect(report).toContain("Room presence heartbeat is failing.");
    expect(report).toContain("Observed delayed backend reconciliation once.");
  });
});
