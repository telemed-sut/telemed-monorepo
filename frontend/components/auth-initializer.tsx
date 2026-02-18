"use client";

import { useAuthStore } from "@/store/auth-store";
import { useEffect } from "react";

export function AuthInitializer() {
    const hydrate = useAuthStore((state) => state.hydrate);

    useEffect(() => {
        void hydrate();
    }, [hydrate]);

    return null;
}
