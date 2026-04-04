"use client";

import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

import { useOverviewStats } from "@/components/dashboard/overview-stats-context";

const I18N: Record<
  AppLanguage,
  {
    ready: string;
    summary: string;
    action: string;
  }
> = {
  en: {
    ready: "Today's clinical activity is ready.",
    summary: "This home screen shows privacy-filtered summaries only.",
    action: "Open Meetings or Patients for exact details.",
  },
  th: {
    ready: "กิจกรรมทางคลินิกของวันนี้พร้อมใช้งานแล้ว",
    summary: "หน้าหลักนี้จะแสดงเฉพาะข้อมูลสรุปที่กรองเพื่อความเป็นส่วนตัว",
    action: "เปิดหน้าการนัดหมายหรือหน้าผู้ป่วยเพื่อดูรายละเอียดจริง",
  },
};

export function AlertBanner() {
  const language = useLanguageStore((state) => state.language);
  const t = I18N[language];
  const { stats } = useOverviewStats();

  return (
    <div className="flex items-start gap-3 sm:items-center">
      <span className="text-3xl">🩺</span>
      <p className="text-sm leading-relaxed sm:text-[0.95rem]">
        <span className="font-semibold">{t.ready}</span>{" "}
        <span className="text-muted-foreground">{t.summary}</span>{" "}
        {stats ? <span>{t.action}</span> : null}
      </p>
    </div>
  );
}
