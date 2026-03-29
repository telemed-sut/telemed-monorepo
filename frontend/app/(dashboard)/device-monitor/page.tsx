"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const DeviceMonitorContent = dynamic(
  () =>
    import("@/components/dashboard/device-monitor-content").then(
      (mod) => mod.DeviceMonitorContent
    ),
  {
    loading: () => <DashboardPageSkeleton variant="monitor" />,
  }
);

export default function DeviceMonitorPage() {
  return <DeviceMonitorContent />;
}
