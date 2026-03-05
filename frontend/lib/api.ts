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

export type UserInviteStatus = "active" | "expired" | "closed";

export interface UserInviteItem {
  id: string;
  email: string;
  role: string;
  created_by?: string | null;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
  status: UserInviteStatus;
}

export interface UserInviteListResponse {
  items: UserInviteItem[];
  total: number;
  page: number;
  limit: number;
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
  two_factor_enabled?: boolean;
}

export interface Admin2FAStatus {
  role?: string;
  required: boolean;
  enabled: boolean;
  setup_required: boolean;
  issuer?: string | null;
  account_email?: string | null;
  provisioning_uri?: string | null;
  trusted_device_days?: number | null;
}

export interface TrustedDevice {
  id: string;
  ip_address?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  current_device: boolean;
}

export interface TrustedDeviceListResponse {
  items: TrustedDevice[];
  total: number;
}

export interface BackupCodesResponse {
  codes: string[];
  generated_at: string;
  expires_at?: string | null;
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

export type PatientAssignmentRole = "primary" | "consulting";

export interface AssignmentDoctorBrief {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PatientAssignment {
  id: string;
  doctor_id: string;
  patient_id: string;
  role: PatientAssignmentRole;
  assigned_at: string;
  doctor?: AssignmentDoctorBrief | null;
}

export interface PatientAssignmentListResponse {
  items: PatientAssignment[];
  total: number;
}

type SortOrder = "asc" | "desc";

// Use environment variable for API URL or default to localhost:8000
// In production/tunnel, if deployed on same domain, use relative path
const API_BASE_URL = (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000");
export type ApiError = Error & { status?: number; detail?: unknown; code?: string };

// Token refresh state to prevent multiple simultaneous refresh calls
let refreshPromise: Promise<string | null> | null = null;

function isProbablyJwt(token: string): boolean {
  return token.split(".").length === 3;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_ERROR_MESSAGE_TH = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

const INTERNAL_ERROR_PATTERN =
  /(traceback|pydantic|validationerror|sqlalchemy|stack trace|line \d+|value_error|type_error)/i;

const TRANSLATED_MESSAGE_RULES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /access denied|permission denied|forbidden/i, message: "คุณไม่มีสิทธิ์ทำรายการนี้" },
  {
    pattern: /doctors?\s+can\s+only\s+create\s+meetings?\s+for\s+assigned\s+patients?\.?/i,
    message: "แพทย์สามารถสร้างนัดหมายได้เฉพาะผู้ป่วยที่ได้รับมอบหมายเท่านั้น",
  },
  { pattern: /super admin only/i, message: "รายการนี้ทำได้เฉพาะผู้ดูแลระดับสูงเท่านั้น" },
  { pattern: /user not found|not found/i, message: "ไม่พบข้อมูลผู้ใช้ที่ต้องการ" },
  { pattern: /already exists|already in use|already assigned/i, message: "ข้อมูลนี้มีอยู่แล้วในระบบ" },
  { pattern: /confirm_text=\"?purge\"?/i, message: "ต้องพิมพ์คำยืนยัน PURGE ก่อนดำเนินการ" },
  { pattern: /confirm_text=\"?delete\"?/i, message: "ต้องพิมพ์คำยืนยัน DELETE ก่อนดำเนินการ" },
  { pattern: /reason must be at least|purge reason must be at least/i, message: "เหตุผลต้องมีอย่างน้อย 8 ตัวอักษร" },
  { pattern: /temporary password must be at least/i, message: "รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร" },
  { pattern: /invite onboarding is restricted to clinical specialist roles in this phase|clinical specialist roles/i, message: "ขณะนี้ระบบอนุญาตส่งคำเชิญเฉพาะบทบาทสายคลินิกเท่านั้น" },
  { pattern: /invite.*expired|expired invite|link.*expired/i, message: "คำเชิญนี้หมดอายุแล้ว กรุณาสร้างลิงก์คำเชิญใหม่" },
  { pattern: /invite.*closed|invite.*revoked|already revoked/i, message: "คำเชิญนี้ไม่อยู่ในสถานะใช้งานแล้ว" },
  { pattern: /too many requests|rate limit/i, message: "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง" },
  { pattern: /network error|failed to fetch|network request failed/i, message: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" },
  { pattern: /invalid credentials|incorrect password/i, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
];

function clampPage(page?: number): number {
  if (!Number.isFinite(page)) return DEFAULT_PAGE;
  return Math.max(1, Math.floor(page as number));
}

function clampLimit(limit?: number, max: number = MAX_QUERY_LIMIT): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  const normalized = Math.floor(limit as number);
  if (normalized < 1) return DEFAULT_LIMIT;
  return Math.min(normalized, max);
}

function appendPagination(
  query: URLSearchParams,
  params: { page?: number; limit?: number },
  maxLimit: number = MAX_QUERY_LIMIT
) {
  query.append("page", clampPage(params.page).toString());
  query.append("limit", clampLimit(params.limit, maxLimit).toString());
}

function parseApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim().length > 0) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return null;

        const record = entry as Record<string, unknown>;
        const message =
          (typeof record.msg === "string" && record.msg) ||
          (typeof record.message === "string" && record.message) ||
          null;
        if (!message) return null;
        return message;
      })
      .filter((item): item is string => Boolean(item));

