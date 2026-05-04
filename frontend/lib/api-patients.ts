import { apiFetch, appendPagination, invalidateCache } from "./api-client";
import { fetchAllPages } from "./api-fetch-all";
import type {
  ActiveMedication,
  BulkDeletePatientsResponse,
  FetchPatientsParams,
  HeartSoundListResponse,
  HeartSoundRecord,
  HeartSoundUploadSession,
  LabTrendPoint,
  NoteCreatePayload,
  OrderCreatePayload,
  Patient,
  PatientAssignment,
  PatientAssignmentListResponse,
  PatientAssignmentRole,
  PatientContactDetails,
  PatientDenseSummary,
  PatientListResponse,
  PressureListResponse,
  PatientRegistrationCodeResponse,
  PatientWardListResponse,
  PendingLab,
  TimelineEvent,
  TimelineResponse,
  UploadPatientHeartSoundPayload,
  PatientVitalsTrendResponse,
} from "./api-types";

interface FetchAllOptions {
  pageSize?: number;
  maxItems?: number;
}

const AZURE_DIRECT_UPLOAD_CORS_ERROR =
  "Azure Blob Storage blocked the browser upload. Allow this frontend origin in Blob Storage CORS and try again.";

export async function fetchPatients(params: FetchPatientsParams, token: string) {
  const search = new URLSearchParams();
  appendPagination(search, params);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);

  const qs = search.toString();
  const path = `/patients${qs ? `?${qs}` : ""}`;
  return apiFetch<PatientListResponse>(path, { method: "GET" }, token);
}

export async function fetchAllPatients(
  params: Omit<FetchPatientsParams, "page" | "limit">,
  token: string,
  options: FetchAllOptions = {}
) {
  return fetchAllPages<Patient>(
    ({ page, limit }) => fetchPatients({ ...params, page, limit }, token),
    options,
  );
}

export async function fetchPatientWards(token: string) {
  return apiFetch<PatientWardListResponse>(
    "/patients/wards",
    { method: "GET" },
    token
  );
}

