import { apiFetch, appendPagination } from "./api-client";
import { fetchAllPages } from "./api-fetch-all";
import type {
  FetchMeetingsParams,
  Meeting,
  MeetingCreatePayload,
  MeetingListResponse,
  MeetingPatientInviteResponse,
  MeetingPatientPresencePayload,
  MeetingReliabilitySnapshot,
  MeetingRoomPresence,
  MeetingUpdatePayload,
  MeetingVideoTokenResponse,
} from "./api-types";

interface FetchAllOptions {
  pageSize?: number;
  maxItems?: number;
}

export async function fetchMeetings(params: FetchMeetingsParams, token: string) {
  const search = new URLSearchParams();
  appendPagination(search, params);
  if (params.q) search.set("q", params.q);
  if (params.doctor_id) search.set("doctor_id", params.doctor_id);
  if (params.patient_id) search.set("patient_id", params.patient_id);
  if (params.status) search.set("status", params.status);
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);

  const qs = search.toString();
  const path = `/meetings${qs ? `?${qs}` : ""}`;
  return apiFetch<MeetingListResponse>(path, { method: "GET" }, token);
}

export async function fetchAllMeetings(
  params: Omit<FetchMeetingsParams, "page" | "limit">,
  token: string,
  options: FetchAllOptions = {}
) {
  return fetchAllPages<Meeting>(
    ({ page, limit }) => fetchMeetings({ ...params, page, limit }, token),
    options,
  );
}

export async function createMeeting(payload: MeetingCreatePayload, token: string) {
  return apiFetch<Meeting>(
    "/meetings",
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export async function updateMeeting(id: string, payload: MeetingUpdatePayload, token: string) {
  return apiFetch<Meeting>(
    `/meetings/${id}`,
    { method: "PUT", body: JSON.stringify(payload) },
    token
  );
}

export async function deleteMeeting(id: string, token: string) {
  return apiFetch<void>(
    `/meetings/${id}`,
    { method: "DELETE" },
    token
  );
}

export async function issueMeetingVideoToken(
  meetingId: string,
  token: string,
  expiresInSeconds?: number
) {
  return apiFetch<MeetingVideoTokenResponse>(
    `/meetings/${meetingId}/video/token`,
    {
      method: "POST",
      body: JSON.stringify(
        typeof expiresInSeconds === "number"
          ? { expires_in_seconds: expiresInSeconds }
          : {}
      ),
    },
    token
  );
}

export async function createMeetingPatientInvite(
  meetingId: string,
  token: string,
  expiresInSeconds?: number
) {
  return apiFetch<MeetingPatientInviteResponse>(
    `/meetings/${meetingId}/video/patient-invite`,
    {
      method: "POST",
      body: JSON.stringify(
        typeof expiresInSeconds === "number"
          ? { expires_in_seconds: expiresInSeconds }
          : {}
      ),
    },
    token
  );
}

export async function issuePatientMeetingVideoToken(params: {
  meetingId?: string;
  inviteToken?: string;
  shortCode?: string;
  expiresInSeconds?: number;
}) {
  const body: Record<string, unknown> = {};
  if (params.meetingId) {
    body.meeting_id = params.meetingId;
  }
  if (params.inviteToken) {
    body.invite_token = params.inviteToken;
  }
  if (params.shortCode) {
    body.short_code = params.shortCode;
  }
  if (typeof params.expiresInSeconds === "number") {
    body.expires_in_seconds = params.expiresInSeconds;
  }

  return apiFetch<MeetingVideoTokenResponse>(
    "/meetings/video/patient/token",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function heartbeatDoctorMeetingPresence(
  meetingId: string,
  token: string
) {
  return apiFetch<MeetingRoomPresence>(
    `/meetings/${meetingId}/video/presence/heartbeat`,
    { method: "POST", body: JSON.stringify({}) },
    token
  );
}

export async function fetchMeetingReliabilitySnapshot(
  meetingId: string,
  token: string
) {
  return apiFetch<MeetingReliabilitySnapshot>(
    `/meetings/${meetingId}/video/reliability`,
    { method: "GET" },
    token
  );
}

export async function leaveDoctorMeetingPresence(
  meetingId: string,
  token: string
) {
  return apiFetch<MeetingRoomPresence>(
    `/meetings/${meetingId}/video/presence/leave`,
    { method: "POST", body: JSON.stringify({}) },
    token
  );
}

function buildPatientPresenceBody(params: MeetingPatientPresencePayload) {
  const body: Record<string, unknown> = {};
  if (params.meetingId) body.meeting_id = params.meetingId;
  if (params.inviteToken) body.invite_token = params.inviteToken;
  if (params.shortCode) body.short_code = params.shortCode;
  return body;
}

export async function heartbeatPatientMeetingPresence(
  params: MeetingPatientPresencePayload
) {
  return apiFetch<MeetingRoomPresence>(
    "/meetings/video/patient/presence/heartbeat",
    {
      method: "POST",
      body: JSON.stringify(buildPatientPresenceBody(params)),
    }
  );
}

export async function leavePatientMeetingPresence(
  params: MeetingPatientPresencePayload
) {
  return apiFetch<MeetingRoomPresence>(
    "/meetings/video/patient/presence/leave",
    {
      method: "POST",
      body: JSON.stringify(buildPatientPresenceBody(params)),
    }
  );
}
