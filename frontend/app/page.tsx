import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard Overview",
  description: "Telemedicine dashboard overview.",
};

export default function HomePage() {
  redirect("/overview");
}
