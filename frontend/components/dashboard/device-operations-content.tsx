"use client";

import { Activity, Cpu, Waves } from "lucide-react";

import { DeviceMonitorLiveOps } from "@/components/dashboard/device-monitor-live-ops";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/store/auth-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

function localeOf(language: AppLanguage) {
  return APP_LOCALE_MAP[language] ?? "en-US";
}

export function DeviceOperationsContent() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const language = useLanguageStore((state) => state.language);
  const canViewOperations =
    role === "admin" || role === "doctor" || role === "medical_student";
  const canManageSessions = role === "admin" || role === "doctor";

  if (!canViewOperations) {
    return (
      <main className="flex-1 overflow-auto bg-slate-50/80 p-3 sm:p-5 lg:p-7">
        <div className="mx-auto max-w-7xl">
          <Card>
            <CardHeader>
              <CardTitle>{tr(language, "Access required", "ต้องมีสิทธิ์เข้าถึง")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {tr(
                language,
                "You do not have permission to view device operations.",
                "คุณไม่มีสิทธิ์ดูหน้าปฏิบัติการอุปกรณ์",
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-auto bg-slate-50/80 p-3 sm:p-5 lg:p-7">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 border-b border-slate-100 px-5 py-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-sky-50 text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50">
                  {tr(language, "Live workflow", "เวิร์กโฟลว์สด")}
                </Badge>
                <Badge className="bg-violet-50 text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50">
                  {tr(language, "Session-based mapping", "จับคู่แบบเป็นรอบตรวจ")}
                </Badge>
              </div>
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.12em] text-slate-500">
                  {tr(language, "Device workspace", "พื้นที่ทำงานอุปกรณ์")}
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                  {tr(language, "Device Operations", "ปฏิบัติการอุปกรณ์")}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {tr(
                    language,
                    "Start and switch examination sessions in real time, keep device-to-patient pairing clean per visit, and review unmatched uploads from one dedicated workspace.",
                    "เริ่มและสลับรอบตรวจแบบเรียลไทม์ แยกการจับคู่เครื่องกับผู้ป่วยเป็นรายรอบตรวจ และตรวจสอบข้อมูลที่ยังจับคู่ไม่ได้จากหน้าเดียว",
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="border-slate-200 shadow-none">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-2xl bg-sky-50 p-2 text-sky-700">
                    <Activity className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-950">
                      {tr(language, "Live pairing", "จับคู่สด")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {tr(
                        language,
                        "Know exactly which patient each device is examining right now.",
                        "รู้ได้ทันทีว่าเครื่องไหนกำลังตรวจผู้ป่วยคนใดอยู่ตอนนี้",
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-200 shadow-none">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-2xl bg-violet-50 p-2 text-violet-700">
                    <Cpu className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-950">
                      {tr(language, "Flexible devices", "เครื่องยืดหยุ่น")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {tr(
                        language,
                        "One machine can examine many patients without mixing records across visits.",
                        "หนึ่งเครื่องใช้ตรวจผู้ป่วยหลายคนได้ โดยไม่ทำให้ข้อมูลต่างรอบปนกัน",
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-200 shadow-none">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="rounded-2xl bg-emerald-50 p-2 text-emerald-700">
                    <Waves className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-950">
                      {tr(language, "Fast review", "ตรวจทานเร็ว")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {tr(
                        language,
                        "Catch transition overlaps and late packets before they confuse the care team.",
                        "จับกรณีสลับเคสทับซ้อนหรือข้อมูลเข้าช้า ก่อนทำให้ทีมรักษาสับสน",
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          <div className="px-5 py-4 text-xs text-slate-500">
            {tr(language, "Updated for local time", "อัปเดตตามเวลาท้องถิ่น")} ·{" "}
            {new Date().toLocaleString(localeOf(language), {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        </section>

        <DeviceMonitorLiveOps
          token={token}
          language={language}
          autoRefreshEnabled
          refreshIntervalMs={5000}
          canManageSessions={canManageSessions}
        />
      </div>
    </main>
  );
}
