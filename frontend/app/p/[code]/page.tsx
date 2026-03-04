import { redirect } from "next/navigation";

type ShortPatientJoinPageProps = {
  params: Promise<{ code: string }>;
};

export default async function ShortPatientJoinPage({
  params,
}: ShortPatientJoinPageProps) {
  const { code } = await params;
  redirect(`/patient/join?c=${encodeURIComponent(code)}`);
}
