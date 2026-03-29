"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const SecurityContent = dynamic(
  () => import("@/components/dashboard/security-content").then((mod) => mod.SecurityContent),
  {
    loading: () => <DashboardPageSkeleton variant="form" />,
  }
);

export default function SecurityPage() {
  return <SecurityContent />;
}
