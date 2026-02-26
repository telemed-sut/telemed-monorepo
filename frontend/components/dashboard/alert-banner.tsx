"use client";

import { useEffect, useState } from "react";
import { fetchOverviewStats } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const I18N: Record<
  AppLanguage,
  {
    youHave: string;
    appointmentsToday: (count: number) => string;
    and: string;
    totalScheduled: string;
    consultations: string;
  }
> = {
  en: {
    youHave: "You have",
    appointmentsToday: (count) =>
      `${count} Appointment${count !== 1 ? "s" : ""} Today,`,
    and: "and",
    totalScheduled: "Total Scheduled",
    consultations: "consultations.",
  },
  th: {
    youHave: "วันนี้คุณมี",
    appointmentsToday: (count) => `${count} นัดหมาย`,
    and: "และมี",
    totalScheduled: "นัดหมายทั้งหมด",
    consultations: "",
  },
};

export function AlertBanner() {
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);
  const t = I18N[language];
  const [todayCount, setTodayCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetchOverviewStats(token)
      .then((res) => {
        setTodayCount(res.kpis.today_consultations);
        setPendingCount(res.totals.meetings);
      })
      .catch(() => {});
  }, [token]);

  return (
    <div className="flex items-start sm:items-center gap-4">
      <span className="text-4xl">🩺</span>
      <p className="text-sm sm:text-base leading-relaxed">
        <span className="text-muted-foreground">{t.youHave} </span>
        <span className="font-semibold">{t.appointmentsToday(todayCount)}</span>
        <span> {t.and} </span>
        <span className="font-semibold">{pendingCount} {t.totalScheduled}</span>
        <span className="text-muted-foreground"> {t.consultations}</span>
      </p>
    </div>
  );
}
