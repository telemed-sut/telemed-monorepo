"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserGroupIcon,
  Calendar01Icon,
  InformationCircleIcon,
  Stethoscope02Icon,
} from "@hugeicons/core-free-icons";
import { fetchOverviewStats } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const I18N: Record<
  AppLanguage,
  {
    totalPatients: string;
    todayAppointments: string;
    thisWeek: string;
    loading: string;
    thisMonth: (count: number) => string;
    totalScheduled: (count: number) => string;
    todayCount: (count: number) => string;
  }
> = {
  en: {
    totalPatients: "Total Patients",
    todayAppointments: "Today's Appointments",
    thisWeek: "This Week",
    loading: "Loading...",
    thisMonth: (count) => `+${count} this month`,
    totalScheduled: (count) => `${count} total scheduled`,
    todayCount: (count) => `${count} today`,
  },
  th: {
    totalPatients: "ผู้ป่วยทั้งหมด",
    todayAppointments: "นัดหมายวันนี้",
    thisWeek: "สัปดาห์นี้",
    loading: "กำลังโหลด...",
    thisMonth: (count) => `+${count} เดือนนี้`,
    totalScheduled: (count) => `นัดหมายทั้งหมด ${count}`,
    todayCount: (count) => `${count} วันนี้`,
  },
};

interface StatItem {
  title: string;
  value: string;
  subtitle: string;
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  subtitleIcon: ComponentProps<typeof HugeiconsIcon>["icon"];
}

export function StatsCards() {
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);
  const t = I18N[language];
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatItem[]>([
    {
      title: t.totalPatients,
      value: "—",
      subtitle: t.loading,
      icon: UserGroupIcon,
      subtitleIcon: InformationCircleIcon,
    },
    {
      title: t.todayAppointments,
      value: "—",
      subtitle: t.loading,
      icon: Calendar01Icon,
      subtitleIcon: InformationCircleIcon,
    },
    {
      title: t.thisWeek,
      value: "—",
      subtitle: t.loading,
      icon: Stethoscope02Icon,
      subtitleIcon: InformationCircleIcon,
    },
  ]);

  useEffect(() => {
    if (!token) return;

    const loadStats = async () => {
      try {
        const statsData = await fetchOverviewStats(token);
        const todayMeetings = statsData.kpis.today_consultations;
        const thisWeekMeetings = statsData.kpis.this_week_consultations;
        const newThisMonth = statsData.kpis.this_month_new_patients;

        setStats([
          {
            title: t.totalPatients,
            value: statsData.totals.patients.toString(),
            subtitle: t.thisMonth(newThisMonth),
            icon: UserGroupIcon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: t.todayAppointments,
            value: todayMeetings.toString(),
            subtitle: t.totalScheduled(statsData.totals.meetings),
            icon: Calendar01Icon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: t.thisWeek,
            value: thisWeekMeetings.toString(),
            subtitle: t.todayCount(todayMeetings),
            icon: Stethoscope02Icon,
            subtitleIcon: InformationCircleIcon,
          },
        ]);
      } catch {
        // keep defaults
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, [token, t]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((slot) => (
          <div key={slot} className="relative overflow-hidden rounded-xl border bg-card p-5">
            <Skeleton className="mb-3 h-4 w-28" />
            <Skeleton className="mb-3 h-8 w-20" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.title}
          className="relative overflow-hidden rounded-xl border bg-card p-5"
        >
          <div className="absolute inset-0 bg-linear-to-br from-black/5 to-transparent pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </p>
              <p className="text-[1.7rem] font-semibold tracking-tight sm:text-[1.9rem]">
                {stat.value}
              </p>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <HugeiconsIcon icon={stat.subtitleIcon} className="size-3.5" />
                <span className="text-sm font-medium">{stat.subtitle}</span>
              </div>
            </div>
            <Button variant="outline" size="icon" className="size-10">
              <HugeiconsIcon icon={stat.icon} className="size-4.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
