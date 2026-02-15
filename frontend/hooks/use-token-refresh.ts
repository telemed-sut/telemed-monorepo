"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { refreshToken } from "@/lib/api";

/**
 * Proactively refreshes the JWT token before it expires.
 * Runs a check every 30 seconds; when TTL drops below the buffer (5 min),
 * it calls /auth/refresh while the old token is still valid.
 * If refresh fails (token already expired), clears auth and redirects to /login.
 */
export function useTokenRefresh() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const clearToken = useAuthStore((s) => s.clearToken);
  const getTokenTTL = useAuthStore((s) => s.getTokenTTL);
  const isTokenExpiringSoon = useAuthStore((s) => s.isTokenExpiringSoon);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!token) return;

    const check = async () => {
      const ttl = getTokenTTL();

      // Token already fully expired — force logout
      if (ttl <= 0) {
        clearToken();
        router.replace("/login");
        return;
      }

      // Token expiring soon — proactively refresh
      if (isTokenExpiringSoon() && !refreshingRef.current) {
        refreshingRef.current = true;
        try {
          const res = await refreshToken(token);
          if (res?.access_token) {
            setToken(res.access_token);
          }
        } catch {
          // Refresh failed — token may already be expired
          clearToken();
          router.replace("/login");
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
  }, [token, setToken, clearToken, getTokenTTL, isTokenExpiringSoon, router]);
}