export async function createPatient(payload: Omit<Patient, "id">, token: string) {
  return apiFetch<Patient>(
    "/patients",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function updatePatient(id: string, payload: Partial<Patient>, token: string) {
  return apiFetch<Patient>(
    `/patients/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function deletePatient(id: string, token: string) {
  return apiFetch<void>(
    `/patients/${id}`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function fetchPatient(id: string, token: string) {
  return apiFetch<Patient>(`/patients/${id}`, { method: "GET" }, token);
}

export async function fetchPatientContactDetails(id: string, token: string) {
  return apiFetch<PatientContactDetails>(`/patients/${id}/contact`, { method: "GET" }, token);
}

export async function fetchPatientHeartSounds(patientId: string, token: string) {
  return apiFetch<HeartSoundListResponse>(
    `/patients/${patientId}/heart-sounds`,
    { method: "GET" },
    token
  );
}

export async function fetchPatientPressureReadings(patientId: string, token: string) {
  return apiFetch<PressureListResponse>(
    `/patients/${patientId}/pressure-readings?limit=10&offset=0`,
    { method: "GET", skipCache: true },
    token
  );
}

export async function uploadPatientHeartSound(
  patientId: string,
  payload: UploadPatientHeartSoundPayload,
  token: string
) {
  const uploadSession = await apiFetch<HeartSoundUploadSession>(
    `/patients/${patientId}/heart-sounds/upload-session`,
    {
      method: "POST",
      body: JSON.stringify({
        filename: payload.file.name,
        position: payload.position,
        file_size_bytes: payload.file.size,
        mime_type: payload.file.type || "application/octet-stream",
        recorded_at: payload.recorded_at ?? null,
      }),
      skipCache: true,
    },
    token
  );

  let uploadResponse: Response;
  try {
    // When using local proxy upload, we need to send the session cookie
    // to authenticate with our own backend. Azure ignores these headers,
    // so it's safe to include for both cases when the URL is relative.
    const isLocalProxy = uploadSession.upload_url.startsWith("/") || uploadSession.upload_url.includes(window.location.host);

    uploadResponse = await fetch(uploadSession.upload_url, {
      method: "PUT",
      headers: uploadSession.upload_headers,
      body: payload.file,
      credentials: isLocalProxy ? "include" : "same-origin",
    });
  } catch {
    throw new Error(AZURE_DIRECT_UPLOAD_CORS_ERROR);
  }

  if (!uploadResponse.ok) {
    const responseText = await uploadResponse.text().catch(() => "");
    if (
      uploadResponse.status === 403 &&
      /cors|corspreflightfailure|no matching rule/i.test(responseText)
    ) {
      throw new Error(AZURE_DIRECT_UPLOAD_CORS_ERROR);
    }
    throw new Error("Unable to upload the file directly to Azure Blob Storage.");
  }

  const response = await apiFetch<HeartSoundRecord>(
    `/patients/${patientId}/heart-sounds/complete-upload`,
    {
      method: "POST",
      body: JSON.stringify({
        session_id: uploadSession.session_id,
      }),
      skipCache: true,
    },
    token
  );
  invalidateCache(`/patients/${patientId}/heart-sounds`);
  return response;
}

export async function fetchPatientAssignments(patientId: string, token: string) {
  return apiFetch<PatientAssignmentListResponse>(
    `/patients/${patientId}/assignments`,
    { method: "GET" },
    token
  );
}

export async function createPatientAssignment(
  patientId: string,
  payload: { doctor_id: string; role?: PatientAssignmentRole },
  token: string
) {
  return apiFetch<PatientAssignment>(
    `/patients/${patientId}/assignments`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export async function updatePatientAssignment(
  patientId: string,
  assignmentId: string,
  payload: { role: PatientAssignmentRole },
  token: string
) {
  return apiFetch<PatientAssignment>(
    `/patients/${patientId}/assignments/${assignmentId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token
  );
}

export async function deletePatientAssignment(
  patientId: string,
  assignmentId: string,
  token: string
) {
  return apiFetch<void>(
    `/patients/${patientId}/assignments/${assignmentId}`,
    { method: "DELETE" },
    token
  );
}

export async function fetchPatientSummary(patientId: string, token: string) {
  return apiFetch<PatientDenseSummary>(`/patients/${patientId}/summary`, { method: "GET" }, token);
}

export async function fetchPatientTimeline(patientId: string, token: string, cursor?: string, limit?: number) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", limit.toString());
  const qs = params.toString();
  return apiFetch<TimelineResponse>(`/patients/${patientId}/timeline${qs ? `?${qs}` : ""}`, { method: "GET" }, token);
}

export async function fetchActiveOrders(patientId: string, token: string) {
  return apiFetch<{ medications: ActiveMedication[]; labs: PendingLab[] }>(
    `/patients/${patientId}/active-orders`,
    { method: "GET" },
    token
  );
}

export async function fetchLabTrends(patientId: string, token: string, testName?: string) {
  const params = new URLSearchParams();
  if (testName) params.set("test_name", testName);
  const qs = params.toString();
  return apiFetch<{ results: LabTrendPoint[] }>(
    `/patients/${patientId}/results/trends${qs ? `?${qs}` : ""}`,
    { method: "GET" },
    token
  );
}

export async function createOrder(patientId: string, payload: OrderCreatePayload, token: string) {
  return apiFetch<ActiveMedication | PendingLab>(
    `/patients/${patientId}/orders`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export async function createNote(patientId: string, payload: NoteCreatePayload, token: string) {
  return apiFetch<TimelineEvent>(
    `/patients/${patientId}/notes`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}

export async function acknowledgeAlert(alertId: string, token: string, reason?: string) {
  return apiFetch<{ message: string }>(
    `/alerts/${alertId}/acknowledge`,
    { method: "POST", body: JSON.stringify({ reason }) },
    token
  );
}

export async function breakGlassAccess(patientId: string, reason: string, token: string) {
  return apiFetch<PatientDenseSummary>(
    `/patients/${patientId}/break-glass`,
    { method: "POST", body: JSON.stringify({ reason }) },
    token
  );
}

export async function bulkDeletePatients(ids: string[], token: string) {
  return apiFetch<BulkDeletePatientsResponse>(
    "/patients/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) },
    token,
  );
}

export async function generatePatientRegistrationCode(
  patientId: string,
  token: string,
): Promise<PatientRegistrationCodeResponse> {
  return apiFetch<PatientRegistrationCodeResponse>(
    `/patient-app/${patientId}/code`,
    { method: "POST" },
    token,
  );
}

export async function fetchPatientVitalsTrends(patientId: string, days: number, token: string) {
  return apiFetch<PatientVitalsTrendResponse>(
    `/patients/${patientId}/trends/vitals?days=${days}`,
    { method: "GET" },
    token
  );
}
