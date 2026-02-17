export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ForgotPasswordResponse {
  message: string;
  reset_token?: string | null;
}

export interface UserInviteCreateResponse {
  invite_url: string;
  expires_at: string;
}

export interface InviteInfoResponse {
  email: string;
  role: string;
  expires_at: string;
}

export interface UserMe {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  verification_status?: string | null;
}

// ── Role Constants ──────────────────────────────────────────

export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
  { value: "doctor", label: "Doctor" },
  { value: "nurse", label: "Nurse" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "medical_technologist", label: "Medical Technologist" },
  { value: "psychologist", label: "Psychologist" },
] as const;

export const ROLE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
);

/** Roles that are considered clinical (require license verification) */
export const CLINICAL_ROLES = new Set([
  "doctor", "nurse", "pharmacist", "medical_technologist", "psychologist",
]);

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PatientListResponse {
  items: Patient[];
  page: number;
  limit: number;
  total: number;
}

type SortOrder = "asc" | "desc";

// Use environment variable for API URL or default to localhost:8000
// In production/tunnel, if deployed on same domain, use relative path
const API_BASE_URL = (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000");
type ApiError = Error & { status?: number };

// Token refresh state to prevent multiple simultaneous refresh calls
let refreshPromise: Promise<string | null> | null = null;

/** Check if a JWT token is expiring within the given buffer (seconds). */
function isTokenExpiring(token: string, bufferSeconds = 300): boolean {
  try {
    // Decode payload without verification (just need exp)
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp - now < bufferSeconds;
  } catch {
    return false;
  }
}

async function rawFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<{ ok: boolean; status: number; data: T | null; error?: ApiError }> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err) {
    const error: ApiError = new Error(
      err instanceof TypeError ? `Network error: ${err.message}` : "Network request failed"
    );
    error.status = 0;
    return { ok: false, status: 0, data: null, error };
  }

  // Handle 204 No Content (e.g. DELETE responses)
  if (res.status === 204) {
    return { ok: true, status: 204, data: null as T };
  }

  const contentLength = res.headers.get("content-length");
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const hasBody = contentLength !== "0" && contentLength !== null ? true : isJson;

  let data: any = null;
  if (hasBody && isJson) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const msgData = data?.detail || data?.message || res.statusText;
    const message = typeof msgData === 'object' ? JSON.stringify(msgData) : msgData;
    const error: ApiError = new Error(message || "Request failed");
    error.status = res.status;
    return { ok: false, status: res.status, data: null, error };
  }

  return { ok: true, status: res.status, data: data as T };
}

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let activeToken = token;

  // Proactive refresh: if token is about to expire, refresh before making the request
  if (activeToken && path !== "/auth/refresh" && path !== "/auth/login" && isTokenExpiring(activeToken)) {
    const refreshed = await tryRefreshToken(activeToken);
    if (refreshed) {
      activeToken = refreshed;
    }
  }

  const result = await rawFetch<T>(path, options, activeToken);

  if (result.ok) return result.data as T;

  // If 401 and we have a token, try to refresh
  if (result.status === 401 && activeToken && path !== "/auth/refresh" && path !== "/auth/login") {
    const newToken = await tryRefreshToken(activeToken);
    if (newToken) {
      // Retry the original request with the new token
      const retry = await rawFetch<T>(path, options, newToken);
      if (retry.ok) return retry.data as T;
      if (retry.error) throw retry.error;
    }
    // Refresh failed — force logout
    forceLogout();
  }

  throw result.error!;
}

/** Refresh the token using the /auth/refresh endpoint */
export async function refreshToken(token: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/refresh", { method: "POST" }, token);
}

