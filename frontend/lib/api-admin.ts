import {
  API_BASE_URL,
  apiFetch,
  appendPagination,
  isProbablyJwt,
  parseApiErrorDetail,
  toUserFacingMessage,
} from "./api-client";
import type {
  ApiError,
} from "./api-client";
import type {
  AuditLogListResponse,
  BulkDeleteUsersResponse,
  BulkRestoreUsersResponse,
  DeviceErrorLog,
  DeviceRegistration,
  DeviceRegistrationCreatePayload,
  DeviceRegistrationCreateResponse,
  DeviceRegistrationDeleteResponse,
  DeviceRegistrationListResponse,
  DeviceRegistrationUpdatePayload,
  DeviceStats,
  FetchDeviceErrorsOptions,
  FetchDeviceStatsOptions,
  IPBan,
  IPBanListResponse,
  LoginAttemptListResponse,
  OverviewStatsResponse,
  PurgeDeletedUsersResponse,
  SecurityStats,
  User,
  UserCreate,
  UserInviteCreateResponse,
  UserInviteListResponse,
  UserInviteStatus,
  UserListResponse,
  UserUpdate,
} from "./api-types";

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
  data: { email: string; role: string; reason?: string },
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

export async function fetchOverviewStats(token: string, year?: number) {
  const query = year ? `?year=${year}` : "";
  return apiFetch<OverviewStatsResponse>(`/stats/overview${query}`, {}, token);
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

  const url = `${API_BASE_URL}/audit/export?${query.toString()}`;
  const headers: Record<string, string> = {};
  if (typeof window === "undefined" && token && isProbablyJwt(token)) {
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
