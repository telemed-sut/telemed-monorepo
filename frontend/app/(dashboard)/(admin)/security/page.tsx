import { redirect } from "next/navigation";

export default function SecurityPage() {
  redirect("/settings?panel=security");
}
