import { PatientDetailContent } from "@/components/dashboard/patient-detail";

interface PatientDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { id } = await params;
  return <PatientDetailContent patientId={id} />;
}
