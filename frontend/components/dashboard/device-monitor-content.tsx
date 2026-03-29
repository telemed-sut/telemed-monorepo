"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { fetchDeviceStats, fetchDeviceErrors, DeviceStats, DeviceErrorLog } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Download,
  RefreshCw,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { toast } from "@/components/ui/toast";
import { sileo } from "sileo";

type ChartType = "bar" | "line" | "area";
type TimePreset = "today" | "yesterday" | "7d" | "30d" | "custom";
type ComparisonDirection = "up" | "down" | "flat";

interface SavedMonitorView {
  id: string;
  name: string;
  chartType: ChartType;
  showGrid: boolean;
  timePreset: TimePreset;
  customFromDate: string;
  customToDate: string;
  selectedDeviceIds: string[];
}

const SAVED_MONITOR_VIEWS_KEY = "device-monitor.saved-views.v1";
const MAX_MONITOR_LOOKBACK_HOURS = 24 * 90;
const refreshIntervalOptions = [1000, 2000, 5000, 10000] as const;

type RiskLevel = "stable" | "warning" | "critical";

const DeviceMonitorInsights = dynamic(
  () =>
    import("./device-monitor-insights").then((mod) => mod.DeviceMonitorInsights),
  {
    loading: () => (
      <div className="grid gap-4">
        <Card>
          <CardContent className="h-28 animate-pulse bg-muted/40" />
        </Card>
        <Card>
          <CardContent className="h-36 animate-pulse bg-muted/40" />
        </Card>
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardContent className="h-[520px] animate-pulse bg-muted/40" />
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardContent className="h-56 animate-pulse bg-muted/40" />
            </Card>
            <Card>
              <CardContent className="h-64 animate-pulse bg-muted/40" />
            </Card>
          </div>
        </div>
        <Card>
          <CardContent className="h-72 animate-pulse bg-muted/40" />
        </Card>
      </div>
    ),
  }
);

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

function classifyErrorType(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("battery")) return "Battery";
  if (normalized.includes("checksum") || normalized.includes("crc")) return "Data Integrity";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "Timeout";
  if (
    normalized.includes("connect") ||
    normalized.includes("network") ||
    normalized.includes("unreachable")
  ) {
    return "Connectivity";
  }
  if (
    normalized.includes("auth") ||
    normalized.includes("token") ||
    normalized.includes("unauthorized")
  ) {
    return "Authentication";
  }
  if (normalized.includes("validation") || normalized.includes("invalid")) return "Validation";
  return "Other";
}

