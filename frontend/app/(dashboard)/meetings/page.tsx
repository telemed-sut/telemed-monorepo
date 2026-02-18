"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MeetingsContent } from "@/components/dashboard/meetings-content";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth-store";

export default function MeetingsPage() {
  const router = useRouter();
  const role = useAuthStore((state) => state.role);
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const canAccess = role === "admin" || role === "doctor";

  useEffect(() => {
    if (hydrated && token && !canAccess) {
      router.replace("/overview");
    }
  }, [hydrated, token, canAccess, router]);

  if (!hydrated || !token) return null;

  if (!canAccess) {
    return (
      <main className="flex h-full w-full items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-foreground">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Meetings is available for admin and doctor roles only.
          </p>
          <Button onClick={() => router.replace("/overview")}>
            Back to Overview
          </Button>
        </div>
      </main>
    );
  }

  return <MeetingsContent />;
}
