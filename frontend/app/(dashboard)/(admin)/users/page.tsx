"use client";

import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const UsersContent = dynamic(
  () => import("@/components/dashboard/users-content").then((mod) => mod.UsersContent),
  {
    loading: () => <DashboardPageSkeleton variant="table" />,
  }
);

export default function UsersPage() {
  return <UsersContent />;
}
