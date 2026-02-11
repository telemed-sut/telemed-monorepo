"use client";

import { useAuthStore } from "@/store/auth-store";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";
import { UsersContent } from "@/components/dashboard/users-content";

export default function UsersPage() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const hydrated = useAuthStore((state) => state.hydrated);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    if (!mounted || !hydrated) {
        return null;
    }

    if (!token) {
        return null;
    }

    return (
        <div className="flex min-h-svh w-full bg-background dark:bg-[#09090b]">
            <SidebarProvider
                style={
                    {
                        "--sidebar-width": "19rem",
                    } as React.CSSProperties
                }
            >
                <DashboardSidebar />
                <SidebarInset className="overflow-hidden bg-background dark:bg-[#09090b]">
                    <div className="flex h-full flex-col">
                        <DashboardHeader />
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                            <UsersContent />
                        </div>
                    </div>
                </SidebarInset>
            </SidebarProvider>
        </div>
    );
}
