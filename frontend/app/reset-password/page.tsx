import type { Metadata } from "next";

import ResetPasswordClientPage from "./reset-password-client";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Set a new account password using your reset token.",
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tokenParam = searchParams?.token;
  const initialToken = Array.isArray(tokenParam) ? (tokenParam[0] ?? "") : (tokenParam ?? "");
  return <ResetPasswordClientPage initialToken={initialToken} />;
}
