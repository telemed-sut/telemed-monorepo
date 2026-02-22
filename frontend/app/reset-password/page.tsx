import type { Metadata } from "next";

import ResetPasswordClientPage from "./reset-password-client";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Set a new account password using your reset token.",
};

interface ResetPasswordPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const resolvedParams = await searchParams;
  const tokenParam = resolvedParams?.token;
  const initialToken = Array.isArray(tokenParam) ? (tokenParam[0] ?? "") : (tokenParam ?? "");
  return <ResetPasswordClientPage initialToken={initialToken} />;
}
