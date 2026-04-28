"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const DeviceOperationsContent = dynamic(
  () =>
    import("@/components/dashboard/device-operations-content").then(
      (mod) => mod.DeviceOperationsContent,
    ),
  {
    loading: () => <DashboardPageSkeleton variant="monitor" />,
  },
);

export default function DeviceOperationsPage() {
  return <DeviceOperationsContent />;
}
