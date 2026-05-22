"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useTokenRefresh } from "@/hooks/use-token-refresh";
import { useAuthStore } from "@/store/auth-store";

import { AppShell } from "@/components/app-shell";
import {
  DashboardPageSkeleton,
  type DashboardPageSkeletonVariant,
} from "@/components/dashboard/dashboard-page-skeletons";
import { PageTransition } from "@/components/dashboard/page-transition";

function getDashboardSkeletonVariant(
  pathname: string
): DashboardPageSkeletonVariant {
  if (pathname === "/" || pathname === "/overview") {
    return "overview";
  }

  if (pathname === "/meetings") {
    return "calendar";
  }

  if (pathname.startsWith("/meetings/call/")) {
    return "call";
  }

  if (pathname === "/settings" || pathname === "/profile" || pathname === "/security") {
    return "form";
  }

  if (pathname === "/device-monitor") {
    return "monitor";
  }

  if (pathname.startsWith("/patients/")) {
    return "detail";
  }

  return "table";
}

export function DashboardShell({
  children,
  serverRole,
  sidebarDefaultOpen,
}: {
  children: React.ReactNode;
  serverRole: string | null;
  sidebarDefaultOpen: boolean;
}) {
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

  if (!hydrated) {
    if (isCallPopupWindow) {
      return (
        <main className="h-svh w-full bg-background" aria-busy="true">
          <DashboardPageSkeleton variant="call" />
        </main>
      );
    }

    return (
      <AppShell serverRole={serverRole} sidebarDefaultOpen={sidebarDefaultOpen}>
        <DashboardPageSkeleton variant={getDashboardSkeletonVariant(pathname)} />
      </AppShell>
    );
  }

  if (!token) {
    return <main className="min-h-screen bg-background" aria-busy="true" />;
  }

  if (isCallPopupWindow) {
    return <main className="h-svh w-full bg-background">{children}</main>;
  }

  return (
    <AppShell serverRole={serverRole} sidebarDefaultOpen={sidebarDefaultOpen}>
      <PageTransition>{children}</PageTransition>
    </AppShell>
  );
}