/** Force logout: clear token and redirect to login. */
function forceLogout() {
  // Dynamic import to avoid circular dependency
  import("@/store/auth-store").then(({ useAuthStore }) => {
    useAuthStore.getState().clearToken();
  });
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

/** Try to refresh the token, updating the auth store. Deduplicates concurrent calls. */
async function tryRefreshToken(currentToken: string): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      // Dynamic import to avoid circular dependency
      const { useAuthStore } = await import("@/store/auth-store");
      const res = await rawFetch<LoginResponse>("/auth/refresh", { method: "POST" }, currentToken);
      if (res.ok && res.data?.access_token) {
        useAuthStore.getState().setToken(res.data.access_token);
        return res.data.access_token;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function login(email: string, password: string) {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function requestPasswordReset(email: string) {
  return apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  return apiFetch<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export async function getInviteInfo(token: string) {
  return apiFetch<InviteInfoResponse>(`/auth/invite/${token}`, {
    method: "GET",
  });
}

export async function acceptInvite(token: string, payload: { first_name?: string; last_name?: string; password: string; license_no?: string }) {
  return apiFetch<{ message: string }>("/auth/invite/accept", {
    method: "POST",
    body: JSON.stringify({ token, ...payload }),
  });
}

export async function fetchCurrentUser(token: string) {
  return apiFetch<UserMe>("/auth/me", {}, token);
}

interface FetchPatientsParams {
  page?: number;
  limit?: number;
  q?: string;
  sort?: string;
  order?: SortOrder;
}

export async function fetchPatients(params: FetchPatientsParams, token: string) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", params.page.toString());
  if (params.limit) search.set("limit", params.limit.toString());
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);

  const qs = search.toString();
  const path = `/patients${qs ? `?${qs}` : ""}`;
  return apiFetch<PatientListResponse>(path, { method: "GET" }, token);
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

// ── Meetings ──────────────────────────────────────────

export const MEETING_STATUSES = [
  "scheduled",
  "waiting",
  "in_progress",
  "overtime",
  "completed",
  "cancelled",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  waiting: "Waiting",
  in_progress: "In Progress",
  overtime: "Overtime",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MEETING_STATUS_LABELS_TH: Record<MeetingStatus, string> = {
  scheduled: "นัดหมายแล้ว",
  waiting: "รอพบแพทย์",
  in_progress: "กำลังตรวจ",
  overtime: "เกินเวลา",
  completed: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};

export interface DoctorBrief {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PatientBrief {
  id: string;
  first_name: string;
  last_name: string;
  people_id?: string | null;
}

export interface Meeting {
  id: string;
  date_time: string;
  description?: string | null;
  doctor_id?: string | null;
  note?: string | null;
  room?: string | null;
  user_id?: string | null;
  status: MeetingStatus;
  reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  created_at?: string;
  updated_at?: string;
  doctor?: DoctorBrief | null;
  patient?: PatientBrief | null;
}

export interface MeetingListResponse {
  items: Meeting[];
  page: number;
  limit: number;
  total: number;
}

interface FetchMeetingsParams {
  page?: number;
  limit?: number;
  q?: string;
  doctor_id?: string;
  patient_id?: string;
  status?: MeetingStatus;
  sort?: string;
  order?: SortOrder;
}

export async function fetchMeetings(params: FetchMeetingsParams, token: string) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", params.page.toString());
  if (params.limit) search.set("limit", params.limit.toString());
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

export interface MeetingCreatePayload {
  date_time: string;
  description?: string;
  doctor_id: string;
  note?: string;
  room?: string;
  user_id: string;
  status?: MeetingStatus;
}

export interface MeetingUpdatePayload {
  date_time?: string;
  description?: string;
  doctor_id?: string;
  note?: string;
  room?: string;
  user_id?: string;
  status?: MeetingStatus;
  reason?: string;
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

// User Management API

export interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  specialty?: string | null;
  department?: string | null;
  license_no?: string | null;
  license_expiry?: string | null;
  verification_status?: string | null;
}

export interface UserCreate {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
  specialty?: string;
  department?: string;
  license_no?: string;
  license_expiry?: string;
  verification_status?: string;
}

export interface UserUpdate {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
  specialty?: string;
  department?: string;
  license_no?: string;
  license_expiry?: string;
  verification_status?: string;
}

export interface UserListResponse {
  items: User[];
  page: number;
  limit: number;
  total: number;
}

export async function fetchUsers(params: { page?: number; limit?: number; q?: string; sort?: string; order?: "asc" | "desc"; role?: string; verification_status?: string }, token: string) {
  const query = new URLSearchParams();
  if (params.page) query.append("page", params.page.toString());
  if (params.limit) query.append("limit", params.limit.toString());
  if (params.q) query.append("q", params.q);
  if (params.sort) query.append("sort", params.sort);
  if (params.order) query.append("order", params.order);
  if (params.role) query.append("role", params.role);
  if (params.verification_status) query.append("verification_status", params.verification_status);

  return apiFetch<UserListResponse>(`/users?${query.toString()}`, {}, token);
}

export async function createUser(data: UserCreate, token: string) {
  return apiFetch<User>(
    "/users",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function createUserInvite(
  data: { email: string; role: string },
  token: string
) {
  return apiFetch<UserInviteCreateResponse>(
    "/users/invites",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function updateUser(id: string, data: UserUpdate, token: string) {
  return apiFetch<User>(
    `/users/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function deleteUser(id: string, token: string) {
  return apiFetch<void>(
    `/users/${id}`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function verifyUser(id: string, token: string) {
  return apiFetch<User>(
    `/users/${id}/verify`,
    {
      method: "POST",
    },
    token
  );
}

// ── Stats ──────────────────────────────────────────────────────

export interface MonthlyStats {
  month: string;
  new_patients: number;
  consultations: number;
}

export interface OverviewStatsResponse {
  year: number;
  monthly: MonthlyStats[];
  totals: { patients: number; meetings: number };
}

export async function fetchOverviewStats(token: string, year?: number) {
  const query = year ? `?year=${year}` : "";
  return apiFetch<OverviewStatsResponse>(`/stats/overview${query}`, {}, token);
}

// ── Dense Mode Types ──────────────────────────────────────────

export interface PatientHeader {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  age: number | null;
  gender: string | null;
  allergies: string | null;
  blood_group: string | null;
  risk_score: number | null;
  primary_diagnosis: string | null;
  ward: string | null;
  bed_number: string | null;
  people_id: string | null;
}

export interface ActiveEncounter {
  id: string;
  encounter_type: string;
  status: string;
  admitted_at: string;
  ward: string | null;
  bed_number: string | null;
  chief_complaint: string | null;
}

export interface ActiveMedication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  status: string;
}

export interface PendingLab {
  id: string;
  test_name: string;
  category: string | null;
  status: string;
  ordered_at: string;
}

export interface ClinicalAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  message: string | null;
  created_at: string;
  is_acknowledged: boolean;
}

export interface CurrentConditionBrief {
  id: string;
  condition: string;
  severity: string | null;
}

export interface TreatmentBrief {
  id: string;
  name: string;
  is_active: boolean;
}

export interface AssignedDoctor {
  id: string;
  name: string;
  role: string | null;
}

export interface PatientDenseSummary {
  patient: PatientHeader;
  active_encounter: ActiveEncounter | null;
  active_medications: ActiveMedication[];
  pending_labs: PendingLab[];
  active_alerts: ClinicalAlert[];
  current_conditions: CurrentConditionBrief[];
  active_treatments: TreatmentBrief[];
  assigned_doctors: AssignedDoctor[];
}

export interface TimelineEvent {
  id: string;
  patient_id: string;
  event_type: string;
  event_time: string;
  title: string;
  summary: string | null;
  details: string | null;
  is_abnormal: boolean;
  author_id: string | null;
  author_name: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
}

export interface TimelineResponse {
  items: TimelineEvent[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface LabTrendPoint {
  id: string;
  test_name: string;
  result_value: string;
  result_unit: string | null;
  reference_range: string | null;
  is_abnormal: boolean;
  resulted_at: string | null;
}

export interface OrderCreatePayload {
  order_type: "medication" | "lab" | "imaging";
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  category?: string;
  notes?: string;
  start_date?: string;
}

export interface NoteCreatePayload {
  note_type?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  title?: string;
}

// ── Dense Mode API Functions ──────────────────────────────────

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

// ── Device Monitor ──────────────────────────────────────────

export interface DeviceStats {
  period_hours: number;
  success_count: number;
  error_count: number;
  error_rate: number;
  errors_by_device: { device_id: string; count: number }[];
}

export interface DeviceErrorLog {
  id: number;
  device_id: string;
  error_message: string;
  ip_address: string;
  endpoint: string;
  occurred_at: string;
}

export async function fetchDeviceStats(token: string, hours: number = 24) {
  return apiFetch<DeviceStats>(`/device/v1/stats?hours=${hours}`, { method: "GET" }, token);
}

export async function fetchDeviceErrors(token: string, limit: number = 50) {
  return apiFetch<DeviceErrorLog[]>(`/device/v1/errors?limit=${limit}`, { method: "GET" }, token);
}

// ── Audit Logs ──────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  ip_address: string | null;
  is_break_glass: boolean;
  break_glass_reason: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLog[];
  page: number;
  limit: number;
  total: number;
}

interface FetchAuditLogsParams {
  page?: number;
  limit?: number;
  action?: string;
  resource_type?: string;
  user_id?: string;
  is_break_glass?: boolean;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export async function fetchAuditLogs(params: FetchAuditLogsParams, token: string) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.action) query.set("action", params.action);
  if (params.resource_type) query.set("resource_type", params.resource_type);
  if (params.user_id) query.set("user_id", params.user_id);
  if (params.is_break_glass !== undefined) query.set("is_break_glass", params.is_break_glass.toString());
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.search) query.set("search", params.search);

  const qs = query.toString();
  return apiFetch<AuditLogListResponse>(`/audit/logs${qs ? `?${qs}` : ""}`, {}, token);
}

// ── Security API ──────────────────────────────────────────

export interface IPBan {
  id: string;
  ip_address: string;
  reason: string | null;
  failed_attempts: number;
  banned_until: string | null;
  created_at: string;
}

export interface IPBanListResponse {
  items: IPBan[];
  total: number;
}

export interface LoginAttemptRecord {
  id: string;
  ip_address: string;
  email: string;
  success: boolean;
  details?: string | null;
  created_at: string;
}

export interface LoginAttemptListResponse {
  items: LoginAttemptRecord[];
  total: number;
}

export interface SecurityStats {
  active_ip_bans: number;
  failed_logins_24h: number;
  locked_accounts: number;
  total_attempts_24h: number;
}

export async function fetchSecurityStats(token: string) {
  return apiFetch<SecurityStats>("/security/stats", {}, token);
}

export async function fetchIPBans(params: { page?: number; limit?: number }, token: string) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  const qs = query.toString();
  return apiFetch<IPBanListResponse>(`/security/ip-bans${qs ? `?${qs}` : ""}`, {}, token);
}

export async function deleteIPBan(ipAddress: string, token: string) {
  return apiFetch<{ message: string }>(`/security/ip-bans/${encodeURIComponent(ipAddress)}`, { method: "DELETE" }, token);
}

export async function createIPBan(ip_address: string, reason: string, duration_minutes: number, token: string) {
  return apiFetch<IPBan>(
    "/security/ip-bans",
    {
      method: "POST",
      body: JSON.stringify({ ip_address, reason, duration_minutes }),
    },
    token
  );
}

export async function fetchLoginAttempts(
  params: { page?: number; limit?: number; ip_address?: string; email?: string; success?: boolean },
  token: string,
) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.ip_address) query.set("ip_address", params.ip_address);
  if (params.email) query.set("email", params.email);
  if (params.success !== undefined) query.set("success", params.success.toString());
  const qs = query.toString();
  return apiFetch<LoginAttemptListResponse>(`/security/login-attempts${qs ? `?${qs}` : ""}`, {}, token);
}

// ── Bulk Delete ──────────────────────────────────────────

export interface BulkDeletePatientsResponse {
  deleted: number;
  errors: string[];
}

export interface BulkDeleteUsersResponse {
  deleted: number;
  skipped: string[];
}

export async function bulkDeletePatients(ids: string[], token: string) {
  return apiFetch<BulkDeletePatientsResponse>(
    "/patients/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) },
    token,
  );
}

export async function bulkDeleteUsers(ids: string[], token: string) {
  return apiFetch<BulkDeleteUsersResponse>(
    "/users/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) },
    token,
  );
}
