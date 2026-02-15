"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";
import { PatientDetailContent } from "@/components/dashboard/patient-detail";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth-store";

export default function PatientDetailPage() {
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
            <div className="h-svh overflow-hidden lg:p-2 w-full">
                <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
                    <DashboardHeader />
                    <PatientDetailContent patientId={patientId} />
                </div>
            </div>
        </SidebarProvider>
    );
}
