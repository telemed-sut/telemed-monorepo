import { apiFetch } from "./api-client";
import type {
  AccessProfile,
  Admin2FAStatus,
  AdminEmergencyUnlockPayload,
  AdminEmergencyUnlockResponse,
  AdminPasswordResetResponse,
  AdminSecurityUserLookup,
  AdminSsoStatus,
  BackupCodesResponse,
  ForgotPasswordResponse,
  InviteInfoResponse,
  LoginResponse,
  TrustedDeviceListResponse,
  UserMe,
} from "./api-types";

interface InviteTokenRequest {
  token: string;
}

export async function refreshToken(token?: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/refresh", { method: "POST" }, token);
}

export async function logout(token?: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>("/auth/logout", { method: "POST" }, token);
}

export async function fetchAdminSsoStatus(): Promise<AdminSsoStatus> {
  return apiFetch<AdminSsoStatus>("/auth/admin/sso/status");
}

export function getAdminSsoLoginPath(nextPath: string = "/patients"): string {
  const query = new URLSearchParams({ next: nextPath });
  return `/api/auth/admin/sso/login?${query.toString()}`;
}

export function getAdminSsoLogoutPath(): string {
  return "/api/auth/admin/sso/logout";
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

export async function stepUpAuth(
  password: string,
  otpCode?: string,
  rememberDevice = false,
  token?: string,
) {
  const payload: { password: string; otp_code?: string; remember_device?: boolean } = { password };
  if (otpCode && otpCode.trim().length > 0) {
    payload.otp_code = otpCode;
  }
  payload.remember_device = rememberDevice;
  return apiFetch<LoginResponse>(
    "/auth/step-up",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
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
  return apiFetch<InviteInfoResponse>("/auth/invite/inspect", {
    method: "POST",
    body: JSON.stringify({ token } satisfies InviteTokenRequest),
  });
}

export async function acceptInvite(
  token: string,
  payload: { first_name?: string; last_name?: string; password: string; license_no?: string }
) {
  return apiFetch<{ message: string }>("/auth/invite/accept", {
    method: "POST",
    body: JSON.stringify({ token, ...payload }),
  });
}

export async function fetchCurrentUser(token?: string) {
  return apiFetch<UserMe>("/auth/me", {}, token);
}

export async function fetchAccessProfile(token?: string) {
  return apiFetch<AccessProfile>("/auth/access-profile", {}, token);
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
