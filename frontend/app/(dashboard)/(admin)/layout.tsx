"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (hydrated && token && role && role !== "admin") {
      router.replace("/overview");
    }
  }, [hydrated, token, role, router]);

  if (!hydrated || !token || role !== "admin") return null;

  return <>{children}</>;
}
