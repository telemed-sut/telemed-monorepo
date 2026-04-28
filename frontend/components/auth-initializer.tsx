"use client";

import { useAuthStore } from "@/store/auth-store";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const AUTH_HYDRATION_SKIP_PREFIXES = [
    "/forgot-password",
    "/reset-password",
    "/invite",
    "/patient/join",
] as const;

export function AuthInitializer() {
    const hydrate = useAuthStore((state) => state.hydrate);
    const pathname = usePathname();

    const shouldSkipHydrate = AUTH_HYDRATION_SKIP_PREFIXES.some((prefix) =>
        pathname.startsWith(prefix)
    );

    useEffect(() => {
        if (shouldSkipHydrate) return;
        void hydrate();
    }, [hydrate, shouldSkipHydrate]);

    return null;
}
