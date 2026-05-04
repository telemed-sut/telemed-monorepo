// fallow-ignore-file circular-dependency
import { apiFetch } from "./api-client";
import type {
  AccessProfile,
  AdminSsoLogoutResponse,
  AdminSsoStatus,
  ForgotPasswordResponse,
  InviteInfoResponse,
  LoginResponse,
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

export async function logoutAdminSso(): Promise<AdminSsoLogoutResponse> {
  return apiFetch<AdminSsoLogoutResponse>("/auth/admin/sso/logout", { method: "POST" });
}

export async function login(
  email: string,
  password: string
) {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function stepUpAuth(
  password: string,
  _verificationCode?: string,
  _rememberDevice?: boolean,
  token?: string,
) {
  return apiFetch<LoginResponse>(
    "/auth/step-up",
    {
      method: "POST",
      body: JSON.stringify({ password }),
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