    if (messages.length > 0) {
      return messages.join(" | ");
    }
    return null;
  }

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    return (
      parseApiErrorDetail(record.detail) ||
      parseApiErrorDetail(record.message) ||
      parseApiErrorDetail(record.error)
    );
  }

  return null;
}

function extractApiErrorCode(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") return undefined;
  const code = (detail as Record<string, unknown>).code;
  if (typeof code === "string" && code.length > 0) return code;
  return undefined;
}

function statusFallbackMessage(status?: number, fallback: string = DEFAULT_ERROR_MESSAGE_TH): string {
  if (status === 0) return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  if (status === 400) return "ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
  if (status === 401) return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  if (status === 403) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (status === 404) return "ไม่พบข้อมูลที่ต้องการ";
  if (status === 409) return "ข้อมูลขัดแย้งกับสถานะปัจจุบัน กรุณารีเฟรชแล้วลองใหม่";
  if (status === 422) return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบก่อนบันทึก";
  if (status === 429) return "คุณทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้ง";
  if (typeof status === "number" && status >= 500) return "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
  return fallback;
}

function translateKnownMessage(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) return null;

  for (const rule of TRANSLATED_MESSAGE_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.message;
    }
  }
  return null;
}

function sanitizeMessage(rawMessage: string | null | undefined): string | null {
  if (!rawMessage) return null;
  const trimmed = rawMessage.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  if (INTERNAL_ERROR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function toUserFacingMessage(
  status: number | undefined,
  rawMessage: string | null | undefined,
  fallback: string = DEFAULT_ERROR_MESSAGE_TH,
): string {
  const sanitized = sanitizeMessage(rawMessage);
  if (sanitized) {
    const translated = translateKnownMessage(sanitized);
    if (translated) return translated;
    return sanitized;
  }
  return statusFallbackMessage(status, fallback);
}

export function getErrorMessage(error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE_TH): string {
  if (error instanceof Error) {
    const apiError = error as ApiError;
    return toUserFacingMessage(apiError.status, apiError.message, fallback);
  }
  if (typeof error === "string") {
    return toUserFacingMessage(undefined, error, fallback);
  }
  return fallback;
}

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

  if (token && isProbablyJwt(token)) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch (err) {
    const networkMessage =
      err instanceof TypeError ? `Network error: ${err.message}` : "Network request failed";
    const error: ApiError = new Error(toUserFacingMessage(0, networkMessage));
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

  let data: unknown = null;
  if (hasBody && isJson) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const payload = data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
    const detail = payload.detail;
    const rawMessage =
      parseApiErrorDetail(detail) ||
      parseApiErrorDetail(payload.message) ||
      parseApiErrorDetail(payload.error) ||
      res.statusText ||
      "Request failed";
    const error: ApiError = new Error(toUserFacingMessage(res.status, rawMessage));
    error.status = res.status;
    error.detail = detail;
    const errorCode = extractApiErrorCode(detail);
    if (errorCode) {
      error.code = errorCode;
    }
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

  // If 401, try to refresh once (supports both bearer and cookie auth flows)
  if (result.status === 401 && path !== "/auth/refresh" && path !== "/auth/login") {
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
export async function refreshToken(token?: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/refresh", { method: "POST" }, token);
}

export async function logout(token?: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>("/auth/logout", { method: "POST" }, token);
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
async function tryRefreshToken(currentToken?: string): Promise<string | null> {
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

export async function login(
  email: string,
  password: string,
  otpCode?: string,
  rememberDevice = false
) {
  const payload: { email: string; password: string; otp_code?: string; remember_device?: boolean } = { email, password };
  if (otpCode && otpCode.trim().length > 0) {
    payload.otp_code = otpCode;
  }
  payload.remember_device = rememberDevice;
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
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

export async function fetchCurrentUser(token?: string) {
  return apiFetch<UserMe>("/auth/me", {}, token);
}

export async function fetchAdmin2FAStatus(token: string) {
  return apiFetch<Admin2FAStatus>("/auth/2fa/admin", { method: "GET" }, token);
}

export async function verifyAdmin2FA(otpCode: string, token: string) {
  return apiFetch<{ message: string }>(
    "/auth/2fa/admin/verify",
    {
      method: "POST",
      body: JSON.stringify({ otp_code: otpCode }),
    },
    token
  );
}

export async function resetAdmin2FA(
  token: string,
  data?: { current_otp_code?: string; reason?: string }
) {
  return apiFetch<Admin2FAStatus>(
    "/auth/2fa/admin/reset",
    {
      method: "POST",
      body: JSON.stringify(data || {}),
    },
    token
  );
}

export async function fetch2FAStatus(token: string) {
  return apiFetch<Admin2FAStatus>("/auth/2fa/status", { method: "GET" }, token);
}

export async function verify2FA(otpCode: string, token: string) {
  return apiFetch<{ message: string }>(
    "/auth/2fa/verify",
    {
      method: "POST",
      body: JSON.stringify({ otp_code: otpCode }),
    },
    token
  );
}

export async function disable2FA(currentOtpCode: string, token: string) {
  return apiFetch<{ message: string }>(
    "/auth/2fa/disable",
    {
      method: "POST",
      body: JSON.stringify({ current_otp_code: currentOtpCode }),
    },
    token
  );
}

export async function reset2FA(
  token: string,
  data?: { current_otp_code?: string; reason?: string }
) {
  return apiFetch<Admin2FAStatus>(
    "/auth/2fa/reset",
    {
      method: "POST",
      body: JSON.stringify(data || {}),
    },
    token
  );
}

export async function regenerateBackupCodes(token: string) {
  return apiFetch<BackupCodesResponse>(
    "/auth/2fa/backup-codes/regenerate",
    {
      method: "POST",
    },
    token
  );
}

export async function useBackupCode(code: string, token: string) {
  return apiFetch<{ message: string }>(
    "/auth/2fa/backup-codes/use",
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
    token
  );
}

export async function fetchTrustedDevices(token: string) {
  return apiFetch<TrustedDeviceListResponse>(
    "/auth/2fa/trusted-devices",
    { method: "GET" },
    token
  );
}

export async function revokeTrustedDevice(deviceId: string, token: string) {
  return apiFetch<{ message: string }>(
    `/auth/2fa/trusted-devices/${deviceId}`,
    { method: "DELETE" },
    token
  );
}

export async function revokeAllTrustedDevices(token: string) {
  return apiFetch<{ revoked: number }>(
    "/auth/2fa/trusted-devices/revoke-all",
    { method: "POST" },
    token
  );
}

export async function superAdminResetUser2FA(
  userId: string,
  reason: string,
  token: string
) {
  return apiFetch<{ message: string; user_id: string; email: string; setup_required: boolean }>(
    `/security/users/${userId}/2fa/reset`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
    token
  );
}

export interface AdminSecurityUserLookup {
  user_id: string;
  email: string;
  role: string;
  two_factor_enabled: boolean;
  is_locked: boolean;
}

export interface AdminEmergencyUnlockPayload {
  email?: string;
  user_id?: string;
  reason?: string;
}

export interface AdminEmergencyUnlockResponse {
  message: string;
  user_id: string;
  email: string;
  was_locked: boolean;
}

export interface AdminPasswordResetResponse {
  message: string;
  user_id: string;
  email: string;
  reset_token: string;
  reset_token_expires_in: number;
}

export async function resolveSecurityUserByEmail(email: string, token: string) {
  const query = new URLSearchParams();
  query.set("email", email.trim().toLowerCase());
  return apiFetch<AdminSecurityUserLookup>(`/security/users/resolve?${query.toString()}`, {}, token);
}

export async function adminEmergencyUnlock(payload: AdminEmergencyUnlockPayload, token: string) {
  return apiFetch<AdminEmergencyUnlockResponse>(
    "/security/admin-unlock",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function superAdminResetUserPassword(
  userId: string,
  reason: string,
  token: string
) {
  return apiFetch<AdminPasswordResetResponse>(
    `/security/users/${userId}/password/reset`,
    {
      method: "POST",
      body: JSON.stringify({
        reason,
      }),
    },
    token
  );
}

export interface FetchPatientsParams {
  page?: number;
  limit?: number;
  q?: string;
  sort?: string;
  order?: SortOrder;
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
  waiting: "รอหมอเข้าห้อง",
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

export type MeetingRoomPresenceState =
  | "none"
  | "patient_waiting"
  | "both_in_room"
  | "doctor_only"
  | "doctor_left_patient_waiting";

export interface MeetingRoomPresence {
  meeting_id: string;
  state: MeetingRoomPresenceState;
  doctor_online: boolean;
  patient_online: boolean;
  refreshed_at?: string | null;
  doctor_joined_at?: string | null;
  doctor_last_seen_at?: string | null;
  patient_last_seen_at?: string | null;
  patient_joined_at?: string | null;
  doctor_left_at?: string | null;
  patient_left_at?: string | null;
  updated_at?: string | null;
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
  room_presence?: MeetingRoomPresence | null;
}

export interface MeetingVideoTokenResponse {
  provider: "mock" | "zego";
  meeting_id: string;
  app_id?: number | null;
  room_id: string;
  user_id: string;
  token: string;
  issued_at: string;
  expires_at: string;
}

export interface MeetingPatientInviteResponse {
  meeting_id: string;
  room_id: string;
  invite_token: string;
  short_code: string;
  invite_url: string;
  issued_at: string;
  expires_at: string;
}

export interface MeetingPatientPresencePayload {
  meetingId?: string;
  inviteToken?: string;
  shortCode?: string;
}

export interface MeetingListResponse {
  items: Meeting[];
  page: number;
  limit: number;
  total: number;
}

export interface FetchMeetingsParams {
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
  const pageSize = clampLimit(options.pageSize ?? BULK_FETCH_DEFAULT_PAGE_SIZE, MAX_QUERY_LIMIT);
  const maxItems = normalizeMaxItems(options.maxItems);
  const maxPages = Math.ceil(maxItems / pageSize);
  const items: Meeting[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchMeetings({ ...params, page, limit: pageSize }, token);
    if (res.items.length === 0) break;

    const remaining = maxItems - items.length;
    items.push(...res.items.slice(0, remaining));
    if (items.length >= res.total || res.items.length < pageSize || items.length >= maxItems) {
      break;
    }
  }

  return items;
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
  const body: Record<string, unknown> = {
  };
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
  deleted_by?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
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

export async function fetchUsers(
  params: {
    page?: number;
    limit?: number;
    q?: string;
    sort?: string;
    order?: "asc" | "desc";
    role?: string;
    verification_status?: string;
    clinical_only?: boolean;
    include_deleted?: boolean;
    deleted_only?: boolean;
  },
  token: string
) {
  const query = new URLSearchParams();
  appendPagination(query, params, 100);
  if (params.q) query.append("q", params.q);
  if (params.sort) query.append("sort", params.sort);
  if (params.order) query.append("order", params.order);
  if (params.role) query.append("role", params.role);
  if (params.verification_status) query.append("verification_status", params.verification_status);
  if (params.clinical_only !== undefined) query.append("clinical_only", String(params.clinical_only));
  if (params.include_deleted !== undefined) query.append("include_deleted", String(params.include_deleted));
  if (params.deleted_only !== undefined) query.append("deleted_only", String(params.deleted_only));

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

export async function fetchUserInvites(
  params: {
    page?: number;
    limit?: number;
    q?: string;
    status_filter?: UserInviteStatus | "all";
  },
  token: string
) {
  const query = new URLSearchParams();
  appendPagination(query, params, 100);
  if (params.q) query.append("q", params.q);
  if (params.status_filter) query.append("status_filter", params.status_filter);

  return apiFetch<UserInviteListResponse>(`/users/invites?${query.toString()}`, {}, token);
}

export async function resendUserInvite(inviteId: string, token: string) {
  return apiFetch<UserInviteCreateResponse>(
    `/users/invites/${inviteId}/resend`,
    { method: "POST" },
    token
  );
}

export async function revokeUserInvite(inviteId: string, token: string) {
  return apiFetch<{ message: string }>(
    `/users/invites/${inviteId}/revoke`,
    { method: "POST" },
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

export async function restoreUser(id: string, token: string) {
  return apiFetch<User>(
    `/users/${id}/restore`,
    {
      method: "POST",
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
  kpis: {
    today_consultations: number;
    this_week_consultations: number;
    this_month_new_patients: number;
  };
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
  error_code?: string;
  suggestion?: string;
}

export interface FetchDeviceStatsOptions {
  topDevices?: number;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchDeviceStats(
  token: string,
  hours: number = 24,
  options: FetchDeviceStatsOptions = {}
) {
  const params = new URLSearchParams();
  params.set("hours", String(hours));
  if (typeof options.topDevices === "number") {
    params.set("top_devices", String(options.topDevices));
  }
  if (options.dateFrom) {
    params.set("date_from", options.dateFrom);
  }
  if (options.dateTo) {
    params.set("date_to", options.dateTo);
  }

  return apiFetch<DeviceStats>(`/device/v1/stats?${params.toString()}`, { method: "GET" }, token);
}

export interface FetchDeviceErrorsOptions {
  limit?: number;
  hours?: number;
  since?: string;
  until?: string;
  sinceId?: number;
  deviceId?: string;
}

export async function fetchDeviceErrors(token: string, options: FetchDeviceErrorsOptions = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 50));

  if (typeof options.hours === "number") {
    params.set("hours", String(options.hours));
  }
  if (options.since) {
    params.set("since", options.since);
  }
  if (options.until) {
    params.set("until", options.until);
  }
  if (typeof options.sinceId === "number") {
    params.set("since_id", String(options.sinceId));
  }
  if (options.deviceId) {
    params.set("device_id", options.deviceId);
  }

  return apiFetch<DeviceErrorLog[]>(`/device/v1/errors?${params.toString()}`, { method: "GET" }, token);
}

// ── Audit Logs ──────────────────────────────────────────────────

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: string;
  result: "success" | "failure";
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | string | null;
  ip_address: string | null;
  is_break_glass: boolean;
  break_glass_reason: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  limit: number;
  next_cursor?: string | null;
}

export async function fetchAuditLogs(
  token: string,
  params: {
    cursor?: string | null;
    limit?: number;
    user_id?: string;
    user?: string;
    action?: string;
    resource_type?: string;
    is_break_glass?: boolean;
    date_from?: string;
    date_to?: string;
    search?: string;
    result?: "success" | "failure";
  }
) {
  const query = new URLSearchParams();
  if (params.limit) query.append("limit", params.limit.toString());
  if (params.cursor) query.append("cursor", params.cursor);
  if (params.user_id) query.append("user_id", params.user_id);
  if (params.user) query.append("user", params.user);
  if (params.action) query.append("action", params.action);
  if (params.resource_type) query.append("resource_type", params.resource_type);
  if (params.is_break_glass !== undefined) query.append("is_break_glass", params.is_break_glass.toString());
  if (params.date_from) query.append("date_from", params.date_from);
  if (params.date_to) query.append("date_to", params.date_to);
  if (params.search) query.append("search", params.search);
  if (params.result) query.append("result", params.result);

  return apiFetch<AuditLogListResponse>(`/audit/logs?${query.toString()}`, {}, token);
}

export async function exportAuditLogs(
  token: string,
  params: {
    user_id?: string;
    user?: string;
    action?: string;
    resource_type?: string;
    is_break_glass?: boolean;
    date_from?: string;
    date_to?: string;
    search?: string;
    result?: "success" | "failure";
  }
) {
  const query = new URLSearchParams();
  if (params.user_id) query.append("user_id", params.user_id);
  if (params.user) query.append("user", params.user);
  if (params.action) query.append("action", params.action);
  if (params.resource_type) query.append("resource_type", params.resource_type);
  if (params.is_break_glass !== undefined) query.append("is_break_glass", params.is_break_glass.toString());
  if (params.date_from) query.append("date_from", params.date_from);
  if (params.date_to) query.append("date_to", params.date_to);
  if (params.search) query.append("search", params.search);
  if (params.result) query.append("result", params.result);

  // Use rawFetch to handle blob/file download
  const url = `${API_BASE_URL}/audit/export?${query.toString()}`;
  const headers: Record<string, string> = {};
  if (token && isProbablyJwt(token)) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let detail: unknown = null;
    try {
      if (res.headers.get("content-type")?.includes("application/json")) {
        const payload = (await res.json()) as Record<string, unknown>;
        detail = payload.detail ?? payload.message ?? payload.error;
      }
    } catch {
      detail = null;
    }

    const rawMessage = parseApiErrorDetail(detail) || res.statusText || "Failed to export logs";
    const error: ApiError = new Error(
      toUserFacingMessage(res.status, rawMessage, "ไม่สามารถส่งออก Audit Logs ได้")
    );
    error.status = res.status;
    error.detail = detail;
    throw error;
  }

  return res.blob();
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
  failed_logins_1h: number;
  locked_accounts: number;
  total_attempts_24h: number;
  forbidden_403_1h: number;
  forbidden_403_baseline_24h: number;
  forbidden_403_spike: boolean;
  purge_actions_24h: number;
  emergency_actions_24h: number;
}

export async function fetchSecurityStats(token: string) {
  return apiFetch<SecurityStats>("/security/stats", {}, token);
}

export async function fetchIPBans(params: { page?: number; limit?: number }, token: string) {
  const query = new URLSearchParams();
  appendPagination(query, params, 200);
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
  appendPagination(query, params, 200);
  if (params.ip_address) query.set("ip_address", params.ip_address);
  if (params.email) query.set("email", params.email);
  if (params.success !== undefined) query.set("success", params.success.toString());
  const qs = query.toString();
  return apiFetch<LoginAttemptListResponse>(`/security/login-attempts${qs ? `?${qs}` : ""}`, {}, token);
}

export interface DeviceRegistration {
  id: string;
  device_id: string;
  display_name: string;
  notes: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceRegistrationListResponse {
  items: DeviceRegistration[];
  total: number;
  page: number;
  limit: number;
}

export interface DeviceRegistrationCreatePayload {
  device_id: string;
  display_name: string;
  notes?: string;
  is_active?: boolean;
  device_secret?: string;
}

export interface DeviceRegistrationCreateResponse {
  device: DeviceRegistration;
  device_secret: string;
}

export interface DeviceRegistrationUpdatePayload {
  display_name?: string;
  notes?: string;
  is_active?: boolean;
}

export interface DeviceRegistrationDeleteResponse {
  message: string;
  device_id: string;
}

export async function fetchDeviceRegistrations(
  params: { page?: number; limit?: number; q?: string; is_active?: boolean },
  token: string,
) {
  const query = new URLSearchParams();
  appendPagination(query, params, 200);
  if (params.q) query.set("q", params.q);
  if (params.is_active !== undefined) query.set("is_active", params.is_active ? "true" : "false");
  const qs = query.toString();
  return apiFetch<DeviceRegistrationListResponse>(`/security/devices${qs ? `?${qs}` : ""}`, {}, token);
}

export async function createDeviceRegistration(payload: DeviceRegistrationCreatePayload, token: string) {
  return apiFetch<DeviceRegistrationCreateResponse>(
    "/security/devices",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export async function updateDeviceRegistration(
  deviceId: string,
  payload: DeviceRegistrationUpdatePayload,
  token: string,
) {
  return apiFetch<DeviceRegistration>(
    `/security/devices/${encodeURIComponent(deviceId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteDeviceRegistration(deviceId: string, token: string) {
  return apiFetch<DeviceRegistrationDeleteResponse>(
    `/security/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
    token,
  );
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

export interface BulkRestoreUsersResponse {
  restored: number;
  skipped: string[];
}

export interface PurgeDeletedUsersResponse {
  purged: number;
}

export async function bulkDeletePatients(ids: string[], token: string) {
  return apiFetch<BulkDeletePatientsResponse>(
    "/patients/bulk-delete",
    { method: "POST", body: JSON.stringify({ ids }) },
    token,
  );
}

export async function bulkDeleteUsers(
  ids: string[],
  token: string,
  confirmText?: string
) {
  return apiFetch<BulkDeleteUsersResponse>(
    "/users/bulk-delete",
    {
      method: "POST",
      body: JSON.stringify(
        confirmText ? { ids, confirm_text: confirmText } : { ids }
      ),
    },
    token,
  );
}

export async function bulkRestoreUsers(ids: string[], token: string) {
  return apiFetch<BulkRestoreUsersResponse>(
    "/users/bulk-restore",
    { method: "POST", body: JSON.stringify({ ids }) },
    token,
  );
}

export async function purgeDeletedUsers(
  payload: { older_than_days?: number; confirm_text: string; reason: string },
  token: string
) {
  return apiFetch<PurgeDeletedUsersResponse>(
    "/users/purge-deleted",
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

// ---------- Patient App Registration ----------

export interface PatientRegistrationCodeResponse {
  patient_id: string;
  code: string;
  expires_at: string;
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
