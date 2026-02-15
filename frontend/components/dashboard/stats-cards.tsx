"use client";

import { useEffect, useState } from "react";
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

interface StatItem {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
  subtitleIcon: any;
}

export function StatsCards() {
  const token = useAuthStore((state) => state.token);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatItem[]>([
    {
      title: "Total Patients",
      value: "—",
      subtitle: "Loading...",
      icon: UserGroupIcon,
      subtitleIcon: InformationCircleIcon,
    },
    {
      title: "Today's Appointments",
      value: "—",
      subtitle: "Loading...",
      icon: Calendar01Icon,
      subtitleIcon: InformationCircleIcon,
    },
    {
      title: "This Week",
      value: "—",
      subtitle: "Loading...",
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
            title: "Total Patients",
            value: patientsData.total.toString(),
            subtitle: `+${newThisMonth} this month`,
            icon: UserGroupIcon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: "Today's Appointments",
            value: todayMeetings.length.toString(),
            subtitle: `${meetingsData.total} total scheduled`,
            icon: Calendar01Icon,
            subtitleIcon: InformationCircleIcon,
          },
          {
            title: "This Week",
            value: thisWeekMeetings.length.toString(),
            subtitle: `${todayMeetings.length} today`,
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
  }, [token]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="relative p-5 rounded-xl border bg-card overflow-hidden">
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

