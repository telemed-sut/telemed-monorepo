"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { AnimatePresence, motion } from "framer-motion";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Meeting } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/store/calendar-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

import { EventDetailSheet } from "./calendar-view";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

function getMonthStatusTone(status: Meeting["status"]) {
  switch (status) {
    case "waiting":
      return {
        dot: "bg-amber-500",
        surface: "bg-amber-100/95",
        text: "text-amber-900",
      };
    case "in_progress":
      return {
        dot: "bg-sky-500",
        surface: "bg-sky-100/95",
        text: "text-sky-900",
      };
    case "overtime":
      return {
        dot: "bg-rose-500",
        surface: "bg-rose-100/95",
        text: "text-rose-900",
      };
    case "completed":
      return {
        dot: "bg-emerald-500",
        surface: "bg-emerald-100/95",
        text: "text-emerald-900",
      };
    case "cancelled":
      return {
        dot: "bg-slate-400",
        surface: "bg-slate-200/90",
        text: "text-slate-600",
      };
    case "scheduled":
    default:
      return {
        dot: "bg-cyan-500",
        surface: "bg-cyan-100/92",
        text: "text-slate-900",
      };
  }
}

function getMeetingTitle(meeting: Meeting, language: AppLanguage) {
  return (
    meeting.description?.trim() ||
    `${meeting.patient?.first_name || ""} ${meeting.patient?.last_name || ""}`.trim() ||
    tr(language, "Appointment", "นัดหมาย")
  );
}

interface MonthCalendarViewProps {
  onEditMeeting?: (meeting: Meeting) => void;
  onGoToWeek: (date: Date) => void;
  onRefresh?: () => Promise<void> | void;
  onSlotSelect?: (slot: { date: Date; startHour: number; startMinute: number }) => void;
}

interface TransitionMeta {
  direction: 1 | -1;
  source: "button" | "wheel";
}

