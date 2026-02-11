export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserMe {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
}

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
// In production, if deployed on same domain, use relative path
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? '' // Use same domain in production
    : "http://localhost:8000"); // Use localhost in development
type ApiError = Error & { status?: number };

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 204 No Content (e.g. DELETE responses)
  if (res.status === 204) {
    return null as T;
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
    throw error;
  }

  return data as T;
}

export async function login(email: string, password: string) {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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

// ── Meetings ──────────────────────────────────────────

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
}

export interface MeetingUpdatePayload {
  date_time?: string;
  description?: string;
  doctor_id?: string;
  note?: string;
  room?: string;
  user_id?: string;
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
  is_superuser: boolean;
  created_at?: string;
}

export interface UserCreate {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  role?: string;
}

export interface UserUpdate {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
}

export interface UserListResponse {
  items: User[];
  page: number;
  limit: number;
  total: number;
}

export async function fetchUsers(params: { page?: number; limit?: number; q?: string; sort?: string; order?: "asc" | "desc"; role?: string }, token: string) {
  const query = new URLSearchParams();
  if (params.page) query.append("page", params.page.toString());
  if (params.limit) query.append("limit", params.limit.toString());
  if (params.q) query.append("q", params.q);
  if (params.sort) query.append("sort", params.sort);
  if (params.order) query.append("order", params.order);
  if (params.role) query.append("role", params.role);

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


