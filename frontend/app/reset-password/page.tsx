import type { Metadata } from "next";

import ResetPasswordClientPage from "./reset-password-client";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Set a new account password using your reset token.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordClientPage initialToken="" />;
}
