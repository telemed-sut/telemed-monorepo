"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { logout, logoutAdminSso } from "@/lib/api";
import { markLoginCredentialsForResetAfterLogout } from "@/lib/login-form-privacy";
import { useAuthStore } from "@/store/auth-store";

export function useSessionLogout() {
  const router = useRouter();

  return useCallback(async () => {
    const { authSource, clearSessionState, clearToken, token } = useAuthStore.getState();
    const isSsoSession = authSource === "sso";

    if (isSsoSession) {
      clearSessionState();
      try {
        const { redirect_url } = await logoutAdminSso();
        window.location.assign(redirect_url);
      } catch {
        router.replace("/login?error=admin_sso_failed&reason=deprecated_logout_method");
      }
      return;
    }

    try {
      await logout(token ?? undefined);
    } catch {
      // Best-effort revoke; local cleanup still needs to happen.
    }

    markLoginCredentialsForResetAfterLogout();
    clearToken();
    router.replace("/login");
  }, [router]);
}
