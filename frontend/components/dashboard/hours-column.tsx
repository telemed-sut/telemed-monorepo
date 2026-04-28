"use client";

import { HOURS_24, HOUR_HEIGHT } from "@/store/calendar-store";
import { t as tr } from "@/lib/i18n-utils";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";

const WEEK_LEFT_RAIL_CLASS = "w-[88px] md:w-[104px]";

function formatHourLabel(index: number, language: "en" | "th"): string {
  const hour = index % 24;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  if (language === "th") {
    return `${displayHour} ${period === "AM" ? "เช้า" : "บ่าย"}`;
  }
  return `${displayHour} ${period}`;
}

export function HoursColumn() {
  const language = useLanguageStore((state) => state.language);

  return (
    <div
      className={cn(
        "relative sticky left-0 z-30 shrink-0 border-r border-slate-200/85 bg-white",
        WEEK_LEFT_RAIL_CLASS
      )}
    >
      <div className="sticky top-0 z-10 border-b border-slate-200/90 bg-white/95 px-3 pb-2 pt-3 backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {tr(language, "Time", "เวลา")}
        </p>
      </div>
      {HOURS_24.map((hour, index) => (
        <div
          key={hour}
          className="relative border-b border-slate-200/80 bg-white last:border-b-0"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="absolute -top-[0.72em] left-2 bg-white px-1 py-0.5 text-[11px] font-medium leading-none text-slate-500 md:left-3 md:text-xs">
            {index > 0 ? formatHourLabel(index, language) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
