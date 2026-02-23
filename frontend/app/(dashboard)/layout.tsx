"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";
import { PageTransition } from "@/components/dashboard/page-transition";
import { useAuthStore } from "@/store/auth-store";
import { useTokenRefresh } from "@/hooks/use-token-refresh";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);

  // Proactively refresh token before it expires
  useTokenRefresh();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  if (!hydrated) {
    return <main className="min-h-screen bg-background" aria-busy="true" />;
  }

  if (!token) {
    return <main className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    <SidebarProvider className="bg-sidebar">
      <DashboardSidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
          <DashboardHeader />
          <PageTransition>{children}</PageTransition>
        </div>
      </div>
    </SidebarProvider>
  );
}
