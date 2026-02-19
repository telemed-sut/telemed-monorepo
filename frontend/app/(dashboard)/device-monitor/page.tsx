"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/store/auth-store";
import { fetchDeviceStats, fetchDeviceErrors, DeviceStats, DeviceErrorLog } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  BarChart3,
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  CheckCircle,
  Grid3X3,
  LineChartIcon,
  MoreHorizontal,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";

type ChartType = "bar" | "line" | "area";
type TimePeriod = 6 | 24 | 72;

const timePeriods: TimePeriod[] = [6, 24, 72];
const refreshIntervalOptions = [1000, 2000, 5000, 10000] as const;

type RiskLevel = "stable" | "warning" | "critical";

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

function localizeErrorType(type: string, language: AppLanguage): string {
  if (language !== "th") return type;
  const map: Record<string, string> = {
    Battery: "แบตเตอรี่",
    "Data Integrity": "ความถูกต้องของข้อมูล",
    Timeout: "หมดเวลา",
    Connectivity: "การเชื่อมต่อ",
    Authentication: "การยืนยันตัวตน",
    Validation: "การตรวจสอบข้อมูล",
    Other: "อื่น ๆ",
  };
  return map[type] ?? type;
}

function formatLastSeen(timestamp: number | null, language: AppLanguage) {
  if (!timestamp) return tr(language, "No recent errors", "ไม่พบข้อผิดพลาดล่าสุด");
  return new Date(timestamp).toLocaleString(localeOf(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeAgo(timestamp: number | null, language: AppLanguage) {
  if (!timestamp) return tr(language, "No recent errors", "ไม่พบข้อผิดพลาดล่าสุด");
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return tr(language, "Just now", "เมื่อสักครู่");
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return tr(language, `${diffMinutes}m ago`, `${diffMinutes} นาทีที่แล้ว`);
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return tr(language, `${diffHours}h ago`, `${diffHours} ชั่วโมงที่แล้ว`);
  const diffDays = Math.floor(diffHours / 24);
  return tr(language, `${diffDays}d ago`, `${diffDays} วันที่แล้ว`);
}

function getRiskMeta(riskLevel: RiskLevel, language: AppLanguage) {
  if (riskLevel === "critical") {
    return { label: tr(language, "Critical", "วิกฤต"), variant: "destructive" as const };
  }
  if (riskLevel === "warning") {
    return { label: tr(language, "Warning", "เฝ้าระวัง"), variant: "secondary" as const };
  }
  return { label: tr(language, "Stable", "ปกติ"), variant: "outline" as const };
}

function formatTrendLabel(timestamp: number, periodHours: TimePeriod, language: AppLanguage) {
  const date = new Date(timestamp);
  if (periodHours <= 24) {
    return date.toLocaleTimeString(localeOf(language), { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(localeOf(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

function formatPeriodHours(hours: TimePeriod, language: AppLanguage): string {
  return language === "th" ? `${hours} ชม.` : `${hours}h`;
}

function formatRefreshInterval(ms: number, language: AppLanguage): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms % 1000 === 0) {
    const sec = ms / 1000;
    return language === "th" ? `${sec} วินาที` : `${sec}s`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
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

function DeviceErrorTooltip({
  active,
  payload,
  label,
  language,
}: TooltipProps<number, string> & { language: AppLanguage }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="size-2.5 rounded-full" style={{ background: entry.color }} />
            <span className="text-sm text-muted-foreground">
              {entry.name === "Errors" ? tr(language, "Errors", "ข้อผิดพลาด") : entry.name}:
            </span>
            <span className="text-sm font-medium text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DeviceMonitorPage() {
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const axisColor = isDark ? "#71717a" : "#a1a1aa";
  const gridColor = isDark ? "#27272a" : "#f4f4f5";

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
  const [periodHours, setPeriodHours] = useState<TimePeriod>(24);
  const [errorRateThreshold, setErrorRateThreshold] = useState(5);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceHealthPageSize, setDeviceHealthPageSize] = useState(10);
  const [deviceHealthPageIndex, setDeviceHealthPageIndex] = useState(0);
  const isFetchingAllRef = useRef(false);
  const isFetchingStatsRef = useRef(false);
  const isFetchingErrorsRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastErrorCursorRef = useRef<number | null>(null);
  const periodLabelsByLang = useMemo<Record<TimePeriod, string>>(
    () => ({
      6: tr(language, "Last 6 Hours", "6 ชั่วโมงล่าสุด"),
      24: tr(language, "Last 24 Hours", "24 ชั่วโมงล่าสุด"),
      72: tr(language, "Last 72 Hours", "72 ชั่วโมงล่าสุด"),
    }),
    [language]
  );
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
      isFetchingStatsRef.current = true;
      try {
        const statsData = await fetchDeviceStats(token, periodHours, { topDevices: 50 });
        setStats(statsData);
      } catch (error) {
        if (throwOnError) throw error;
      } finally {
        isFetchingStatsRef.current = false;
      }
    },
    [token, periodHours]
  );

  const loadErrors = useCallback(
    async (forceFullSync: boolean = false, throwOnError: boolean = false) => {
      if (!token || isFetchingErrorsRef.current) return;
      isFetchingErrorsRef.current = true;
      try {
        const errorLogs = await fetchDeviceErrors(token, {
          limit: 200,
          hours: periodHours,
          sinceId: !forceFullSync ? (lastErrorCursorRef.current ?? undefined) : undefined,
        });

        setErrors((prev) => {
          const next =
            forceFullSync || !lastErrorCursorRef.current
              ? errorLogs
              : mergeDeviceErrors(prev, errorLogs, 500);

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
    [token, periodHours]
  );

  const loadData = useCallback(
    async (forceFullSync: boolean = false) => {
      if (!token || isFetchingAllRef.current) return;

      isFetchingAllRef.current = true;
      const isInitialLoad = !hasLoadedRef.current;
      if (isInitialLoad) {
        setLoading(true);
      }
      setIsRefreshing(true);
      setErrorObj(null);
      try {
        await Promise.all([loadStats(true), loadErrors(forceFullSync, true)]);
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
    [token, loadStats, loadErrors, toLoadError]
  );

  const refreshErrorsOnly = useCallback(async () => {
    try {
      await loadErrors(false, false);
      setLastUpdated(new Date());
    } catch {
      // Keep stale data on background refresh errors.
    }
  }, [loadErrors]);

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
      .sort((a, b) => b.count - a.count);
  }, [stats]);
  const deviceChartData = allDeviceErrorData.slice(0, 8);

  const totalDeviceErrors = useMemo(
    () => allDeviceErrorData.reduce((acc, item) => acc + item.count, 0),
    [allDeviceErrorData]
  );
  const isTrendChart = chartType !== "bar";

  const filteredErrors = useMemo(() => {
    const nowMs = Date.now();
    const fromMs = nowMs - periodHours * 60 * 60 * 1000;
    return errors.filter((log) => {
      const ts = new Date(log.occurred_at).getTime();
      return Number.isFinite(ts) && ts >= fromMs && ts <= nowMs;
    });
  }, [errors, periodHours]);

  const scopedInsightErrors = useMemo(() => {
    if (!selectedDeviceId) return filteredErrors;
    return filteredErrors.filter((log) => log.device_id === selectedDeviceId);
  }, [filteredErrors, selectedDeviceId]);

  const recentScopedErrors = useMemo(() => {
    return [...scopedInsightErrors].sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );
  }, [scopedInsightErrors]);

  const trendChartData = useMemo(() => {
    const nowMs = Date.now();
    const rangeMs = periodHours * 60 * 60 * 1000;
    const fromMs = nowMs - rangeMs;
    const bucketCount = periodHours === 6 ? 6 : periodHours === 24 ? 8 : 12;
    const bucketMs = Math.floor(rangeMs / bucketCount);

    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = fromMs + index * bucketMs;
      const bucketEnd = index === bucketCount - 1 ? nowMs : bucketStart + bucketMs;
      return {
        label: formatTrendLabel(bucketEnd, periodHours, language),
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
  }, [filteredErrors, periodHours, language]);

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
    return allDeviceErrorData.slice(0, 3).map((device) => {
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
  }, [allDeviceErrorData, dominantErrorTypeByDevice, latestErrorByDevice, totalDeviceErrors]);

  const spikeAlert = useMemo(() => {
    const nowMs = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    const currentWindowStart = nowMs - oneHourMs;
    const previousWindowStart = nowMs - oneHourMs * 2;
    const sourceLogs = selectedDeviceId
      ? errors.filter((log) => log.device_id === selectedDeviceId)
      : errors;

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
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
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
  }, [errors, selectedDeviceId, language]);

  const deviceHealthRows = useMemo(() => {
    return allDeviceErrorData.map((device) => {
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
  }, [allDeviceErrorData, latestErrorByDevice, totalDeviceErrors]);
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
  const yAxisMax = useMemo(() => {
    const max = activeChartData.reduce((acc, item) => Math.max(acc, item.count), 0);
    return Math.max(2, max + 1);
  }, [activeChartData]);

  const topDevice = deviceChartData[0];
  const peakTrendPoint = trendChartData.reduce(
    (best, point) => (point.count > best.count ? point : best),
    trendChartData[0] || { label: "-", count: 0 }
  );

  useEffect(() => {
    lastErrorCursorRef.current = null;
    setErrors([]);
    void loadData(true);
  }, [loadData, periodHours]);

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
    if (!selectedDeviceId) return;
    const stillExists = allDeviceErrorData.some((item) => item.device_id === selectedDeviceId);
    if (!stillExists) {
      setSelectedDeviceId(null);
    }
  }, [allDeviceErrorData, selectedDeviceId]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tr(language, "Device Monitor", "มอนิเตอร์อุปกรณ์")}</h1>
          <p className="text-muted-foreground">{tr(language, "Real-time status of physical device API ingestion.", "สถานะเรียลไทม์ของการรับข้อมูลจากอุปกรณ์ผ่าน API")}</p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {tr(language, "Last updated:", "อัปเดตล่าสุด:")} {lastUpdated.toLocaleTimeString(localeOf(language))}
            </span>
          )}
          <div className="flex items-center space-x-2">
            <Switch id="auto-refresh" checked={isAutoRefresh} onCheckedChange={setIsAutoRefresh} />
            <Label htmlFor="auto-refresh">{tr(language, "Auto-refresh", "รีเฟรชอัตโนมัติ")}</Label>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="refresh-interval" className="text-xs text-muted-foreground">
              {tr(language, "Interval", "ช่วงเวลา")}
            </Label>
            <Select
              value={String(refreshIntervalMs)}
              onValueChange={(value) => {
                const parsed = Number(value);
                if (Number.isFinite(parsed) && parsed >= 1000) {
                  setRefreshIntervalMs(parsed);
                }
              }}
            >
              <SelectTrigger id="refresh-interval" className="h-8 w-[110px]">
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
          </div>

          <Button variant="outline" size="sm" onClick={() => void loadData(true)} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {tr(language, "Refresh", "รีเฟรช")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {tr(language, "Success Requests", "คำขอสำเร็จ")} ({formatPeriodHours(periodHours, language)})
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.success_count}</div>
            <p className="text-xs text-muted-foreground">{tr(language, "Successful data ingestions", "จำนวนการรับข้อมูลที่สำเร็จ")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {tr(language, "Error Count", "จำนวนข้อผิดพลาด")} ({formatPeriodHours(periodHours, language)})
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.error_count}</div>
            <p className="text-xs text-muted-foreground">{tr(language, "Failed requests or validations", "คำขอหรือการตรวจสอบที่ล้มเหลว")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr(language, "Error Rate", "อัตราข้อผิดพลาด")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.error_rate * 100).toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">{tr(language, "Percentage of total requests", "เปอร์เซ็นต์จากคำขอทั้งหมด")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className={isThresholdBreached ? "border-destructive/40" : ""}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-full p-1.5 ${
                  isThresholdBreached ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-600"
                }`}
              >
                <ShieldAlert className="size-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{tr(language, "Alert Threshold", "เกณฑ์แจ้งเตือน")}</p>
                <p className="text-xs text-muted-foreground">
                  {isThresholdBreached
                    ? tr(
                        language,
                        `Error rate is ${currentErrorRatePercent.toFixed(2)}% and exceeded threshold (${errorRateThreshold.toFixed(2)}%).`,
                        `อัตราข้อผิดพลาดอยู่ที่ ${currentErrorRatePercent.toFixed(2)}% และเกินเกณฑ์ (${errorRateThreshold.toFixed(2)}%).`
                      )
                    : tr(
                        language,
                        `Error rate is ${currentErrorRatePercent.toFixed(2)}%, below threshold (${errorRateThreshold.toFixed(2)}%).`,
                        `อัตราข้อผิดพลาดอยู่ที่ ${currentErrorRatePercent.toFixed(2)}% ต่ำกว่าเกณฑ์ (${errorRateThreshold.toFixed(2)}%).`
                      )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Label htmlFor="error-threshold" className="text-xs text-muted-foreground whitespace-nowrap">
                {tr(language, "Alert if Error Rate ≥", "แจ้งเตือนเมื่ออัตราข้อผิดพลาด ≥")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="error-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={errorRateThreshold}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isNaN(parsed)) return;
                    setErrorRateThreshold(Math.min(100, Math.max(0, parsed)));
                  }}
                  className="w-24 h-8 text-sm"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border/60 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`rounded-full p-1.5 ${
                  spikeAlert.level === "critical"
                    ? "bg-destructive/15 text-destructive"
                    : spikeAlert.level === "warning"
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-emerald-500/15 text-emerald-600"
                }`}
              >
                {spikeAlert.direction === "up" ? (
                  <TrendingUp className="size-3.5" />
                ) : spikeAlert.direction === "down" ? (
                  <TrendingDown className="size-3.5" />
                ) : (
                  <Activity className="size-3.5" />
                )}
              </div>
              <div>
                <p className="text-xs font-semibold">{tr(language, "Spike Alert (Last 1h vs Previous 1h)", "แจ้งเตือนสไปก์ (1 ชม.ล่าสุด เทียบ 1 ชม.ก่อนหน้า)")}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedDeviceId
                    ? `${selectedDeviceId} · `
                    : tr(language, "All devices · ", "ทุกอุปกรณ์ · ")}
                  {spikeAlert.signedChangeLabel} | {tr(language, "Now", "ตอนนี้")} {spikeAlert.currentCount} / {tr(language, "Prev", "ก่อนหน้า")} {spikeAlert.previousCount}
                </p>
              </div>
            </div>
            {spikeAlert.level === "critical" && (
              <Badge variant="destructive" className="w-fit">
                {tr(language, "Immediate Attention", "ต้องดูแลทันที")}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-1 min-[500px]:grid-cols-7 items-start">
        <div className="min-[500px]:col-span-4 self-start flex flex-col gap-3 p-3 sm:p-4 rounded-xl border bg-card min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-2.5 flex-1">
              <Button variant="outline" size="icon" className="size-7 sm:size-8">
                <BarChart2 className="size-4 sm:size-[18px] text-muted-foreground" />
              </Button>
              <span className="text-sm sm:text-base font-medium">
                {isTrendChart
                  ? tr(language, "Error Trend Over Time", "แนวโน้มข้อผิดพลาดตามเวลา")
                  : tr(language, "Errors by Device ID", "ข้อผิดพลาดแยกตาม Device ID")}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-3 sm:gap-5">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 sm:size-3 rounded-full bg-[#7ac2f0]" />
                <span className="text-[10px] sm:text-xs text-muted-foreground">
                  {isTrendChart
                    ? `${periodLabelsByLang[periodHours]} ${tr(language, "trend", "แนวโน้ม")}`
                    : periodLabelsByLang[periodHours]}
                </span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center size-7 sm:size-8 rounded-md hover:bg-muted">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{tr(language, "Chart Options", "ตัวเลือกกราฟ")}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <BarChart3 className="size-4 mr-2" />
                    {tr(language, "Chart Type", "ประเภทกราฟ")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setChartType("bar")}>
                      <BarChart3 className="size-4 mr-2" />
                      {tr(language, "Device Comparison", "เปรียบเทียบอุปกรณ์")}
                      {chartType === "bar" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("line")}>
                      <LineChartIcon className="size-4 mr-2" />
                      {tr(language, "Time Trend (Line)", "แนวโน้มเวลา (เส้น)")}
                      {chartType === "line" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("area")}>
                      <TrendingUp className="size-4 mr-2" />
                      {tr(language, "Time Trend (Area)", "แนวโน้มเวลา (พื้นที่)")}
                      {chartType === "area" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Calendar className="size-4 mr-2" />
                    {tr(language, "Time Period", "ช่วงเวลา")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {timePeriods.map((periodKey) => (
                      <DropdownMenuItem key={periodKey} onClick={() => setPeriodHours(periodKey)}>
                        {periodLabelsByLang[periodKey]}
                        {periodHours === periodKey && <Check className="size-4 ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
                  <Grid3X3 className="size-4 mr-2" />
                  {tr(language, "Show Grid Lines", "แสดงเส้นกริด")}
                </DropdownMenuCheckboxItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setChartType("bar");
                    setPeriodHours(24);
                    setShowGrid(true);
                  }}
                >
                  <RefreshCw className="size-4 mr-2" />
                  {tr(language, "Reset to Default", "รีเซ็ตค่าเริ่มต้น")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-col min-[500px]:flex-row gap-3 sm:gap-4 min-h-0">
            <div className="flex flex-col gap-3 w-full min-[500px]:w-[170px] lg:w-[190px] shrink-0">
              <div className="space-y-2 sm:space-y-4">
                <p className="text-2xl lg:text-[34px] font-semibold leading-tight tracking-tight">
                  {isTrendChart ? filteredErrors.length : totalDeviceErrors}
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {isTrendChart
                    ? `${tr(language, "Errors in Timeline", "ข้อผิดพลาดตามไทม์ไลน์")} (${periodLabelsByLang[periodHours]})`
                    : `${tr(language, "Total Device Errors", "ข้อผิดพลาดอุปกรณ์ทั้งหมด")} (${periodLabelsByLang[periodHours]})`}
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 space-y-2.5">
                <p className="text-xs sm:text-sm font-semibold">
                  {isTrendChart
                    ? tr(language, "Peak Time Window", "ช่วงเวลาที่พีคที่สุด")
                    : tr(language, "Top Failing Device", "อุปกรณ์ที่ผิดพลาดมากสุด")}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">
                  {isTrendChart
                    ? peakTrendPoint.count > 0
                      ? tr(language, `${peakTrendPoint.label} has the highest activity with ${peakTrendPoint.count} errors`, `${peakTrendPoint.label} มีกิจกรรมสูงสุดด้วยข้อผิดพลาด ${peakTrendPoint.count} ครั้ง`)
                      : tr(language, "No error events in the selected timeline window", "ไม่พบเหตุการณ์ข้อผิดพลาดในช่วงเวลาที่เลือก")
                    : topDevice
                      ? tr(language, `${topDevice.device_id} has the highest errors with ${topDevice.count} occurrences`, `${topDevice.device_id} มีข้อผิดพลาดสูงสุด ${topDevice.count} ครั้ง`)
                      : tr(language, "No device errors found in the selected period", "ไม่พบข้อผิดพลาดของอุปกรณ์ในช่วงเวลาที่เลือก")}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                {isTrendChart
                  ? tr(language, `Timeline derived from recent error logs in ${periodLabelsByLang[periodHours].toLowerCase()}.`, `ไทม์ไลน์อ้างอิงจากบันทึกข้อผิดพลาดล่าสุดในช่วง ${periodLabelsByLang[periodHours]}.`)
                  : tr(language, `Top devices encountering issues in ${periodLabelsByLang[periodHours].toLowerCase()}.`, `อุปกรณ์ที่พบปัญหามากที่สุดในช่วง ${periodLabelsByLang[periodHours]}.`)}
              </p>
            </div>

            <div className="flex-1 h-[145px] sm:h-[160px] lg:h-[175px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "bar" ? (
                  <BarChart data={deviceChartData}>
                    <defs>
                      <linearGradient id="deviceErrorBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7ac2f0" stopOpacity={1} />
                        <stop offset="100%" stopColor="#7ac2f0" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                    {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
                    <XAxis
                      dataKey="device_id"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 9 }}
                      dy={8}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 10 }}
                      dx={-5}
                      width={40}
                      allowDecimals={false}
                      domain={[0, yAxisMax]}
                    />
                    <Tooltip
                      content={<DeviceErrorTooltip language={language} />}
                      cursor={{ fill: isDark ? "#27272a" : "#f4f4f5", radius: 4 }}
                    />
                    <Bar
                      dataKey="count"
                      name={tr(language, "Errors", "ข้อผิดพลาด")}
                      fill="url(#deviceErrorBarGrad)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                ) : chartType === "line" ? (
                  <LineChart data={trendChartData}>
                    {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 9 }}
                      dy={8}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 10 }}
                      dx={-5}
                      width={40}
                      allowDecimals={false}
                      domain={[0, yAxisMax]}
                    />
                    <Tooltip content={<DeviceErrorTooltip language={language} />} cursor={{ stroke: isDark ? "#52525b" : "#d4d4d8" }} />
                    <Line
                      type="linear"
                      dataKey="count"
                      name={tr(language, "Errors", "ข้อผิดพลาด")}
                      stroke="#7ac2f0"
                      strokeWidth={3}
                      dot={{ fill: "#7ac2f0", strokeWidth: 0, r: 4 }}
                      activeDot={{ r: 6, fill: "#7ac2f0" }}
                      connectNulls
                    />
                  </LineChart>
                ) : (
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="deviceErrorAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7ac2f0" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#7ac2f0" stopOpacity={0.2} />
                      </linearGradient>
                    </defs>
                    {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 9 }}
                      dy={8}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: axisColor, fontSize: 10 }}
                      dx={-5}
                      width={40}
                      allowDecimals={false}
                      domain={[0, yAxisMax]}
                    />
                    <Tooltip content={<DeviceErrorTooltip language={language} />} cursor={{ stroke: isDark ? "#52525b" : "#d4d4d8" }} />
                    <Area
                      type="linear"
                      dataKey="count"
                      name={tr(language, "Errors", "ข้อผิดพลาด")}
                      stroke="#7ac2f0"
                      strokeWidth={3}
                      fill="url(#deviceErrorAreaGrad)"
                      dot={{ fill: "#7ac2f0", strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, fill: "#7ac2f0" }}
                      connectNulls
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 sm:p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {tr(language, "Top Failing Devices Details", "รายละเอียดอุปกรณ์ที่ผิดพลาดสูงสุด")}
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1">
                    {tr(language, "Click a device to filter Error by Type and Recent Logs.", "คลิกอุปกรณ์เพื่อกรองประเภทข้อผิดพลาดและบันทึกล่าสุด")}
                  </p>
                </div>
                <span className="text-[10px] sm:text-xs text-muted-foreground">{tr(language, "Top 3", "อันดับสูงสุด 3 รายการ")}</span>
              </div>
              {topFailingDeviceDetails.length > 0 ? (
                <div className="grid gap-2.5">
                  {topFailingDeviceDetails.map((device) => (
                    <button
                      type="button"
                      key={device.deviceId}
                      onClick={() =>
                        setSelectedDeviceId((current) => (current === device.deviceId ? null : device.deviceId))
                      }
                      className={`w-full text-left rounded-md border p-2.5 sm:p-3 transition-colors ${
                        selectedDeviceId === device.deviceId
                          ? "border-[#7ac2f0] bg-[#7ac2f0]/10"
                          : "border-border/60 bg-background/90 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-semibold">{device.deviceId}</span>
                          <Badge
                            variant={device.isOnline ? "secondary" : "outline"}
                            className="h-5 px-2 text-[10px] leading-none"
                          >
                            {device.isOnline ? tr(language, "Online", "ออนไลน์") : tr(language, "Offline", "ออฟไลน์")}
                          </Badge>
                          {selectedDeviceId === device.deviceId && (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px] leading-none">
                              {tr(language, "Active Filter", "ตัวกรองที่ใช้งาน")}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums">
                          {device.errorCount} {tr(language, "errors", "ข้อผิดพลาด")} · {device.share.toFixed(1)}%
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-[#7ac2f0] transition-all"
                          style={{ width: `${Math.min(100, Math.max(device.share, 5))}%` }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-muted-foreground">
                        <span>
                          {tr(language, "Type", "ประเภท")}: <span className="font-medium text-foreground">{localizeErrorType(device.dominantType, language)}</span>
                          {device.dominantTypeCount > 0 ? ` (${device.dominantTypeCount})` : ""}
                        </span>
                        <span>
                          {tr(language, "Last seen", "พบล่าสุด")}:{" "}
                          <span className="font-medium text-foreground">{formatTimeAgo(device.lastSeen, language)}</span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  {tr(language, "No device errors found in", "ไม่พบข้อผิดพลาดของอุปกรณ์ในช่วง")} {periodLabelsByLang[periodHours]}.
                </div>
              )}
            </div>

          </div>

        <div className="min-[500px]:col-span-3 grid gap-4 self-start">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] sm:text-xs text-muted-foreground">
                {selectedDeviceId
                  ? tr(language, `Filtered by ${selectedDeviceId}`, `กรองโดย ${selectedDeviceId}`)
                  : tr(language, "No device filter. Select a top failing device to drill down.", "ยังไม่ได้เลือกตัวกรองอุปกรณ์ เลือกอุปกรณ์ที่ผิดพลาดสูงสุดเพื่อดูรายละเอียด")}
              </span>
            </div>
            {selectedDeviceId && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedDeviceId(null)}>
                {tr(language, "Clear", "ล้าง")}
              </Button>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{tr(language, "Error by Type", "ข้อผิดพลาดตามประเภท")}</CardTitle>
              <CardDescription>
                {tr(language, "Categorized from recent error messages", "จัดหมวดหมู่จากข้อความข้อผิดพลาดล่าสุด")}
                {selectedDeviceId
                  ? tr(language, ` for ${selectedDeviceId}`, ` สำหรับ ${selectedDeviceId}`)
                  : ""}
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              {errorTypeData.length > 0 ? (
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={errorTypeData} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} horizontal vertical={false} />}
                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: axisColor, fontSize: 10 }}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="type"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: axisColor, fontSize: 11 }}
                        tickFormatter={(value: string) => localizeErrorType(String(value), language)}
                        width={98}
                      />
                      <Tooltip content={<DeviceErrorTooltip language={language} />} cursor={{ fill: isDark ? "#27272a" : "#f4f4f5" }} />
                      <Bar dataKey="count" name={tr(language, "Errors", "ข้อผิดพลาด")} radius={[0, 4, 4, 0]}>
                        {errorTypeData.map((entry) => (
                          <Cell key={entry.type} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                  {tr(language, "No error events found for this period", "ไม่พบเหตุการณ์ข้อผิดพลาดในช่วงเวลานี้")}
                  {selectedDeviceId
                    ? tr(language, ` for ${selectedDeviceId}`, ` สำหรับ ${selectedDeviceId}`)
                    : ""}
                  .
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{tr(language, "Recent Error Logs", "บันทึกข้อผิดพลาดล่าสุด")}</CardTitle>
              <CardDescription>
                {tr(language, "Latest 50 error events", "เหตุการณ์ข้อผิดพลาดล่าสุด 50 รายการ")}
                {selectedDeviceId
                  ? tr(language, ` for ${selectedDeviceId}`, ` สำหรับ ${selectedDeviceId}`)
                  : ""}
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] overflow-auto">
                <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr(language, "Time", "เวลา")}</TableHead>
                        <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                        <TableHead>{tr(language, "Code", "รหัสปัญหา")}</TableHead>
                        <TableHead>{tr(language, "Error", "ข้อผิดพลาด")}</TableHead>
                        <TableHead>{tr(language, "Suggestion", "คำแนะนำแก้ไข")}</TableHead>
                      </TableRow>
                    </TableHeader>
                  <TableBody>
                    {recentScopedErrors.slice(0, 50).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(log.occurred_at).toLocaleTimeString(localeOf(language))}
                        </TableCell>
                        <TableCell className="font-medium text-xs">{log.device_id}</TableCell>
                        <TableCell className="text-xs font-mono text-amber-600 max-w-[170px] truncate" title={log.error_code || "-"}>
                          {log.error_code || "-"}
                        </TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[220px] truncate" title={log.error_message}>
                          {log.error_message}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[340px] truncate" title={log.suggestion || ""}>
                          {log.suggestion || tr(language, "Check backend logs for details", "ดู backend logs เพิ่มเติม")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {recentScopedErrors.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          {tr(language, "No errors found", "ไม่พบข้อผิดพลาด")}
                          {selectedDeviceId
                            ? tr(language, ` for ${selectedDeviceId}`, ` สำหรับ ${selectedDeviceId}`)
                            : ""}
                          .
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr(language, "Device Health Table", "ตารางสุขภาพอุปกรณ์")}</CardTitle>
          <CardDescription>{tr(language, "Error-focused health view ranked by risk and frequency.", "มุมมองสุขภาพอุปกรณ์ที่จัดอันดับตามความเสี่ยงและความถี่ของข้อผิดพลาด")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                <TableHead className="text-right">{tr(language, "Error Count", "จำนวนข้อผิดพลาด")}</TableHead>
                <TableHead className="text-right">{tr(language, "Share", "สัดส่วน")}</TableHead>
                <TableHead>{tr(language, "Last Seen", "พบล่าสุด")}</TableHead>
                <TableHead>{tr(language, "Risk Level", "ระดับความเสี่ยง")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDeviceHealthRows.map((row) => {
                const riskMeta = getRiskMeta(row.riskLevel, language);
                return (
                  <TableRow key={row.deviceId}>
                    <TableCell className="font-medium">{row.deviceId}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.errorCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.share.toFixed(1)}%</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatLastSeen(row.lastSeen, language)}</TableCell>
                    <TableCell>
                      <Badge variant={riskMeta.variant}>{riskMeta.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedDeviceHealthRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {tr(language, "No devices with errors in this period.", "ไม่มีอุปกรณ์ที่มีข้อผิดพลาดในช่วงเวลานี้")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-4 pt-4 border-t border-border/60 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {deviceHealthStart}-{deviceHealthEnd} {tr(language, "of", "จาก")} {deviceHealthRows.length}
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Select
                value={String(deviceHealthPageSize)}
                onValueChange={(value) => {
                  setDeviceHealthPageSize(Number(value));
                  setDeviceHealthPageIndex(0);
                }}
              >
                <SelectTrigger className="h-8 w-[78px] rounded-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {[5, 10, 20, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={String(pageSize)}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => setDeviceHealthPageIndex(0)}
                  disabled={deviceHealthPageIndex === 0}
                >
                  <ChevronsLeft className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => setDeviceHealthPageIndex((prev) => Math.max(0, prev - 1))}
                  disabled={deviceHealthPageIndex === 0}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>

                <div className="size-8 rounded-full bg-[#54B3D6] text-white text-xs font-medium flex items-center justify-center">
                  {deviceHealthPageIndex + 1}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() =>
                    setDeviceHealthPageIndex((prev) => Math.min(deviceHealthPageCount - 1, prev + 1))
                  }
                  disabled={deviceHealthPageIndex >= deviceHealthPageCount - 1}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => setDeviceHealthPageIndex(deviceHealthPageCount - 1)}
                  disabled={deviceHealthPageIndex >= deviceHealthPageCount - 1}
                >
                  <ChevronsRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
