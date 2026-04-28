import type { Metadata } from "next";
import { Suspense } from "react";

import LoginClientPage from "./login-client";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to the telemedicine dashboard.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginClientPage />
    </Suspense>
  );
}
