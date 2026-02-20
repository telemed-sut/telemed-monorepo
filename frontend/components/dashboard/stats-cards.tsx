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
import { fetchPatients, fetchMeetings } from "@/lib/api";
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
        const [patientsData, meetingsData] = await Promise.all([
          fetchPatients({ page: 1, limit: 10000 }, token),
          fetchMeetings({ page: 1, limit: 10000 }, token),
        ]);

        const today = new Date().toISOString().split("T")[0];
        const todayMeetings = meetingsData.items.filter((m) =>
          m.date_time?.startsWith(today)
        );

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);

        const thisWeekMeetings = meetingsData.items.filter((m) => {
          const d = new Date(m.date_time);
          return d >= startOfWeek && d < endOfWeek;
        });

        const monthStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        ).toISOString();
        const newThisMonth = patientsData.items.filter(
          (p) => p.created_at && p.created_at >= monthStart
        ).length;

        setStats([
          {
            title: t.totalPatients,
            value: patientsData.total.toString(),
            subtitle: t.thisMonth(newThisMonth),
            icon: UserGroupIcon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: t.todayAppointments,
            value: todayMeetings.length.toString(),
            subtitle: t.totalScheduled(meetingsData.total),
            icon: Calendar01Icon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: t.thisWeek,
            value: thisWeekMeetings.length.toString(),
            subtitle: t.todayCount(todayMeetings.length),
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[1, 2, 3].map((slot) => (
          <div key={slot} className="relative p-5 rounded-xl border bg-card overflow-hidden">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-16 mb-4" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      {stats.map((stat) => (
        <div
          key={stat.title}
          className="relative p-5 rounded-xl border bg-card overflow-hidden"
        >
          <div className="absolute inset-0 bg-linear-to-br from-black/5 to-transparent pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <div className="flex flex-col gap-6">
              <p className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </p>
              <p className="text-2xl sm:text-[26px] font-semibold tracking-tight">
                {stat.value}
              </p>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <HugeiconsIcon icon={stat.subtitleIcon} className="size-4" />
                <span className="text-sm font-medium">{stat.subtitle}</span>
              </div>
            </div>
            <Button variant="outline" size="icon" className="size-10">
              <HugeiconsIcon icon={stat.icon} className="size-5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
