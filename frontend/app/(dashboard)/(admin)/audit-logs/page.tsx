"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const AuditLogsContent = dynamic(
  () => import("@/components/dashboard/audit-logs-content").then((mod) => mod.AuditLogsContent),
  {
    loading: () => <DashboardPageSkeleton variant="table" />,
  }
);

export default function AuditLogsPage() {
  return <AuditLogsContent />;
}
