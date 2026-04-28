"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useTokenRefresh } from "@/hooks/use-token-refresh";
import { useAuthStore } from "@/store/auth-store";

import { DashboardHeader } from "@/components/dashboard/header";
import { PageTransition } from "@/components/dashboard/page-transition";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { WorkspaceTabs } from "@/components/dashboard/workspace-tabs";
import { SidebarProvider } from "@/components/ui/sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = useAuthStore((state) => state.token);
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const isCallPopupWindow =
    pathname.startsWith("/meetings/call/") && searchParams.get("popup") === "1";

  useTokenRefresh();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  if (!hydrated || !token) {
    return <main className="min-h-screen bg-background" aria-busy="true" />;
  }

  if (isCallPopupWindow) {
    return <main className="h-svh w-full bg-background">{children}</main>;
  }

  return (
    <SidebarProvider className="bg-sidebar">
      <DashboardSidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
          <div className="sticky top-0 z-30 w-full bg-background/95 supports-backdrop-filter:backdrop-blur-md">
            <WorkspaceTabs />
            <DashboardHeader />
          </div>
          <PageTransition>{children}</PageTransition>
        </div>
      </div>
    </SidebarProvider>
  );
}
