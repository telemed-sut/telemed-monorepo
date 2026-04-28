const LOGIN_CREDENTIAL_RESET_STORAGE_KEY = "telemed.login.reset-credentials-after-logout";

export function markLoginCredentialsForResetAfterLogout() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    LOGIN_CREDENTIAL_RESET_STORAGE_KEY,
    String(Date.now()),
  );
}

export function shouldResetLoginCredentialsAfterLogout() {
  if (typeof window === "undefined") {
    return false;
  }

  const raw = window.sessionStorage.getItem(LOGIN_CREDENTIAL_RESET_STORAGE_KEY);
  if (!raw) {
    return false;
  }

  const createdAt = Number(raw);
  if (!Number.isFinite(createdAt)) {
    window.sessionStorage.removeItem(LOGIN_CREDENTIAL_RESET_STORAGE_KEY);
    return false;
  }

  return Date.now() - createdAt <= 30 * 60 * 1000;
}

export function clearLoginCredentialResetMarker() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(LOGIN_CREDENTIAL_RESET_STORAGE_KEY);
}
