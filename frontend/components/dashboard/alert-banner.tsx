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

export function AlertBanner() {
  const token = useAuthStore((state) => state.token);
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
          <span className="text-muted-foreground">You have </span>
          <span className="font-semibold">{todayCount} Appointment{todayCount !== 1 ? "s" : ""} Today,</span>
          <span> and </span>
          <span className="font-semibold">{pendingCount} Total Scheduled</span>
          <span className="text-muted-foreground"> consultations.</span>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" className="gap-2">
          <HugeiconsIcon icon={FileExportIcon} className="size-4" />
          Export
        </Button>
        <Button size="sm" className="gap-2 bg-[#7ac2f0] text-white hover:bg-[#5aade0]">
          <HugeiconsIcon icon={Calendar01Icon} className="size-4" />
          New Appointment
        </Button>
      </div>
    </div>
  );
}

