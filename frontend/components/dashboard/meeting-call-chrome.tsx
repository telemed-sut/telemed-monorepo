"use client";

import {
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  PhoneOff,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppLanguage } from "@/store/language-config";

type CallLoadingStep =
  | "checking-media"
  | "connecting-room"
  | "loading-video"
  | "entering-room";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

interface MeetingCallChromeProps {
  language: AppLanguage;
  isPopupWindow: boolean;
  patientName: string;
  patientInitial: string;
  appointmentLabel: string | null;
  modeSummary: string;
  callDuration: string | null;
  patientInviteUrl: string | null;
  copiedInvite: boolean;
  isMiniWindowPending: boolean;
  showStandbyState: boolean;
  callEnded: boolean;
  loading: boolean;
  error: string | null;
  overallTimedOut: boolean;
  loadingTitle: string;
  loadingDescription: string;
  loadingHint: string | null;
  loadingStep: CallLoadingStep;
  stageStuck: boolean;
  onCopyInvite: () => void;
  onOpenMiniWindow: () => void;
  onReturnFromMiniWindow: () => void;
  onFocusMiniWindow: () => void;
  onBack: () => void;
  onRetryJoin: () => void;
}

export function MeetingCallChrome({
  language,
  isPopupWindow,
  patientName,
  patientInitial,
  appointmentLabel,
  modeSummary,
  callDuration,
  patientInviteUrl,
  copiedInvite,
  isMiniWindowPending,
  showStandbyState,
  callEnded,
  loading,
  error,
  overallTimedOut,
  loadingTitle,
  loadingDescription,
  loadingHint,
  loadingStep,
  stageStuck,
  onCopyInvite,
  onOpenMiniWindow,
  onReturnFromMiniWindow,
  onFocusMiniWindow,
  onBack,
  onRetryJoin,
}: MeetingCallChromeProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-[linear-gradient(180deg,rgba(2,6,23,0.42),rgba(2,6,23,0))]" />
      <div className="absolute left-3 right-3 top-3 z-30 flex flex-col gap-2.5 md:flex-row md:items-start md:justify-between">
        <div className="pointer-events-auto max-w-[min(100%,320px)] rounded-[22px] border border-white/10 bg-slate-950/56 px-3 py-2.5 text-white shadow-[0_12px_32px_rgba(15,23,42,0.2)] backdrop-blur-lg">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/95">
              {patientName ? patientInitial : <UserRound className="size-4 text-white/80" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white/95">
                {patientName || tr(language, "Doctor Video Call", "ห้องวิดีโอแพทย์")}
              </p>
              {appointmentLabel ? (
                <div className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-[11px] text-slate-200/68">
                  <Clock3 className="size-3 shrink-0" />
                  <span className="truncate">{appointmentLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isPopupWindow ? (
              <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-white/78">
                {modeSummary}
              </span>
            ) : null}
            {callDuration !== null ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/18 bg-emerald-400/10 px-2 py-1 text-[10px] font-medium tabular-nums text-white/92">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {callDuration}
              </span>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 rounded-full border border-white/10 bg-slate-950/56 p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur-lg">
          {patientInviteUrl && !isPopupWindow ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full border border-cyan-200/35 bg-cyan-200 px-3 text-[11px] font-semibold text-slate-950 shadow-[0_10px_24px_rgba(34,211,238,0.18)] hover:bg-cyan-100 focus-visible:ring-cyan-200/70"
              onClick={onCopyInvite}
            >
              {copiedInvite ? (
                <Check className="mr-1.5 size-3.5" />
              ) : (
                <Copy className="mr-1.5 size-3.5" />
              )}
              {copiedInvite
                ? tr(language, "Copied!", "คัดลอกแล้ว!")
                : tr(language, "Copy patient link", "คัดลอกลิงก์คนไข้")}
            </Button>
          ) : null}
          {!isPopupWindow && !showStandbyState ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 rounded-full border border-white/18 bg-white/96 px-3 text-[11px] font-medium text-slate-900 shadow-sm hover:bg-white focus-visible:ring-white/60"
              onClick={onOpenMiniWindow}
              disabled={isMiniWindowPending}
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              {isMiniWindowPending
                ? tr(language, "Opening mini window", "กำลังเปิดหน้าต่างเล็ก")
                : tr(language, "Open mini window", "เปิดหน้าต่างเล็ก")}
            </Button>
          ) : null}
          {showStandbyState ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 rounded-full border border-white/18 bg-white/96 px-3 text-[11px] font-medium text-slate-900 shadow-sm hover:bg-white focus-visible:ring-white/60"
              onClick={onReturnFromMiniWindow}
            >
              <ArrowLeft className="mr-1.5 size-3.5" />
              {tr(language, "Return to main call", "กลับมาที่หน้าหลัก")}
            </Button>
          ) : null}
          {showStandbyState ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full border border-white/12 bg-white/[0.05] px-3 text-[11px] font-medium text-white shadow-sm backdrop-blur-md hover:bg-white/[0.09] focus-visible:ring-white/50"
              onClick={onFocusMiniWindow}
            >
              <ExternalLink className="mr-1.5 size-3.5" />
              {tr(language, "Focus mini window", "โฟกัสหน้าต่างเล็ก")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full border border-white/12 bg-white/[0.05] px-3 text-[11px] font-medium text-white shadow-sm backdrop-blur-md hover:bg-white/[0.09] focus-visible:ring-white/50"
            onClick={onBack}
          >
            <ArrowLeft className="mr-1.5 size-3.5" />
            {isPopupWindow
              ? tr(language, "Close Mini", "ปิดหน้าต่างเล็ก")
              : tr(language, "Back to meetings", "กลับหน้านัดหมาย")}
          </Button>
        </div>
      </div>

      {showStandbyState ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-[28px] border border-white/12 bg-slate-950/76 p-6 text-white shadow-[0_28px_80px_rgba(15,23,42,0.42)] backdrop-blur-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100/80">
              {tr(language, "Mini Window Active", "กำลังใช้หน้าต่างเล็ก")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {tr(language, "Call is continuing in the mini window", "คอลกำลังทำงานอยู่ในหน้าต่างเล็ก")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {tr(
                language,
                "Close the mini window to bring the call back here automatically, or use the button below to return now.",
                "ปิดหน้าต่างเล็กเพื่อดึงคอลกลับมาที่หน้านี้อัตโนมัติ หรือกดปุ่มด้านล่างเพื่อกลับมาทันที"
              )}
            </p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <Button
                className="h-11 rounded-full bg-cyan-200 px-4 text-sm font-semibold text-slate-950 shadow-[0_12px_28px_rgba(34,211,238,0.22)] hover:bg-cyan-100"
                onClick={onReturnFromMiniWindow}
              >
                <ArrowLeft className="mr-2 size-4" />
                {tr(language, "Return to main call", "กลับมาที่หน้าหลัก")}
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full border border-white/14 bg-white/[0.04] px-4 text-sm font-medium text-white hover:bg-white/[0.08]"
                onClick={onFocusMiniWindow}
              >
                <ExternalLink className="mr-2 size-4" />
                {tr(language, "Open mini window", "เปิดหน้าต่างเล็ก")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {callEnded && !showStandbyState ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-5">
          <div className="w-full max-w-[580px] rounded-[30px] border border-slate-700/70 bg-slate-950/94 p-6 text-white shadow-[0_24px_72px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:p-7">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-[18px] border border-slate-700 bg-slate-900 text-slate-100">
                    <PhoneOff className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {tr(language, "Session closed", "ปิดเซสชันแล้ว")}
                    </span>
                    <h2 className="mt-3 text-[30px] font-semibold leading-[1.08] tracking-tight text-white sm:text-[32px]">
                      {tr(language, "You have left the room", "คุณได้ออกจากห้องแล้ว")}
                    </h2>
                    <p className="mt-2 max-w-[40ch] text-sm leading-6 text-slate-300 sm:text-[15px]">
                      {tr(
                        language,
                        "Restart the consultation from here, or return to the appointments view if this session is finished.",
                        "คุณสามารถเริ่มคอลใหม่จากหน้านี้ หรือกลับไปที่หน้านัดหมายหากเซสชันนี้เสร็จสิ้นแล้ว"
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid shrink-0 gap-2 sm:min-w-[200px]">
                  <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                      {tr(language, "Patient", "ผู้ป่วย")}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-100">
                      <UserRound className="size-4 text-slate-400" />
                      <span className="truncate">
                        {patientName || tr(language, "Current appointment", "นัดหมายปัจจุบัน")}
                      </span>
                    </div>
                  </div>
                  {appointmentLabel ? (
                    <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-2.5">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        {tr(language, "Appointment time", "เวลานัดหมาย")}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-100">
                        <Clock3 className="size-4 text-slate-400" />
                        <span className="truncate">{appointmentLabel}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-700/80 bg-slate-900/70 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                  {tr(language, "Next action", "การทำงานต่อ")}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {tr(
                    language,
                    "Use restart when the consultation should continue now. Go back to appointments when you are done and want to manage other work.",
                    "ใช้ปุ่มเริ่มคอลใหม่เมื่อต้องการตรวจต่อทันที หรือกลับหน้านัดหมายเมื่อทำรายการนี้เสร็จแล้วและต้องไปทำงานอื่น"
                  )}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  className="h-12 w-full cursor-pointer rounded-2xl bg-cyan-100 px-5 text-sm font-semibold text-slate-950 shadow-[0_10px_24px_rgba(103,232,249,0.16)] transition-colors duration-200 hover:bg-cyan-50"
                  onClick={onRetryJoin}
                >
                  {tr(language, "Start call again", "เริ่มคอลใหม่")}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 cursor-pointer rounded-2xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-medium text-slate-100 transition-colors duration-200 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                  onClick={onBack}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  {tr(language, "Back to meetings", "กลับหน้านัดหมาย")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error && !loading && !callEnded && !showStandbyState ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-[28px] border border-white/12 bg-slate-950/82 p-6 text-white shadow-[0_28px_80px_rgba(15,23,42,0.42)] backdrop-blur-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-100/80">
              {tr(language, "Call setup issue", "มีปัญหาระหว่างตั้งค่าคอล")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {tr(language, "We could not open the call", "ยังไม่สามารถเปิดคอลได้")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{error}</p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <Button
                className="h-11 rounded-full bg-cyan-200 px-4 text-sm font-semibold text-slate-950 shadow-[0_12px_28px_rgba(34,211,238,0.22)] hover:bg-cyan-100"
                onClick={onRetryJoin}
              >
                {tr(language, "Retry call", "ลองเปิดคอลใหม่")}
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full border border-white/14 bg-white/[0.04] px-4 text-sm font-medium text-white hover:bg-white/[0.08]"
                onClick={onBack}
              >
                <ArrowLeft className="mr-2 size-4" />
                {tr(language, "Back to meetings", "กลับหน้านัดหมาย")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/34 p-5">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/78 p-5 text-white shadow-[0_24px_72px_rgba(2,6,23,0.38)] backdrop-blur-xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100/80">
              {tr(language, "Loading call", "กำลังโหลดห้องคอล")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {overallTimedOut
                ? tr(language, "Connection is taking too long", "การเชื่อมต่อใช้เวลานานเกินไป")
                : loadingTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {overallTimedOut
                ? tr(
                    language,
                    "We could not establish the call within the expected time. Please check your internet connection and try again.",
                    "ไม่สามารถเชื่อมต่อห้องคอลได้ในเวลาที่กำหนด กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
                  )
                : loadingDescription}
            </p>
            <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full bg-cyan-200 transition-all duration-500",
                  loadingStep === "checking-media"
                    ? "w-[28%]"
                    : loadingStep === "connecting-room"
                      ? "w-[55%]"
                      : loadingStep === "loading-video"
                        ? "w-[78%]"
                        : "w-[92%]"
                )}
              />
              <div
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                style={{ animation: "shimmer 1.8s ease-in-out infinite" }}
              />
              <style>{`@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
            </div>
            {loadingHint ? (
              <p className="mt-3 text-xs leading-5 text-cyan-100/78">
                {loadingHint}
              </p>
            ) : null}
            {stageStuck && !overallTimedOut ? (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  className="h-9 rounded-full bg-cyan-200 px-4 text-xs font-semibold text-slate-950 shadow-[0_8px_20px_rgba(34,211,238,0.18)] hover:bg-cyan-100"
                  onClick={onRetryJoin}
                >
                  {tr(language, "Retry now", "ลองใหม่")}
                </Button>
                <span className="text-xs text-slate-400">
                  {tr(language, "This step is taking longer than usual", "ขั้นตอนนี้ช้ากว่าปกติ")}
                </span>
              </div>
            ) : null}
            {overallTimedOut ? (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  className="h-9 rounded-full bg-cyan-200 px-4 text-xs font-semibold text-slate-950 shadow-[0_8px_20px_rgba(34,211,238,0.18)] hover:bg-cyan-100"
                  onClick={onRetryJoin}
                >
                  {tr(language, "Retry now", "ลองใหม่")}
                </Button>
                <span className="text-xs text-slate-400">
                  {tr(language, "Timed out — please retry", "หมดเวลา — กรุณาลองใหม่")}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
