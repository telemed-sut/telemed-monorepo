import dynamic from "next/dynamic";

import { DashboardPageSkeleton } from "@/components/dashboard/dashboard-page-skeletons";

const PatientHeartSoundContent = dynamic(
  () =>
    import("@/components/dashboard/patient-heart-sound").then(
      (mod) => mod.PatientHeartSoundContent
    ),
  {
    loading: () => <DashboardPageSkeleton variant="detail" />,
  }
);

interface PatientHeartSoundPageProps {
  params: Promise<{ id: string }>;
}

export default async function PatientHeartSoundPage({
  params,
}: PatientHeartSoundPageProps) {
  const { id } = await params;
  return <PatientHeartSoundContent patientId={id} />;
}
