"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const DeviceRegistryContent = dynamic(
  () =>
    import("@/components/dashboard/device-registry-content").then(
      (mod) => mod.DeviceRegistryContent
    ),
  {
    loading: () => <DashboardPageSkeleton variant="table" />,
  }
);

export default function DeviceRegistryPage() {
  return <DeviceRegistryContent />;
}
