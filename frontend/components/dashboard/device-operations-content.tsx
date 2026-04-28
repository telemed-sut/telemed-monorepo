"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { DeviceMonitorLiveOps } from "@/components/dashboard/device-monitor-live-ops";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";

export function DeviceOperationsContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const language = useLanguageStore((state) => state.language);
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/overview");
    }
  }, [isAdmin, router]);

  if (!isAdmin) {
    return null;
  }

  return (
    <main className="flex-1 overflow-auto bg-slate-50/80 p-3 sm:p-5 lg:p-7">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <DeviceMonitorLiveOps
          token={token}
          language={language}
          autoRefreshEnabled
          refreshIntervalMs={5000}
          canManageSessions={isAdmin}
        />
      </div>
    </main>
  );
}
