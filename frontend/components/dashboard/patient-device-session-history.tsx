"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Monitor, Stethoscope, Waves } from "lucide-react";

import {
  fetchDeviceExamSessions,
  type DeviceExamMeasurementType,
  type DeviceExamSession,
} from "@/lib/api";
import type { AppLanguage } from "@/store/language-config";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function measurementLabel(value: DeviceExamMeasurementType, language: AppLanguage) {
  switch (value) {
    case "lung_sound":
      return tr(language, "Lung sound", "เสียงปอด");
    case "heart_sound":
      return tr(language, "Heart sound", "เสียงหัวใจ");
    case "blood_pressure":
      return tr(language, "Blood pressure", "ความดัน");
    default:
      return tr(language, "Multi-mode", "หลายโหมด");
  }
}

function measurementIcon(value: DeviceExamMeasurementType) {
  switch (value) {
    case "lung_sound":
      return Stethoscope;
    case "heart_sound":
      return Activity;
    case "blood_pressure":
      return Waves;
    default:
      return Monitor;
  }
}

function statusBadgeClass(status: DeviceExamSession["status"]) {
  if (status === "active") return "border-sky-300 bg-sky-50 text-sky-700";
  if (status === "pending_pair") return "border-amber-300 bg-amber-50 text-amber-700";
  if (status === "stale") return "border-orange-300 bg-orange-50 text-orange-700";
  if (status === "review_needed") return "border-rose-300 bg-rose-50 text-rose-700";
  if (status === "completed") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function statusLabel(status: DeviceExamSession["status"], language: AppLanguage) {
  switch (status) {
    case "active":
      return tr(language, "Active", "กำลังตรวจ");
    case "pending_pair":
      return tr(language, "Pending", "รอจับคู่");
    case "stale":
      return tr(language, "Stale", "ขาดช่วง");
    case "review_needed":
      return tr(language, "Needs review", "ต้องตรวจสอบ");
    case "completed":
      return tr(language, "Completed", "เสร็จแล้ว");
    default:
      return tr(language, "Cancelled", "ยกเลิก");
  }
}

function formatDateTime(value: string | null, language: AppLanguage) {
  if (!value) return tr(language, "Not recorded", "ยังไม่มีข้อมูล");
  return new Date(value).toLocaleString(language === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type PatientDeviceSessionHistoryProps = {
  token: string | null;
  patientId: string;
  language: AppLanguage;
};

export function PatientDeviceSessionHistory({
  token,
  patientId,
  language,
}: PatientDeviceSessionHistoryProps) {
  const [items, setItems] = useState<DeviceExamSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const loadSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDeviceExamSessions(token, {
          patientId,
          limit: 8,
          offset: 0,
        });
        if (!cancelled) {
          setItems(response.items ?? []);
          setTotal(response.total ?? 0);
        }
      } catch {
        if (!cancelled) {
          setError(tr(language, "Device session history could not be loaded.", "ยังโหลดประวัติ session อุปกรณ์ไม่ได้"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [language, patientId, token]);

  const latestActive = useMemo(
    () => items.find((item) => item.status === "active" || item.status === "pending_pair" || item.status === "stale"),
    [items],
  );

  return (
    <Card className="rounded-[28px] border-border/70 bg-card shadow-sm">
      <CardContent className="space-y-5 px-5 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {tr(language, "Device Sessions", "ประวัติการใช้อุปกรณ์")}
            </p>
            <h2 className="text-lg font-semibold text-foreground">
              {tr(language, "Examination device history", "ประวัติเครื่องที่ใช้ตรวจ")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr(
                language,
                "Tracks which device examined this patient during each session.",
                "ติดตามว่าผู้ป่วยรายนี้เคยตรวจด้วยเครื่องใดในแต่ละ session",
              )}
            </p>
          </div>
          <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
            {total} {tr(language, "sessions", "session")}
          </Badge>
        </div>

        {latestActive && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4">
            <div className="flex items-start gap-3">
              <Monitor className="mt-0.5 size-5 text-sky-700" />
              <div>
                <p className="text-sm font-medium text-sky-950">
                  {tr(language, "Current device session", "session อุปกรณ์ปัจจุบัน")}
                </p>
                <p className="mt-1 text-sm text-sky-800">
                  {latestActive.device_id} · {measurementLabel(latestActive.measurement_type, language)}
                </p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {tr(language, "No device sessions recorded yet.", "ยังไม่มีประวัติ session อุปกรณ์")}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((session) => {
              const Icon = measurementIcon(session.measurement_type);
              return (
                <div
                  key={session.id}
                  className="grid gap-3 rounded-2xl border border-border/80 bg-background p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{session.device_id}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {measurementLabel(session.measurement_type, language)}
                      </p>
                      {session.pairing_code && (
                        <p className="mt-1 font-mono text-xs tracking-[0.16em] text-muted-foreground">
                          {session.pairing_code}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end">
                    <Badge
                      variant="outline"
                      className={cn("w-fit rounded-full border px-2.5 py-1 text-[0.72rem] font-medium", statusBadgeClass(session.status))}
                    >
                      {statusLabel(session.status, language)}
                    </Badge>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {formatDateTime(session.started_at ?? session.created_at, language)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
