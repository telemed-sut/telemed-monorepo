"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MeetingsContent } from "@/components/dashboard/meetings-content";
import { Button } from "@/components/ui/button";
import { canViewClinicalData } from "@/lib/api";
import { t as tr } from "@/lib/i18n-utils";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";

export default function MeetingsPage() {
  const router = useRouter();
  const role = useAuthStore((state) => state.role);
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const language = useLanguageStore((state) => state.language);
  const canAccess = canViewClinicalData(role);

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
          <h1 className="text-xl font-semibold text-foreground">
            {tr(language, "Access denied", "ไม่มีสิทธิ์เข้าถึง")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr(
              language,
              "Meetings is available for admin, doctor, and medical student roles only.",
              "หน้านัดหมายใช้งานได้เฉพาะบทบาทผู้ดูแลระบบ แพทย์ และนักศึกษาแพทย์เท่านั้น"
            )}
          </p>
          <Button onClick={() => router.replace("/overview")}>
            {tr(language, "Back to Overview", "กลับไปหน้า Overview")}
          </Button>
        </div>
      </main>
    );
  }

  return <MeetingsContent />;
}
