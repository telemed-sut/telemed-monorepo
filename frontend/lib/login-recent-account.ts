const LOGIN_RECENT_EMAIL_STORAGE_KEY = "telemed.login.recent-email.v1";

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function rememberRecentLoginEmail(email: string | null | undefined) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeEmail(email);
  if (!normalized) {
    return;
  }

  window.localStorage.setItem(LOGIN_RECENT_EMAIL_STORAGE_KEY, normalized);
}

export function readRecentLoginEmail(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeEmail(window.localStorage.getItem(LOGIN_RECENT_EMAIL_STORAGE_KEY));
}
