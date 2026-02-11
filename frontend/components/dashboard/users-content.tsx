"use client";

import { useAuthStore } from "@/store/auth-store";
import { UsersTable } from "./users-table";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function UsersContent() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);

    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    if (!hydrated || !token) {
        return null;
    }

    return (
        <div className="flex h-full flex-col gap-6">
            <UsersTable />
        </div>
    );
}
