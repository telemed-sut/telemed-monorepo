export type MeetingCallTestProfile = {
  id: string;
  title: string;
  networkCondition: string;
  focus: string;
  expectedResult: string;
};

export type MeetingCallDiagnosticsEvent = {
  at: string;
  tone: string;
  message: string;
};

export type MeetingCallDiagnosticsSnapshot = {
  meeting_status: string;
  meeting_status_before_reconcile: string;
  meeting_status_reconciled: boolean;
  active_status_projection: string;
  room_presence_state: string;
  doctor_online: boolean;
  patient_online: boolean;
  doctor_last_seen_age_seconds?: number | null;
  patient_last_seen_age_seconds?: number | null;
  heartbeat_timeout_seconds: number;
};

export const MEETING_CALL_TEST_PROFILES: MeetingCallTestProfile[] = [
  {
    id: "patient-low-bandwidth",
    title: "Patient low bandwidth",
    networkCondition: "Patient side: low bandwidth for 2 minutes",
    focus: "Audio should survive before video quality drops.",
    expectedResult: "Call stays active, UI shows degraded state, backend presence remains aligned.",
  },
  {
    id: "patient-short-drop",
    title: "Patient short disconnect",
    networkCondition: "Patient side: full disconnect for 5-10 seconds",
    focus: "Auto recovery path",
    expectedResult: "Client enters reconnecting, recovers without restarting the visit, backend returns to in_progress.",
  },
  {
    id: "patient-long-drop",
    title: "Patient long disconnect",
    networkCondition: "Patient side: full disconnect for 30-60 seconds",
    focus: "Manual rejoin path",
    expectedResult: "Client reaches rejoin required, rejoin succeeds, backend reconciles waiting -> in_progress.",
  },
  {
    id: "doctor-offline",
    title: "Doctor network loss",
    networkCondition: "Doctor browser offline or heartbeat failures",
    focus: "Doctor presence accuracy",
    expectedResult: "Backend snapshot exposes stale doctor presence and the doctor can recover through rejoin.",
  },
  {
    id: "dual-instability",
    title: "Both sides unstable",
    networkCondition: "Latency + packet loss on doctor and patient at the same time",
    focus: "Status reconciliation under heavy churn",
    expectedResult: "Control panel events, backend snapshot, and visible UI stay consistent enough to debug safely.",
  },
];

type BuildMeetingCallDiagnosticsReportParams = {
  generatedAt: string;
  meetingId: string;
  selectedProfile?: MeetingCallTestProfile | null;
  runStartedAt?: string | null;
  runFinishedAt?: string | null;
  qaNotes?: string | null;
  callHealth: string;
  callHealthDetail?: string | null;
  callNotice?: string | null;
  diagnosticsEvents: MeetingCallDiagnosticsEvent[];
  reliabilitySnapshot?: MeetingCallDiagnosticsSnapshot | null;
};

export function buildMeetingCallDiagnosticsReport(
  params: BuildMeetingCallDiagnosticsReportParams
): string {
  const lines = [
    "Meeting Call Diagnostics",
    `Generated at: ${params.generatedAt}`,
    `Meeting ID: ${params.meetingId}`,
    `Run started at: ${params.runStartedAt ?? "-"}`,
    `Run finished at: ${params.runFinishedAt ?? "-"}`,
    `Call health: ${params.callHealth}`,
    `Call detail: ${params.callHealthDetail ?? "-"}`,
    `Call notice: ${params.callNotice ?? "-"}`,
  ];

  if (params.selectedProfile) {
    lines.push(
      "",
      "Selected test profile",
      `- ${params.selectedProfile.title}`,
      `- Condition: ${params.selectedProfile.networkCondition}`,
      `- Focus: ${params.selectedProfile.focus}`,
      `- Expected: ${params.selectedProfile.expectedResult}`
    );
  }

  if (params.reliabilitySnapshot) {
    const snapshot = params.reliabilitySnapshot;
    lines.push(
      "",
      "Backend reliability snapshot",
      `- Meeting status: ${snapshot.meeting_status}`,
      `- Status before reconcile: ${snapshot.meeting_status_before_reconcile}`,
      `- Status reconciled: ${snapshot.meeting_status_reconciled ? "yes" : "no"}`,
      `- Active projection: ${snapshot.active_status_projection}`,
      `- Room presence: ${snapshot.room_presence_state}`,
      `- Doctor online: ${snapshot.doctor_online ? "yes" : "no"}`,
      `- Patient online: ${snapshot.patient_online ? "yes" : "no"}`,
      `- Doctor last seen age (s): ${snapshot.doctor_last_seen_age_seconds ?? "-"}`,
      `- Patient last seen age (s): ${snapshot.patient_last_seen_age_seconds ?? "-"}`,
      `- Heartbeat timeout (s): ${snapshot.heartbeat_timeout_seconds}`
    );
  }

  lines.push("", "QA notes", params.qaNotes?.trim() ? params.qaNotes.trim() : "-");

  lines.push("", "Recent call events");
  if (params.diagnosticsEvents.length === 0) {
    lines.push("- none");
  } else {
    for (const event of params.diagnosticsEvents) {
      lines.push(`- [${event.at}] (${event.tone}) ${event.message}`);
    }
  }

  return lines.join("\n");
}
