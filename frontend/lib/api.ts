export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
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
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
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

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

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
