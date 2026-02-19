"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FileExportIcon,
  Calendar01Icon,
} from "@hugeicons/core-free-icons";
import { fetchMeetings } from "@/lib/api";
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
    export: string;
    newAppointment: string;
  }
> = {
  en: {
    youHave: "You have",
    appointmentsToday: (count) =>
      `${count} Appointment${count !== 1 ? "s" : ""} Today,`,
    and: "and",
    totalScheduled: "Total Scheduled",
    consultations: "consultations.",
    export: "Export",
    newAppointment: "New Appointment",
  },
  th: {
    youHave: "วันนี้คุณมี",
    appointmentsToday: (count) => `${count} นัดหมาย`,
    and: "และมี",
    totalScheduled: "นัดหมายทั้งหมด",
    consultations: "",
    export: "ส่งออก",
    newAppointment: "นัดหมายใหม่",
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
    fetchMeetings({ page: 1, limit: 1000 }, token)
      .then((res) => {
        const today = new Date().toDateString();
        const todayMeetings = res.items.filter(
          (m) => new Date(m.date_time).toDateString() === today
        );
        setTodayCount(todayMeetings.length);
        setPendingCount(res.total);
      })
      .catch(() => {});
  }, [token]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="gap-2">
          <HugeiconsIcon icon={FileExportIcon} className="size-4" />
          {t.export}
        </Button>
        <Button size="sm" className="gap-2 bg-[#7ac2f0] text-white hover:bg-[#5aade0]">
          <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
          {t.newAppointment}
        </Button>
      </div>
    </div>
  );
}