export function MonthCalendarView({
  onEditMeeting,
  onGoToWeek,
  onRefresh,
  onSlotSelect,
}: MonthCalendarViewProps) {
  const language = useLanguageStore((state) => state.language);
  const currentWeekStart = useCalendarStore((state) => state.currentWeekStart);
  const goToDate = useCalendarStore((state) => state.goToDate);
  const getFilteredMeetings = useCalendarStore((state) => state.getFilteredMeetings);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [transitionMeta, setTransitionMeta] = useState<TransitionMeta>({
    direction: 1,
    source: "button",
  });
  const wheelLockRef = useRef(false);
  const wheelDeltaAccumulatorRef = useRef(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const monthStart = useMemo(
    () => startOfMonth(currentWeekStart),
    [currentWeekStart]
  );

  const monthDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(monthStart, { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 }),
      }),
    [monthStart]
  );
  const monthWeekCount = monthDays.length / 7;

  const filteredMeetings = getFilteredMeetings();

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();

    for (const meeting of filteredMeetings) {
      const dayKey = new Date(meeting.date_time).toDateString();
      const existing = map.get(dayKey);
      if (existing) {
        existing.push(meeting);
      } else {
        map.set(dayKey, [meeting]);
      }
    }

    for (const value of map.values()) {
      value.sort(
        (left, right) =>
          new Date(left.date_time).getTime() - new Date(right.date_time).getTime()
      );
    }

    return map;
  }, [filteredMeetings]);

  const weekdayLabels = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(base);
      day.setDate(base.getDate() + index);
      return day.toLocaleDateString(localeOf(language), { weekday: "short" });
    });
  }, [language]);
  const navigateMonth = useCallback(
    (delta: number, source: TransitionMeta["source"] = "button") => {
      setTransitionMeta({
        direction: delta > 0 ? 1 : -1,
        source,
      });
      goToDate(addMonths(monthStart, delta));
    },
    [goToDate, monthStart]
  );

  const handleMonthWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        wheelDeltaAccumulatorRef.current = 0;
        const scrollHost = scrollViewportRef.current;
        if (!scrollHost) {
          return;
        }
        event.preventDefault();
        if (typeof scrollHost.scrollBy === "function") {
          scrollHost.scrollBy({ top: event.deltaY });
        } else {
          scrollHost.scrollTop += event.deltaY;
        }
        return;
      }

      if (wheelLockRef.current) {
        return;
      }

      event.preventDefault();

      const horizontalDirection = event.deltaX > 0 ? 1 : -1;
      if (
        wheelDeltaAccumulatorRef.current !== 0 &&
        Math.sign(wheelDeltaAccumulatorRef.current) !== horizontalDirection
      ) {
        wheelDeltaAccumulatorRef.current = 0;
      }

      wheelDeltaAccumulatorRef.current += event.deltaX;

      if (Math.abs(wheelDeltaAccumulatorRef.current) < 30) {
        return;
      }

      wheelLockRef.current = true;
      wheelDeltaAccumulatorRef.current = 0;
      navigateMonth(horizontalDirection, "wheel");

      window.setTimeout(() => {
        wheelLockRef.current = false;
        setTransitionMeta((current) =>
          current.source === "wheel" ? { ...current, source: "button" } : current
        );
      }, 420);
    },
    [navigateMonth]
  );

  const handleOverflowListWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.stopPropagation();
    },
    []
  );

  return (
    <div
      className="flex h-full min-h-[760px] flex-col overflow-hidden rounded-[30px] border border-slate-200/80 bg-slate-50/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] lg:min-h-[820px]"
      onWheel={handleMonthWheel}
    >
      <div className="grid shrink-0 grid-cols-7 border-b border-slate-200 bg-white/95">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="px-3 py-3 md:px-4"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {label}
            </span>
          </div>
        ))}
      </div>

      <div
        ref={scrollViewportRef}
        className="relative flex-1 overflow-auto overscroll-none bg-white"
      >
        <div
          className="relative bg-white"
          style={{ minHeight: `${monthWeekCount * 156}px` }}
        >
          <AnimatePresence custom={transitionMeta} initial={false}>
            <motion.div
            key={monthStart.toISOString()}
            initial={{
              x:
                transitionMeta.direction > 0
                  ? transitionMeta.source === "wheel"
                    ? 128
                    : 84
                  : transitionMeta.source === "wheel"
                    ? -128
                    : -84,
              opacity: transitionMeta.source === "wheel" ? 0.76 : 0.82,
              scale: transitionMeta.source === "wheel" ? 0.988 : 0.994,
            }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{
              x:
                transitionMeta.direction > 0
                  ? transitionMeta.source === "wheel"
                    ? -128
                    : -84
                  : transitionMeta.source === "wheel"
                    ? 128
                    : 84,
              opacity: transitionMeta.source === "wheel" ? 0.58 : 0.68,
              scale: transitionMeta.source === "wheel" ? 0.992 : 0.996,
            }}
            transition={
              transitionMeta.source === "wheel"
                ? {
                    type: "spring",
                    stiffness: 210,
                    damping: 28,
                    mass: 0.95,
                    opacity: { duration: 0.22, ease: "easeOut" },
                  }
                : {
                    duration: 0.3,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
              className="absolute inset-0 grid grid-cols-7 will-change-transform"
              style={{ gridTemplateRows: `repeat(${monthWeekCount}, minmax(0, 1fr))` }}
            >
              {monthDays.map((day) => {
              const dayMeetings = meetingsByDay.get(day.toDateString()) ?? [];
              const visibleLimit = monthWeekCount >= 6 ? 1 : 2;
              const visibleMeetings = dayMeetings.slice(0, visibleLimit);
              const overflowCount = Math.max(dayMeetings.length - visibleMeetings.length, 0);
              const isCurrentMonth = isSameMonth(day, monthStart);
              const today = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  onClick={() => {
                    if (!onSlotSelect) return;
                    onSlotSelect({
                      date: day,
                      startHour: 9,
                      startMinute: 0,
                    });
                  }}
                  className={cn(
                    "flex h-full min-h-0 flex-col border-b border-r border-slate-200 px-2 py-2 md:px-2.5 md:py-2.5",
                    onSlotSelect && "cursor-cell",
                    isCurrentMonth
                      ? "bg-white"
                      : "bg-slate-50/80",
                    today && "bg-sky-50/55"
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onGoToWeek(day);
                      }}
                      className={cn(
                        "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-sm font-semibold tracking-[-0.02em] transition-colors",
                        isCurrentMonth
                          ? "text-slate-700 hover:bg-slate-100"
                          : "text-slate-400 hover:bg-slate-100",
                        today && "bg-sky-600 text-white shadow-[0_6px_16px_rgba(2,132,199,0.26)] hover:bg-sky-600"
                      )}
                    >
                      {day.toLocaleDateString(localeOf(language), { day: "numeric" })}
                    </button>
                    <div
                      className={cn(
                        "h-px flex-1 bg-gradient-to-r from-slate-200/80 via-slate-100/80 to-transparent",
                        today && "from-sky-200/90 via-sky-100/90"
                      )}
                    />
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="grid min-h-0 content-start gap-1 overflow-hidden">
                      {visibleMeetings.length ? (
                        visibleMeetings.map((meeting) => {
                          const tone = getMonthStatusTone(meeting.status);
                          const title = getMeetingTitle(meeting, language);

                          return (
                            <button
                              key={meeting.id}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedMeeting(meeting);
                              }}
                              className={cn(
                                "flex min-h-7 items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-left transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:brightness-[0.98]",
                                tone.surface
                              )}
                            >
                              <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                  {new Date(meeting.date_time).toLocaleTimeString(localeOf(language), {
                                    hour: "numeric",
                                    minute: "2-digit",
                                    hour12: true,
                                  })}
                                </p>
                                <p className={cn("truncate text-[12px] font-semibold tracking-[-0.01em]", tone.text)}>
                                  {title}
                                </p>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="flex flex-1 items-start">
                          <div className="mt-2 h-px w-full bg-[linear-gradient(90deg,rgba(226,232,240,0.95),rgba(248,250,252,0.45),rgba(255,255,255,0))]" />
                        </div>
                      )}
                    </div>

                    {overflowCount > 0 ? (
                      <Popover
                        open={expandedDay?.toDateString() === day.toDateString()}
                        onOpenChange={(open) => {
                          setExpandedDay(open ? day : null);
                        }}
                      >
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                              className="mt-1.5 inline-flex shrink-0 items-center justify-start self-start rounded-md bg-white/92 px-2 py-1 text-[11px] font-semibold leading-none text-slate-600 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-slate-200/80 transition-colors hover:bg-slate-50 hover:text-slate-800"
                            >
                              {tr(
                                language,
                                `+${overflowCount} more`,
                                `+${overflowCount} นัด`
                              )}
                            </button>
                          }
                        />
                        <PopoverContent
                          side="right"
                          align="start"
                          sideOffset={8}
                          alignOffset={-16}
                          className="w-[min(82vw,264px)] gap-0 overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.98))] p-0 text-slate-900 shadow-[0_18px_42px_rgba(15,23,42,0.14)]"
                        >
                          <div className="border-b border-slate-200/80 px-3.5 pb-2.5 pt-3.5 text-center">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1" />
                              <div className="flex-1 text-center">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  {day.toLocaleDateString(localeOf(language), { weekday: "short" })}
                                </p>
                                <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-slate-900">
                                  {day.toLocaleDateString(localeOf(language), { day: "numeric" })}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setExpandedDay(null);
                                }}
                                className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                aria-label={tr(language, "Close", "ปิด")}
                              >
                                ×
                              </button>
                            </div>
                          </div>

                          <div
                            data-testid="month-day-overflow-scroll"
                            onWheelCapture={handleOverflowListWheel}
                            className="max-h-[320px] overflow-y-auto overscroll-contain px-2.5 py-2.5"
                          >
                            <div className="flex flex-col gap-1.5">
                              {dayMeetings.map((meeting) => {
                                const tone = getMonthStatusTone(meeting.status);
                                const title = getMeetingTitle(meeting, language);

                                return (
                                  <button
                                    key={meeting.id}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setExpandedDay(null);
                                      setSelectedMeeting(meeting);
                                    }}
                                    className={cn(
                                      "flex min-h-10 items-center gap-2 rounded-xl border border-white/80 px-3 py-2 text-left shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] transition-[transform,filter] duration-200 hover:-translate-y-0.5 hover:brightness-[0.98]",
                                      tone.surface
                                    )}
                                  >
                                    <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                        {new Date(meeting.date_time).toLocaleTimeString(localeOf(language), {
                                          hour: "numeric",
                                          minute: "2-digit",
                                          hour12: true,
                                        })}
                                      </p>
                                      <p className={cn("truncate text-[12px] font-semibold tracking-[-0.01em]", tone.text)}>
                                        {title}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                </div>
              );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <EventDetailSheet
        meeting={selectedMeeting}
        open={!!selectedMeeting}
        onOpenChange={(open) => {
          if (!open) setSelectedMeeting(null);
        }}
        onEdit={(meeting) => {
          setSelectedMeeting(null);
          onEditMeeting?.(meeting);
        }}
        onGoToCalendar={(meeting) => {
          setSelectedMeeting(null);
          onGoToWeek(new Date(meeting.date_time));
        }}
        onRefresh={onRefresh}
      />

    </div>
  );
}
