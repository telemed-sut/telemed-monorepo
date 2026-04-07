"use client";

import { useState } from "react";
import { isToday } from "date-fns";

import { t as tr } from "@/lib/i18n-utils";
import { cn } from "@/lib/utils";
import { HOURS_24, HOUR_HEIGHT } from "@/store/calendar-store";
import { useLanguageStore } from "@/store/language-store";

import { CurrentTimeIndicator } from "./current-time-indicator";

const WEEK_DAY_COLUMN_CLASS = "min-w-[170px] flex-1 basis-0 xl:min-w-[180px]";

interface CalendarSlotSelection {
  date: Date;
  startHour: number;
  startMinute: number;
  endHour?: number;
  endMinute?: number;
}

interface DayColumnProps {
  date: Date;
  scrollRef: (el: HTMLDivElement | null) => void;
  onSlotSelect?: (slot: CalendarSlotSelection) => void;
}

function formatSelectionTimeRange(
  startMinuteOfDay: number,
  endMinuteOfDay: number,
  language: "en" | "th"
): string {
  const formatMinute = (totalMinutes: number) => {
    const safeMinutes = Math.max(0, Math.min(totalMinutes, 24 * 60));
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    const date = new Date();
    date.setHours(Math.min(hours, 23), minutes, 0, 0);
    return date.toLocaleTimeString(language === "th" ? "th-TH" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return `${formatMinute(startMinuteOfDay)} - ${formatMinute(endMinuteOfDay)}`;
}

export function DayColumn({ date, scrollRef, onSlotSelect }: DayColumnProps) {
  const language = useLanguageStore((state) => state.language);
  const today = isToday(date);
  const columnHeight = HOURS_24.length * HOUR_HEIGHT;
  const [selection, setSelection] = useState<{
    pointerId: number;
    startMinute: number;
    currentMinute: number;
  } | null>(null);

  const resolveSnappedMinute = (clientY: number, rect: DOMRect) => {
    const y = Math.min(Math.max(clientY - rect.top, 0), columnHeight - 1);
    const minuteInDay = Math.floor((y / HOUR_HEIGHT) * 60);
    return Math.max(0, Math.min(Math.floor(minuteInDay / 15) * 15, 23 * 60 + 45));
  };

  const emitSelection = (startMinuteOfDay: number, endMinuteOfDay: number) => {
    if (!onSlotSelect) return;

    const normalizedEndMinute =
      endMinuteOfDay >= 24 * 60 ? 23 * 60 + 59 : endMinuteOfDay;

    onSlotSelect({
      date: new Date(date),
      startHour: Math.floor(startMinuteOfDay / 60),
      startMinute: startMinuteOfDay % 60,
      endHour: Math.floor(normalizedEndMinute / 60),
      endMinute: normalizedEndMinute % 60,
    });
  };

  const finalizeSelection = (draft: {
    startMinute: number;
    currentMinute: number;
  }) => {
    const lowerBound = Math.min(draft.startMinute, draft.currentMinute);
    const upperBound = Math.max(draft.startMinute, draft.currentMinute);
    const isClickSelection = upperBound === lowerBound;
    const endMinuteOfDay = isClickSelection
      ? Math.min(lowerBound + 60, 24 * 60)
      : Math.min(upperBound + 15, 24 * 60);

    emitSelection(lowerBound, endMinuteOfDay);
  };

  const previewStartMinute = selection
    ? Math.min(selection.startMinute, selection.currentMinute)
    : null;
  const previewEndMinute = selection
    ? (() => {
        const lowerBound = Math.min(selection.startMinute, selection.currentMinute);
        const upperBound = Math.max(selection.startMinute, selection.currentMinute);
        return upperBound === lowerBound
          ? Math.min(lowerBound + 60, 24 * 60)
          : Math.min(upperBound + 15, 24 * 60);
      })()
    : null;
  const previewTop =
    previewStartMinute !== null ? (previewStartMinute / 60) * HOUR_HEIGHT : null;
  const previewHeight =
    previewStartMinute !== null && previewEndMinute !== null
      ? Math.max(((previewEndMinute - previewStartMinute) / 60) * HOUR_HEIGHT, 24)
      : null;

  return (
    <div
      ref={scrollRef}
      className={cn(
        "relative border-r border-slate-200/85 last:border-r-0",
        WEEK_DAY_COLUMN_CLASS,
        today
          ? "bg-[linear-gradient(180deg,rgba(14,165,233,0.06),rgba(240,249,255,0.92)_14%,rgba(255,255,255,1))]"
          : "bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(248,250,252,0.88))]"
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.75),rgba(255,255,255,0))]" />
      <div
        className={cn("relative", onSlotSelect && "cursor-cell")}
        style={{ height: columnHeight }}
        onPointerDown={(event) => {
          if (!onSlotSelect || event.button !== 0) return;
          const minute = resolveSnappedMinute(
            event.clientY,
            event.currentTarget.getBoundingClientRect()
          );
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelection({
            pointerId: event.pointerId,
            startMinute: minute,
            currentMinute: minute,
          });
        }}
        onPointerMove={(event) => {
          if (!selection || selection.pointerId !== event.pointerId) return;
          const minute = resolveSnappedMinute(
            event.clientY,
            event.currentTarget.getBoundingClientRect()
          );
          setSelection((current) =>
            current && current.pointerId === event.pointerId
              ? { ...current, currentMinute: minute }
              : current
          );
        }}
        onPointerUp={(event) => {
          if (!selection || selection.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          finalizeSelection(selection);
          setSelection(null);
        }}
        onPointerCancel={() => {
          setSelection(null);
        }}
        role="button"
        tabIndex={0}
        aria-disabled={!onSlotSelect}
        onKeyDown={(event) => {
          if (!onSlotSelect) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
          }
        }}
      >
        {HOURS_24.map((hour) => (
          <div
            key={`slot-${hour}`}
            className="border-b border-slate-200/80 transition-colors duration-200 hover:bg-sky-50/60"
            style={{ height: HOUR_HEIGHT }}
          />
        ))}
        {previewTop !== null && previewHeight !== null ? (
          <div
            className="pointer-events-none absolute inset-x-2 z-20 overflow-hidden rounded-[12px] border border-sky-300/90 bg-sky-100/85 shadow-[0_10px_18px_rgba(14,165,233,0.12)]"
            style={{ top: previewTop + 3, height: Math.max(previewHeight - 6, 18) }}
          >
            <div className="border-b border-sky-200/90 bg-sky-100/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800">
              {previewStartMinute !== null && previewEndMinute !== null
                ? formatSelectionTimeRange(previewStartMinute, previewEndMinute, language)
                : null}
            </div>
            <div className="px-3 py-2 text-[12px] font-semibold text-sky-900">
              {tr(language, "New appointment", "นัดหมายใหม่")}
            </div>
          </div>
        ) : null}
        {today && <CurrentTimeIndicator />}
      </div>
    </div>
  );
}
