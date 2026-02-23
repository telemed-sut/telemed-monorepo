import { DenseModeDashboard } from "@/components/dense-mode/dense-mode-dashboard";

interface DenseModePageProps {
  params: Promise<{ id: string }>;
}

export default async function DenseModePage({ params }: DenseModePageProps) {
  const { id } = await params;
  return <DenseModeDashboard patientId={id} />;
}
