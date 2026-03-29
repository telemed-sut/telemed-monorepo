import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const PatientDetailContent = dynamic(
  () =>
    import("@/components/dashboard/patient-detail").then(
      (mod) => mod.PatientDetailContent
    ),
  {
    loading: () => <DashboardPageSkeleton variant="detail" />,
  }
);

interface PatientDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { id } = await params;
  return <PatientDetailContent patientId={id} />;
}
