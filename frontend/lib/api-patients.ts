import { apiFetch, appendPagination, clampLimit, MAX_QUERY_LIMIT } from "./api-client";
import type {
  ActiveMedication,
  BulkDeletePatientsResponse,
  FetchPatientsParams,
  HeartSoundListResponse,
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
  PatientRegistrationCodeResponse,
  PendingLab,
  TimelineEvent,
  TimelineResponse,
} from "./api-types";

interface FetchAllOptions {
  pageSize?: number;
  maxItems?: number;
}

const BULK_FETCH_DEFAULT_PAGE_SIZE = 200;
const BULK_FETCH_DEFAULT_MAX_ITEMS = 5000;

function normalizeMaxItems(maxItems?: number): number {
  if (!Number.isFinite(maxItems)) return BULK_FETCH_DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.floor(maxItems as number));
}

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
  const pageSize = clampLimit(options.pageSize ?? BULK_FETCH_DEFAULT_PAGE_SIZE, MAX_QUERY_LIMIT);
  const maxItems = normalizeMaxItems(options.maxItems);
  const maxPages = Math.ceil(maxItems / pageSize);
  const items: Patient[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchPatients({ ...params, page, limit: pageSize }, token);
    if (res.items.length === 0) break;

    const remaining = maxItems - items.length;
    items.push(...res.items.slice(0, remaining));
    if (items.length >= res.total || res.items.length < pageSize || items.length >= maxItems) {
      break;
    }
  }

  return items;
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
