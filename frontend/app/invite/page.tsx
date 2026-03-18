import type { Metadata } from "next";

import InviteRegisterClientPage from "./[token]/invite-register-client";

export const metadata: Metadata = {
  title: "Accept Invitation",
  description: "Complete account setup from an invitation link.",
};

export default function InviteRegisterPage() {
  return <InviteRegisterClientPage />;
}
