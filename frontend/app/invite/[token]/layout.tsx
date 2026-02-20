import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Accept Invitation",
  description: "Complete account setup from an invitation link.",
};

export default function InviteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
