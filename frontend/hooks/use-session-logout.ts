"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { getAdminSsoLogoutPath } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";

export function useSessionLogout() {
  const router = useRouter();

  return useCallback(() => {
    const { authSource, clearSessionState, clearToken } = useAuthStore.getState();
    const isSsoSession = authSource === "sso";

    if (isSsoSession) {
      clearSessionState();
      window.location.assign(getAdminSsoLogoutPath());
      return;
    }

    clearToken();
    router.replace("/login");
  }, [router]);
}
