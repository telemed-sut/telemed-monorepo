"use client";

import { useAuthStore } from "@/store/auth-store";
import { refreshToken } from "@/lib/api";
import { useEffect, useRef } from "react";

/** Check every 60 seconds if the token needs refreshing */
const CHECK_INTERVAL_MS = 60_000;

export function AuthInitializer() {
    const hydrate = useAuthStore((state) => state.hydrate);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        hydrate();
    }, [hydrate]);

    // Auto-refresh timer
    useEffect(() => {
        const tryRefresh = async () => {
            const store = useAuthStore.getState();
            if (!store.token || !store.hydrated) return;

            // Check if token is expiring soon (within 5 min)
            if (store.isTokenExpiringSoon()) {
                try {
                    const res = await refreshToken(store.token);
                    if (res.access_token) {
                        store.setToken(res.access_token);
                    }
                } catch {
                    // If refresh fails (e.g. token already expired), clear and redirect
                    const ttl = store.getTokenTTL();
                    if (ttl === 0) {
                        store.clearToken();
                        window.location.href = "/login";
                    }
                }
            }
        };

        // Initial check after hydration settles
        const initialTimeout = setTimeout(tryRefresh, 2000);

        // Periodic check
        timerRef.current = setInterval(tryRefresh, CHECK_INTERVAL_MS);

        return () => {
            clearTimeout(initialTimeout);
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    return null;
}
