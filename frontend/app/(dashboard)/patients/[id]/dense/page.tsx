"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DenseModeDashboard } from "@/components/dense-mode/dense-mode-dashboard";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth-store";

export default function DenseModePage() {
    const router = useRouter();
    const params = useParams();
    const patientId = params.id as string;
    const token = useAuthStore((state) => state.token);
    const hydrate = useAuthStore((state) => state.hydrate);
    const hydrated = useAuthStore((state) => state.hydrated);

    useEffect(() => {
        hydrate();
    }, [hydrate]);

    useEffect(() => {
        if (hydrated && !token) {
            router.replace("/login");
        }
    }, [hydrated, token, router]);

    if (!hydrated) {
        return null;
    }

    return (
        <SidebarProvider className="bg-sidebar">
            <DashboardSidebar />
            <div className="h-svh overflow-hidden w-full">
                <DenseModeDashboard patientId={patientId} />
            </div>
        </SidebarProvider>
    );
}