function formatTrendLabel(timestamp: number, rangeHours: number, language: AppLanguage) {
  const date = new Date(timestamp);
  if (rangeHours <= 24) {
    return date.toLocaleTimeString(localeOf(language), { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(localeOf(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

function toInputDate(date: Date): string {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function toLocalTimeString(date: Date, language: AppLanguage): string {
  return date.toLocaleString(localeOf(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hoursBetween(start: Date, end: Date): number {
  const raw = Math.ceil((end.getTime() - start.getTime()) / (60 * 60 * 1000));
  return Math.min(MAX_MONITOR_LOOKBACK_HOURS, Math.max(1, raw));
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  const escaped = text.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function formatRefreshInterval(ms: number, language: AppLanguage): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms % 1000 === 0) {
    const sec = ms / 1000;
    return language === "th" ? `${sec} วินาที` : `${sec}s`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function getPresetLabel(preset: TimePreset, language: AppLanguage): string {
  if (preset === "today") return tr(language, "Today", "วันนี้");
  if (preset === "yesterday") return tr(language, "Yesterday", "เมื่อวาน");
  if (preset === "7d") return tr(language, "Last 7 Days", "7 วันล่าสุด");
  if (preset === "30d") return tr(language, "Last 30 Days", "30 วันล่าสุด");
  return tr(language, "Custom Range", "ช่วงกำหนดเอง");
}

function getDateWindow(
  preset: TimePreset,
  customFromDate: string,
  customToDate: string
): { start: Date; end: Date; rangeHours: number } | null {
  const now = new Date();

  if (preset === "today") {
    const start = startOfDay(now);
    return { start, end: now, rangeHours: hoursBetween(start, now) };
  }

  if (preset === "yesterday") {
    const base = new Date(now);
    base.setDate(base.getDate() - 1);
    const start = startOfDay(base);
    const end = endOfDay(base);
    return { start, end, rangeHours: hoursBetween(start, end) };
  }

  if (preset === "7d" || preset === "30d") {
    const days = preset === "7d" ? 7 : 30;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end: now, rangeHours: hoursBetween(start, now) };
  }

  if (!customFromDate || !customToDate) return null;
  const start = startOfDay(new Date(`${customFromDate}T00:00:00`));
  const end = endOfDay(new Date(`${customToDate}T00:00:00`));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const orderedStart = start.getTime() <= end.getTime() ? start : end;
  const orderedEnd = start.getTime() <= end.getTime() ? end : start;
  return { start: orderedStart, end: orderedEnd, rangeHours: hoursBetween(orderedStart, orderedEnd) };
}

function getComparisonDirection(diff: number): ComparisonDirection {
  if (diff > 0) return "up";
  if (diff < 0) return "down";
  return "flat";
}

function mergeDeviceErrors(current: DeviceErrorLog[], incoming: DeviceErrorLog[], maxItems = 500) {
  if (incoming.length === 0) return current;

  const merged = new Map<number, DeviceErrorLog>();
  current.forEach((item) => merged.set(item.id, item));
  incoming.forEach((item) => merged.set(item.id, item));

  return Array.from(merged.values())
    .sort((a, b) => {
      const tsDiff = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
      if (tsDiff !== 0) return tsDiff;
      return b.id - a.id;
    })
    .slice(0, maxItems);
}

export function DeviceMonitorContent() {
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);

  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [errors, setErrors] = useState<DeviceErrorLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorObj, setErrorObj] = useState<Error | null>(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(1000);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [showGrid, setShowGrid] = useState(true);
  const [timePreset, setTimePreset] = useState<TimePreset>("today");
  const [customFromDate, setCustomFromDate] = useState<string>(() => toInputDate(new Date()));
  const [customToDate, setCustomToDate] = useState<string>(() => toInputDate(new Date()));
  const [errorRateThreshold, setErrorRateThreshold] = useState(5);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<SavedMonitorView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string>("");
  const [latestErrorActivityAt, setLatestErrorActivityAt] = useState<string | null>(null);
  const [comparisonStats, setComparisonStats] = useState<DeviceStats | null>(null);
  const [deviceHealthPageSize, setDeviceHealthPageSize] = useState(10);
  const [deviceHealthPageIndex, setDeviceHealthPageIndex] = useState(0);
  const isFetchingAllRef = useRef(false);
  const isFetchingStatsRef = useRef(false);
  const isFetchingErrorsRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastErrorCursorRef = useRef<number | null>(null);
  const windowRefreshMarker = lastUpdated?.getTime() ?? 0;
  const activeWindow = useMemo(
    () => {
      void windowRefreshMarker;
      return getDateWindow(timePreset, customFromDate, customToDate);
    },
    [timePreset, customFromDate, customToDate, windowRefreshMarker]
  );
  const rangeHours = activeWindow?.rangeHours ?? 24;
  const rangeLabel = useMemo(() => {
    if (!activeWindow) return tr(language, "Invalid date range", "ช่วงเวลาไม่ถูกต้อง");
    if (timePreset !== "custom") return getPresetLabel(timePreset, language);
    return `${toLocalTimeString(activeWindow.start, language)} - ${toLocalTimeString(activeWindow.end, language)}`;
  }, [activeWindow, language, timePreset]);
  const previousWindow = useMemo(() => {
    if (!activeWindow) return null;
    const durationMs = activeWindow.end.getTime() - activeWindow.start.getTime();
    const end = new Date(activeWindow.start.getTime());
    const start = new Date(end.getTime() - durationMs);
    return {
      start,
      end,
      rangeHours: hoursBetween(start, end),
      label: `${toLocalTimeString(start, language)} - ${toLocalTimeString(end, language)}`,
    };
  }, [activeWindow, language]);
  const windowSelectionKey = `${timePreset}__${customFromDate}__${customToDate}`;
  const statsRefreshIntervalMs = useMemo(
    () => Math.max(5000, refreshIntervalMs * 5),
    [refreshIntervalMs]
  );

  const toLoadError = useCallback(
    (error: unknown) =>
      error instanceof Error
        ? error
        : new Error(tr(language, "Failed to load device data", "โหลดข้อมูลอุปกรณ์ไม่สำเร็จ")),
    [language]
  );

  const loadStats = useCallback(
    async (throwOnError: boolean = false) => {
      if (!token || isFetchingStatsRef.current) return;
      const activeRange = getDateWindow(timePreset, customFromDate, customToDate);
      if (!activeRange) return;
      const durationMs = activeRange.end.getTime() - activeRange.start.getTime();
      const previousRange = {
        start: new Date(activeRange.start.getTime() - durationMs),
        end: new Date(activeRange.start.getTime()),
        rangeHours: hoursBetween(
          new Date(activeRange.start.getTime() - durationMs),
          new Date(activeRange.start.getTime())
        ),
      };
      isFetchingStatsRef.current = true;
      try {
        const [statsData, prevStats] = await Promise.all([
          fetchDeviceStats(token, activeRange.rangeHours, {
            topDevices: 50,
            dateFrom: activeRange.start.toISOString(),
            dateTo: activeRange.end.toISOString(),
          }),
          fetchDeviceStats(token, previousRange.rangeHours, {
            topDevices: 50,
            dateFrom: previousRange.start.toISOString(),
            dateTo: previousRange.end.toISOString(),
          }),
        ]);
        setStats(statsData);
        setComparisonStats(prevStats);
      } catch (error) {
        if (throwOnError) throw error;
      } finally {
        isFetchingStatsRef.current = false;
      }
    },
    [token, timePreset, customFromDate, customToDate]
  );

  const loadErrors = useCallback(
    async (forceFullSync: boolean = false, throwOnError: boolean = false) => {
      if (!token || isFetchingErrorsRef.current) return;
      const activeRange = getDateWindow(timePreset, customFromDate, customToDate);
      if (!activeRange) return;
      isFetchingErrorsRef.current = true;
      try {
        const isLiveWindow = activeRange.end.getTime() >= Date.now() - 90_000;
        const shouldUseIncremental = Boolean(
          isLiveWindow && !forceFullSync && lastErrorCursorRef.current
        );
        const errorLogs = await fetchDeviceErrors(token, {
          limit: 500,
          since: activeRange.start.toISOString(),
          until: activeRange.end.toISOString(),
          sinceId: shouldUseIncremental ? (lastErrorCursorRef.current ?? undefined) : undefined,
        });

        setErrors((prev) => {
          const next = shouldUseIncremental ? mergeDeviceErrors(prev, errorLogs, 500) : errorLogs;

          const latestId = next.reduce((maxId, item) => Math.max(maxId, item.id), 0);
          lastErrorCursorRef.current = latestId > 0 ? latestId : null;
          return next;
        });
      } catch (error) {
        if (throwOnError) throw error;
      } finally {
        isFetchingErrorsRef.current = false;
      }
    },
    [token, timePreset, customFromDate, customToDate]
  );

  const loadLatestErrorActivity = useCallback(async () => {
    if (!token) return;
    try {
      const latestLog = await fetchDeviceErrors(token, { limit: 1 });
      setLatestErrorActivityAt(latestLog[0]?.occurred_at ?? null);
    } catch {
      // Keep last-known timestamp when request fails.
    }
  }, [token]);

  const jumpToLatestDataWindow = useCallback(() => {
    if (!latestErrorActivityAt) {
      setTimePreset("7d");
      return;
    }
    const latestDate = new Date(latestErrorActivityAt);
    if (!Number.isFinite(latestDate.getTime())) {
      setTimePreset("7d");
      return;
    }
    const dateText = toInputDate(latestDate);
    setCustomFromDate(dateText);
    setCustomToDate(dateText);
    setTimePreset("custom");
  }, [latestErrorActivityAt]);

  const applySavedView = useCallback(
    (viewId: string) => {
      const view = savedViews.find((item) => item.id === viewId);
      if (!view) return;
      setChartType(view.chartType);
      setShowGrid(view.showGrid);
      setTimePreset(view.timePreset);
      setCustomFromDate(view.customFromDate);
      setCustomToDate(view.customToDate);
      setSelectedDeviceIds(view.selectedDeviceIds);
      setActiveSavedViewId(view.id);
    },
    [savedViews]
  );

  const saveCurrentViewByName = useCallback((name: string) => {
    const nextView: SavedMonitorView = {
      id: `${Date.now()}`,
      name,
      chartType,
      showGrid,
      timePreset,
      customFromDate,
      customToDate,
      selectedDeviceIds,
    };
    setSavedViews((prev) => [nextView, ...prev].slice(0, 12));
    setActiveSavedViewId(nextView.id);
    return nextView;
  }, [chartType, customFromDate, customToDate, selectedDeviceIds, showGrid, timePreset]);

  const openSaveViewToast = useCallback(() => {
    const inputId = `save-view-name-${Date.now()}`;
    let composerToastId = "";
    let isSubmitting = false;
    let removeOutsidePointerListener: (() => void) | null = null;

    const detachOutsidePointerListener = () => {
      if (removeOutsidePointerListener) {
        removeOutsidePointerListener();
        removeOutsidePointerListener = null;
      }
    };

    const cancelSaveToast = () => {
      detachOutsidePointerListener();
      if (composerToastId) {
        sileo.dismiss(composerToastId);
      }
    };

    const confirmSaveToast = () => {
      if (isSubmitting) return;
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      const name = input?.value.trim() ?? "";
      if (!name) {
        toast.warning(
          tr(language, "View name is required", "กรุณาตั้งชื่อมุมมอง"),
          {
            position: "top-center",
            description: tr(
              language,
              "Please enter a name before saving.",
              "โปรดกรอกชื่อก่อนบันทึกมุมมอง"
            ),
          }
        );
        input?.focus();
        return;
      }

      isSubmitting = true;
      saveCurrentViewByName(name);
      detachOutsidePointerListener();
      if (composerToastId) {
        sileo.dismiss(composerToastId);
      }
      sileo.success({
        title: tr(language, "View Saved", "บันทึกมุมมองแล้ว"),
        position: "top-center",
        duration: 1200,
        fill: "#f7fff8",
        roundness: 999,
        styles: {
          title: "!text-emerald-600 !font-medium",
        },
      });
    };

    composerToastId = sileo.action({
      title: tr(language, "Save View", "บันทึกมุมมอง"),
      position: "top-center",
      duration: null,
      fill: "#f8f9fc",
      roundness: 18,
      styles: {
        title: "!text-[#2563eb] !font-medium",
        description: "!text-slate-600",
      },
      description: (
        <div className="space-y-3 pt-1">
          <input
            id={inputId}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
            placeholder={tr(language, "Enter view name", "ตั้งชื่อมุมมอง")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmSaveToast();
              }
            }}
          />
          <div>
            <a
              href="#"
              data-sileo-button
              className="!w-full !justify-center !text-blue-700 !bg-blue-100 hover:!bg-blue-200"
              onClick={(event) => {
                event.preventDefault();
                confirmSaveToast();
              }}
            >
              {tr(language, "OK", "ตกลง")}
            </a>
          </div>
        </div>
      ),
    });

    window.setTimeout(() => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.focus();

      const toastElement = input?.closest("[data-sileo-toast]");
      if (!toastElement) return;

      const handleOutsidePointerDown = (event: PointerEvent) => {
        const targetNode = event.target as Node | null;
        if (!targetNode || toastElement.contains(targetNode)) return;
        cancelSaveToast();
      };

      document.addEventListener("pointerdown", handleOutsidePointerDown, true);
      removeOutsidePointerListener = () => {
        document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      };
    }, 50);
  }, [language, saveCurrentViewByName]);

  const removeActiveSavedView = useCallback(() => {
    if (!activeSavedViewId) return;
    setSavedViews((prev) => prev.filter((item) => item.id !== activeSavedViewId));
    setActiveSavedViewId("");
  }, [activeSavedViewId]);

  const loadData = useCallback(
    async (forceFullSync: boolean = false) => {
      if (!token || isFetchingAllRef.current) return;
      if (!getDateWindow(timePreset, customFromDate, customToDate)) return;

      isFetchingAllRef.current = true;
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) {
        setLoading(true);
      }
      setIsRefreshing(true);
      setErrorObj(null);
      try {
        await Promise.all([
          loadStats(true),
          loadErrors(forceFullSync, true),
          loadLatestErrorActivity(),
        ]);
        setLastUpdated(new Date());
      } catch (error) {
        setErrorObj(toLoadError(error));
      } finally {
        if (isInitialLoad) {
          setLoading(false);
          hasLoadedRef.current = true;
        }
        setIsRefreshing(false);
        isFetchingAllRef.current = false;
      }
    },
    [token, timePreset, customFromDate, customToDate, loadStats, loadErrors, loadLatestErrorActivity, toLoadError]
  );

  const refreshErrorsOnly = useCallback(async () => {
    try {
      await loadErrors(false, false);
      await loadLatestErrorActivity();
      setLastUpdated(new Date());
    } catch {
      // Keep stale data on background refresh errors.
    }
  }, [loadErrors, loadLatestErrorActivity]);

  const refreshStatsOnly = useCallback(async () => {
    try {
      await loadStats(false);
      setLastUpdated(new Date());
    } catch {
      // Keep stale data on background refresh errors.
    }
  }, [loadStats]);

  const allDeviceErrorData = useMemo(() => {
    if (!stats) return [];
    return [...stats.errors_by_device]
      .map((item) => ({ ...item, count: Number(item.count) || 0 }))
      .filter((item) => item.device_id.trim().length > 0)
      .sort((a, b) => b.count - a.count);
  }, [stats]);
  const availableDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    allDeviceErrorData.forEach((item) => ids.add(item.device_id));
    errors.forEach((log) => ids.add(log.device_id));
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [allDeviceErrorData, errors]);
  const selectedDeviceSet = useMemo(() => new Set(selectedDeviceIds), [selectedDeviceIds]);
  const scopedAllDeviceErrorData = useMemo(() => {
    if (selectedDeviceIds.length === 0) return allDeviceErrorData;
    return allDeviceErrorData.filter((item) => selectedDeviceSet.has(item.device_id));
  }, [allDeviceErrorData, selectedDeviceIds.length, selectedDeviceSet]);
  const deviceErrorDataWithCount = useMemo(
    () => scopedAllDeviceErrorData.filter((item) => item.count > 0),
    [scopedAllDeviceErrorData]
  );
  const deviceChartData = deviceErrorDataWithCount.slice(0, 8);

  const totalDeviceErrors = useMemo(
    () => deviceErrorDataWithCount.reduce((acc, item) => acc + item.count, 0),
    [deviceErrorDataWithCount]
  );
  const isTrendChart = chartType !== "bar";

  const filteredErrors = useMemo(() => {
    if (!activeWindow) return [];
    const fromMs = activeWindow.start.getTime();
    const toMs = activeWindow.end.getTime();
    return errors.filter((log) => {
      const ts = new Date(log.occurred_at).getTime();
      return Number.isFinite(ts) && ts >= fromMs && ts <= toMs;
    });
  }, [errors, activeWindow]);

  const scopedInsightErrors = useMemo(() => {
    if (selectedDeviceIds.length === 0) return filteredErrors;
    return filteredErrors.filter((log) => selectedDeviceSet.has(log.device_id));
  }, [filteredErrors, selectedDeviceIds.length, selectedDeviceSet]);

  const recentScopedErrors = useMemo(() => {
    return [...scopedInsightErrors].sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );
  }, [scopedInsightErrors]);

  const trendChartData = useMemo(() => {
    if (!activeWindow) return [];
    const fromMs = activeWindow.start.getTime();
    const nowMs = activeWindow.end.getTime();
    const rangeMs = Math.max(1, nowMs - fromMs);
    const bucketCount = rangeHours <= 24 ? 8 : rangeHours <= 168 ? 12 : 16;
    const bucketMs = Math.floor(rangeMs / bucketCount);

    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = fromMs + index * bucketMs;
      const bucketEnd = index === bucketCount - 1 ? nowMs : bucketStart + bucketMs;
      return {
        label: formatTrendLabel(bucketEnd, rangeHours, language),
        count: 0,
        bucketStart,
        bucketEnd,
      };
    });

    filteredErrors.forEach((log) => {
      const ts = new Date(log.occurred_at).getTime();
      const bucketIndex = buckets.findIndex(
        (bucket) => ts >= bucket.bucketStart && ts <= bucket.bucketEnd
      );
      if (bucketIndex >= 0) {
        buckets[bucketIndex].count += 1;
      }
    });

    return buckets.map(({ label, count }) => ({ label, count }));
  }, [filteredErrors, activeWindow, rangeHours, language]);

  const errorTypeData = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    scopedInsightErrors.forEach((log) => {
      const type = classifyErrorType(log.error_message);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const typeColorMap: Record<string, string> = {
      Battery: "#f59e0b",
      "Data Integrity": "#ef4444",
      Timeout: "#f97316",
      Connectivity: "#8b5cf6",
      Authentication: "#ec4899",
      Validation: "#06b6d4",
      Other: "#94a3b8",
    };

    return Object.entries(typeCounts)
      .map(([type, count]) => ({
        type,
        count,
        color: typeColorMap[type] || "#94a3b8",
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [scopedInsightErrors]);

  const dominantErrorTypeByDevice = useMemo(() => {
    const typeMapByDevice = new Map<string, Map<string, number>>();
    filteredErrors.forEach((log) => {
      const deviceTypeMap = typeMapByDevice.get(log.device_id) ?? new Map<string, number>();
      const type = classifyErrorType(log.error_message);
      deviceTypeMap.set(type, (deviceTypeMap.get(type) || 0) + 1);
      typeMapByDevice.set(log.device_id, deviceTypeMap);
    });

    const dominantMap = new Map<string, { type: string; count: number }>();
    typeMapByDevice.forEach((typeMap, deviceId) => {
      let topType = "Other";
      let topCount = 0;
      typeMap.forEach((count, type) => {
        if (count > topCount) {
          topType = type;
          topCount = count;
        }
      });
      dominantMap.set(deviceId, { type: topType, count: topCount });
    });

    return dominantMap;
  }, [filteredErrors]);

  const latestErrorByDevice = useMemo(() => {
    const latestMap = new Map<string, number>();
    errors.forEach((log) => {
      const timestamp = new Date(log.occurred_at).getTime();
      if (!Number.isFinite(timestamp)) return;
      const current = latestMap.get(log.device_id);
      if (!current || timestamp > current) {
        latestMap.set(log.device_id, timestamp);
      }
    });
    return latestMap;
  }, [errors]);

  const topFailingDeviceDetails = useMemo(() => {
    const nowMs = Date.now();
    return deviceErrorDataWithCount.slice(0, 3).map((device) => {
      const share = totalDeviceErrors > 0 ? (device.count / totalDeviceErrors) * 100 : 0;
      const lastSeen = latestErrorByDevice.get(device.device_id) || null;
      const dominantType = dominantErrorTypeByDevice.get(device.device_id);
      return {
        deviceId: device.device_id,
        errorCount: device.count,
        share,
        lastSeen,
        dominantType: dominantType?.type || "Other",
        dominantTypeCount: dominantType?.count || 0,
        isOnline: lastSeen ? nowMs - lastSeen <= 15 * 60 * 1000 : false,
      };
    });
  }, [deviceErrorDataWithCount, dominantErrorTypeByDevice, latestErrorByDevice, totalDeviceErrors]);

  const spikeAlert = useMemo(() => {
    const nowMs = activeWindow ? activeWindow.end.getTime() : Date.now();
    const oneHourMs = 60 * 60 * 1000;
    const currentWindowStart = nowMs - oneHourMs;
    const previousWindowStart = nowMs - oneHourMs * 2;
    const sourceLogs = scopedInsightErrors;

    let currentCount = 0;
    let previousCount = 0;
    sourceLogs.forEach((log) => {
      const ts = new Date(log.occurred_at).getTime();
      if (!Number.isFinite(ts)) return;
      if (ts >= currentWindowStart && ts <= nowMs) {
        currentCount += 1;
      } else if (ts >= previousWindowStart && ts < currentWindowStart) {
        previousCount += 1;
      }
    });

    const delta = currentCount - previousCount;
    const direction: ComparisonDirection =
      delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const absoluteChangePercent =
      previousCount === 0 ? (currentCount > 0 ? 100 : 0) : Math.abs((delta / previousCount) * 100);
    const signedChangeLabel =
      previousCount === 0
        ? currentCount > 0
          ? tr(language, "new activity", "มีเหตุการณ์ใหม่")
          : "0%"
        : `${delta >= 0 ? "+" : "-"}${absoluteChangePercent.toFixed(0)}%`;

    let level: "stable" | "warning" | "critical" = "stable";
    if (direction === "up" && currentCount >= 5 && absoluteChangePercent >= 50) {
      level = "critical";
    } else if (direction === "up" && absoluteChangePercent >= 20) {
      level = "warning";
    }

    return {
      currentCount,
      previousCount,
      direction,
      absoluteChangePercent,
      signedChangeLabel,
      level,
    };
  }, [scopedInsightErrors, activeWindow, language]);

  const deviceHealthRows = useMemo(() => {
    return deviceErrorDataWithCount.map((device) => {
      const share = totalDeviceErrors > 0 ? (device.count / totalDeviceErrors) * 100 : 0;
      let riskLevel: RiskLevel = "stable";
      if (device.count >= 5 || share >= 40) {
        riskLevel = "critical";
      } else if (device.count >= 2 || share >= 20) {
        riskLevel = "warning";
      }

      return {
        deviceId: device.device_id,
        errorCount: device.count,
        share,
        lastSeen: latestErrorByDevice.get(device.device_id) || null,
        riskLevel,
      };
    });
  }, [deviceErrorDataWithCount, latestErrorByDevice, totalDeviceErrors]);
  const deviceHealthPageCount = Math.max(1, Math.ceil(deviceHealthRows.length / deviceHealthPageSize));
  const paginatedDeviceHealthRows = useMemo(() => {
    const start = deviceHealthPageIndex * deviceHealthPageSize;
    return deviceHealthRows.slice(start, start + deviceHealthPageSize);
  }, [deviceHealthPageIndex, deviceHealthPageSize, deviceHealthRows]);
  const deviceHealthStart = deviceHealthRows.length === 0 ? 0 : deviceHealthPageIndex * deviceHealthPageSize + 1;
  const deviceHealthEnd = Math.min(
    deviceHealthRows.length,
    deviceHealthPageIndex * deviceHealthPageSize + deviceHealthPageSize
  );

  const currentErrorRatePercent = Number(((stats?.error_rate ?? 0) * 100).toFixed(2));
  const isThresholdBreached = currentErrorRatePercent >= errorRateThreshold;

  const activeChartData = isTrendChart ? trendChartData : deviceChartData;
  const hasSingleDeviceBar = chartType === "bar" && deviceChartData.length === 1;
  const yAxisMax = useMemo(() => {
    const max = activeChartData.reduce((acc, item) => Math.max(acc, item.count), 0);
    return Math.max(2, max + 1);
  }, [activeChartData]);

  const topDevice = deviceChartData[0];
  const peakTrendPoint = trendChartData.reduce(
    (best, point) => (point.count > best.count ? point : best),
    trendChartData[0] || { label: "-", count: 0 }
  );
  const selectedDeviceSummary = selectedDeviceIds.length
    ? selectedDeviceIds.slice(0, 2).join(", ") +
    (selectedDeviceIds.length > 2 ? ` +${selectedDeviceIds.length - 2}` : "")
    : tr(language, "All devices", "ทุกอุปกรณ์");
  const rangeHasAnyActivity = (stats?.success_count ?? 0) + (stats?.error_count ?? 0) > 0;
  const noErrorButHasTraffic = (stats?.success_count ?? 0) > 0 && (stats?.error_count ?? 0) === 0;
  const showNoDataFallback = !rangeHasAnyActivity;
  const noDataReasonText = showNoDataFallback
    ? tr(
      language,
      "No ingestion data found in this period.",
      "ช่วงเวลานี้ไม่พบการรับข้อมูลจากอุปกรณ์"
    )
    : noErrorButHasTraffic
      ? tr(
        language,
        "Requests were successful in this period, so there are no error logs to display.",
        "ช่วงเวลานี้คำขอสำเร็จทั้งหมด จึงไม่มี error log ให้แสดง"
      )
      : tr(
        language,
        "No matching data for current filters.",
        "ไม่พบข้อมูลตามตัวกรองปัจจุบัน"
      );
  const previousErrorCount = comparisonStats?.error_count ?? 0;
  const currentErrorCount = stats?.error_count ?? 0;
  const errorCountDiff = currentErrorCount - previousErrorCount;
  const errorRateDiffPctPoint = Number(
    (((stats?.error_rate ?? 0) - (comparisonStats?.error_rate ?? 0)) * 100).toFixed(2)
  );
  const errorCountDirection = getComparisonDirection(errorCountDiff);

  const exportCurrentView = useCallback(() => {
    const rangeTitle = activeWindow
      ? `${toLocalTimeString(activeWindow.start, language)} - ${toLocalTimeString(activeWindow.end, language)}`
      : tr(language, "Invalid range", "ช่วงเวลาไม่ถูกต้อง");
    const rows: string[] = [];
    rows.push("SECTION,Device Monitor Export");
    rows.push(`${csvEscape("Exported At")},${csvEscape(new Date().toISOString())}`);
    rows.push(`${csvEscape("Range")},${csvEscape(rangeTitle)}`);
    rows.push(`${csvEscape("Device Filter")},${csvEscape(selectedDeviceSummary)}`);
    rows.push("");
    rows.push("SECTION,Device Health");
    rows.push(
      [
        "device_id",
        "error_count",
        "share_percent",
        "last_seen",
        "risk_level",
      ].map(csvEscape).join(",")
    );
    deviceHealthRows.forEach((row) => {
      rows.push(
        [
          row.deviceId,
          row.errorCount,
          row.share.toFixed(2),
          row.lastSeen ? new Date(row.lastSeen).toISOString() : "",
          row.riskLevel,
        ].map(csvEscape).join(",")
      );
    });
    rows.push("");
    rows.push("SECTION,Recent Error Logs");
    rows.push(["time", "device_id", "error_code", "error_message", "suggestion"].map(csvEscape).join(","));
    recentScopedErrors.slice(0, 200).forEach((log) => {
      rows.push(
        [
          log.occurred_at,
          log.device_id,
          log.error_code || "",
          log.error_message || "",
          log.suggestion || "",
        ].map(csvEscape).join(",")
      );
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `device-monitor-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, [activeWindow, deviceHealthRows, language, recentScopedErrors, selectedDeviceSummary]);

  useEffect(() => {
    lastErrorCursorRef.current = null;
    setErrors([]);
    if (getDateWindow(timePreset, customFromDate, customToDate)) {
      void loadData(true);
    }
  }, [loadData, windowSelectionKey, timePreset, customFromDate, customToDate]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (isAutoRefresh && token) {
      interval = setInterval(() => {
        void refreshErrorsOnly();
      }, refreshIntervalMs);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoRefresh, token, refreshErrorsOnly, refreshIntervalMs]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (isAutoRefresh && token) {
      interval = setInterval(() => {
        void refreshStatsOnly();
      }, statsRefreshIntervalMs);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoRefresh, token, refreshStatsOnly, statsRefreshIntervalMs]);

  useEffect(() => {
    setDeviceHealthPageIndex((prev) => Math.min(prev, deviceHealthPageCount - 1));
  }, [deviceHealthPageCount]);

  useEffect(() => {
    setSelectedDeviceIds((prev) => prev.filter((id) => availableDeviceIds.includes(id)));
  }, [availableDeviceIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SAVED_MONITOR_VIEWS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedMonitorView[];
      if (!Array.isArray(parsed)) return;
      setSavedViews(parsed.slice(0, 12));
    } catch {
      // Ignore malformed local storage payloads.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SAVED_MONITOR_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  if (loading && !stats) return <div className="p-8">{tr(language, "Loading device data...", "กำลังโหลดข้อมูลอุปกรณ์...")}</div>;
  if (errorObj)
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/15 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-destructive">{tr(language, "Error loading device monitor", "เกิดข้อผิดพลาดในการโหลดหน้ามอนิเตอร์อุปกรณ์")}</h3>
              <div className="mt-2 text-sm text-destructive/90">
                <p>{errorObj.message || tr(language, "Unknown error occurred", "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ")}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadData(true)}
                  className="mt-4 border-destructive/20 hover:bg-destructive/20"
                >
                  {tr(language, "Retry", "ลองอีกครั้ง")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  if (!stats) return <div className="p-8">{tr(language, "No data available.", "ไม่มีข้อมูล")}</div>;

  return (
    <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{tr(language, "Device Monitor", "มอนิเตอร์อุปกรณ์")}</h1>
          <p className="text-muted-foreground">{tr(language, "Real-time status of physical device API ingestion.", "สถานะเรียลไทม์ของการรับข้อมูลจากอุปกรณ์ผ่าน API")}</p>
          <p className="text-sm text-muted-foreground">
            {tr(language, "Range:", "ช่วงเวลา:")} {rangeLabel}
          </p>
          <p className="text-sm text-muted-foreground">
            {tr(language, "Latest error activity:", "ข้อมูลล่าสุด (error):")}{" "}
            {latestErrorActivityAt
              ? toLocalTimeString(new Date(latestErrorActivityAt), language)
              : tr(language, "No error history", "ยังไม่มีประวัติ error")}
          </p>
          {lastUpdated && (
            <p className="text-sm text-muted-foreground">
              {tr(language, "Last refreshed:", "รีเฟรชล่าสุด:")} {toLocalTimeString(lastUpdated, language)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={timePreset} onValueChange={(value) => setTimePreset(value as TimePreset)}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{getPresetLabel("today", language)}</SelectItem>
              <SelectItem value="yesterday">{getPresetLabel("yesterday", language)}</SelectItem>
              <SelectItem value="7d">{getPresetLabel("7d", language)}</SelectItem>
              <SelectItem value="30d">{getPresetLabel("30d", language)}</SelectItem>
              <SelectItem value="custom">{getPresetLabel("custom", language)}</SelectItem>
            </SelectContent>
          </Select>

          {timePreset === "custom" && (
            <>
              <Input
                type="date"
                value={customFromDate}
                onChange={(event) => setCustomFromDate(event.target.value)}
                className="h-9 w-[160px] text-sm"
              />
              <Input
                type="date"
                value={customToDate}
                onChange={(event) => setCustomToDate(event.target.value)}
                className="h-9 w-[160px] text-sm"
              />
            </>
          )}

          <Select
            value={activeSavedViewId || "__none__"}
            onValueChange={(value) => {
              if (!value || value === "__none__") {
                setActiveSavedViewId("");
                return;
              }
              applySavedView(value);
            }}
          >
            <SelectTrigger className="h-9 w-[180px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{tr(language, "Saved Views", "มุมมองที่บันทึก")}</SelectItem>
              {savedViews.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={openSaveViewToast}>
            <Save className="mr-2 h-4 w-4" />
            {tr(language, "Save View", "บันทึกมุมมอง")}
          </Button>

          <Button variant="outline" size="sm" onClick={removeActiveSavedView} disabled={!activeSavedViewId}>
            {tr(language, "Delete View", "ลบมุมมอง")}
          </Button>

          <Button variant="outline" size="sm" onClick={exportCurrentView}>
            <Download className="mr-2 h-4 w-4" />
            {tr(language, "Export CSV", "ส่งออก CSV")}
          </Button>

          <div className="flex items-center space-x-2">
            <Switch id="auto-refresh" checked={isAutoRefresh} onCheckedChange={setIsAutoRefresh} />
            <Label htmlFor="auto-refresh">{tr(language, "Auto-refresh", "รีเฟรชอัตโนมัติ")}</Label>
          </div>

          <Select
            value={String(refreshIntervalMs)}
            onValueChange={(value) => {
              const parsed = Number(value);
              if (Number.isFinite(parsed) && parsed >= 1000) {
                setRefreshIntervalMs(parsed);
              }
            }}
          >
            <SelectTrigger id="refresh-interval" className="h-9 w-[120px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {refreshIntervalOptions.map((intervalMs) => (
                <SelectItem key={intervalMs} value={String(intervalMs)}>
                  {formatRefreshInterval(intervalMs, language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={isRefreshing || !activeWindow}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {tr(language, "Refresh", "รีเฟรช")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-medium">
              {tr(language, "Success Requests", "คำขอสำเร็จ")} ({rangeLabel})
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.success_count}</div>
            <p className="text-sm text-muted-foreground">{tr(language, "Successful data ingestions", "จำนวนการรับข้อมูลที่สำเร็จ")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-medium">
              {tr(language, "Error Count", "จำนวนข้อผิดพลาด")} ({rangeLabel})
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.error_count}</div>
            <p className="text-sm text-muted-foreground">{tr(language, "Failed requests or validations", "คำขอหรือการตรวจสอบที่ล้มเหลว")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-medium">{tr(language, "Error Rate", "อัตราข้อผิดพลาด")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.error_rate * 100).toFixed(2)}%</div>
            <p className="text-sm text-muted-foreground">{tr(language, "Percentage of total requests", "เปอร์เซ็นต์จากคำขอทั้งหมด")}</p>
          </CardContent>
        </Card>
      </div>

      <DeviceMonitorInsights
        language={language}
        rangeLabel={rangeLabel}
        previousWindowLabel={previousWindow?.label ?? null}
        errorCountDirection={errorCountDirection}
        errorCountDiff={errorCountDiff}
        errorRateDiffPctPoint={errorRateDiffPctPoint}
        isThresholdBreached={isThresholdBreached}
        currentErrorRatePercent={currentErrorRatePercent}
        errorRateThreshold={errorRateThreshold}
        setErrorRateThreshold={setErrorRateThreshold}
        spikeAlert={spikeAlert}
        selectedDeviceSummary={selectedDeviceSummary}
        chartType={chartType}
        setChartType={setChartType}
        timePreset={timePreset}
        setTimePreset={setTimePreset}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        isTrendChart={isTrendChart}
        filteredErrorsCount={filteredErrors.length}
        totalDeviceErrors={totalDeviceErrors}
        peakTrendPoint={peakTrendPoint}
        topDevice={topDevice}
        deviceChartData={deviceChartData}
        trendChartData={trendChartData}
        yAxisMax={yAxisMax}
        showNoDataFallback={showNoDataFallback}
        noErrorButHasTraffic={noErrorButHasTraffic}
        noDataReasonText={noDataReasonText}
        latestErrorActivityAt={latestErrorActivityAt}
        jumpToLatestDataWindow={jumpToLatestDataWindow}
        hasSingleDeviceBar={hasSingleDeviceBar}
        topFailingDeviceDetails={topFailingDeviceDetails}
        selectedDeviceIds={selectedDeviceIds}
        setSelectedDeviceIds={setSelectedDeviceIds}
        availableDeviceIds={availableDeviceIds}
        errorTypeData={errorTypeData}
        recentScopedErrors={recentScopedErrors}
        paginatedDeviceHealthRows={paginatedDeviceHealthRows}
        deviceHealthRowsCount={deviceHealthRows.length}
        deviceHealthStart={deviceHealthStart}
        deviceHealthEnd={deviceHealthEnd}
        deviceHealthPageIndex={deviceHealthPageIndex}
        setDeviceHealthPageIndex={setDeviceHealthPageIndex}
        deviceHealthPageCount={deviceHealthPageCount}
        deviceHealthPageSize={deviceHealthPageSize}
        setDeviceHealthPageSize={setDeviceHealthPageSize}
      />
    </main>
  );
}
