import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to the telemedicine dashboard.",
};

export default function LoginLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
