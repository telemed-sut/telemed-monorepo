"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { getLoginRedirectPath, refreshToken } from "@/lib/api";

function isTransientRefreshError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const status = "status" in error ? Number((error as { status?: unknown }).status) : null;
  if (status === 0) return true;
  if (status !== null && Number.isFinite(status) && status >= 500) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("request failed") ||
    message.includes("timed out") ||
    message.includes("abort")
  );
}

/**
 * Proactively refreshes the JWT token before it expires.
 * Runs a check every 30 seconds; when TTL drops below the buffer (5 min),
 * it calls /auth/refresh while the old token is still valid.
 * If refresh is rejected by auth, clears auth and redirects to /login.
 */
export function useTokenRefresh() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const sessionExpiresAt = useAuthStore((s) => s.sessionExpiresAt);
  const setSession = useAuthStore((s) => s.setSession);
  const clearToken = useAuthStore((s) => s.clearToken);
  const getTokenTTL = useAuthStore((s) => s.getTokenTTL);
  const isTokenExpiringSoon = useAuthStore((s) => s.isTokenExpiringSoon);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (sessionExpiresAt === null) return;

    const check = async () => {
      const ttl = getTokenTTL();

      // Token already fully expired — force logout
      if (ttl <= 0) {
        clearToken();
        router.replace(getLoginRedirectPath("token_expired"));
        return;
      }

      // Token expiring soon — proactively refresh
      if (isTokenExpiringSoon() && !refreshingRef.current) {
        refreshingRef.current = true;
        try {
          const res = await refreshToken(token);
          if (res?.user) {
            setSession(res);
          }
        } catch (error) {
          if (isTransientRefreshError(error)) {
            return;
          }

          // Refresh was rejected by auth — token may already be expired.
          clearToken();
          router.replace(getLoginRedirectPath("refresh_failed"));
        } finally {
          refreshingRef.current = false;
        }
      }
    };

    // Check immediately on mount
    check();

    // Then check every 30 seconds
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [token, sessionExpiresAt, setSession, clearToken, getTokenTTL, isTokenExpiringSoon, router]);
}
