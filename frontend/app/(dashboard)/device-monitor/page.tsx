"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type ChartType = "bar" | "line" | "area";
type TimePeriod = 6 | 24 | 72;

const periodLabels: Record<TimePeriod, string> = {
  6: "Last 6 Hours",
  24: "Last 24 Hours",
  72: "Last 72 Hours",
};
const timePeriods: TimePeriod[] = [6, 24, 72];

type RiskLevel = "stable" | "warning" | "critical";

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

function formatLastSeen(timestamp: number | null) {
  if (!timestamp) return "No recent errors";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeAgo(timestamp: number | null) {
  if (!timestamp) return "No recent errors";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "Just now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getRiskMeta(riskLevel: RiskLevel) {
  if (riskLevel === "critical") {
    return { label: "Critical", variant: "destructive" as const };
  }
  if (riskLevel === "warning") {
    return { label: "Warning", variant: "secondary" as const };
  }
  return { label: "Stable", variant: "outline" as const };
}

function formatTrendLabel(timestamp: number, periodHours: TimePeriod) {
  const date = new Date(timestamp);
  if (periodHours <= 24) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

function DeviceErrorTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-foreground mb-2">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="size-2.5 rounded-full" style={{ background: entry.color }} />
            <span className="text-sm text-muted-foreground">{entry.name}:</span>
            <span className="text-sm font-medium text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DeviceMonitorPage() {
  const token = useAuthStore((state) => state.token);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const axisColor = isDark ? "#71717a" : "#a1a1aa";
  const gridColor = isDark ? "#27272a" : "#f4f4f5";

  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [errors, setErrors] = useState<DeviceErrorLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorObj, setErrorObj] = useState<Error | null>(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [showGrid, setShowGrid] = useState(true);
  const [periodHours, setPeriodHours] = useState<TimePeriod>(24);
  const [errorRateThreshold, setErrorRateThreshold] = useState(5);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceHealthPageSize, setDeviceHealthPageSize] = useState(10);
  const [deviceHealthPageIndex, setDeviceHealthPageIndex] = useState(0);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErrorObj(null);
    try {
      const statsData = await fetchDeviceStats(token, periodHours);
      setStats(statsData);
      const errorsData = await fetchDeviceErrors(token, 200);
      setErrors(errorsData);
    } catch (error) {
      setErrorObj(error instanceof Error ? error : new Error("Failed to load device data"));
    } finally {
      setLoading(false);
    }
  }, [token, periodHours]);

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
        label: formatTrendLabel(bucketEnd, periodHours),
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
  }, [filteredErrors, periodHours]);

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
          ? "new activity"
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
  }, [errors, selectedDeviceId]);

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
    loadData();
  }, [loadData]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (isAutoRefresh && token) {
      interval = setInterval(() => {
        loadData();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoRefresh, token, loadData]);

  useEffect(() => {
    if (stats) {
      setLastUpdated(new Date());
    }
  }, [stats]);

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

  if (loading && !stats) return <div className="p-8">Loading device data...</div>;
  if (errorObj)
    return (
      <div className="p-8">
        <div className="rounded-md bg-destructive/15 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-destructive">Error loading device monitor</h3>
              <div className="mt-2 text-sm text-destructive/90">
                <p>{errorObj.message || "Unknown error occurred"}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadData}
                  className="mt-4 border-destructive/20 hover:bg-destructive/20"
                >
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  if (!stats) return <div className="p-8">No data available.</div>;

  return (
    <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Device Monitor</h1>
          <p className="text-muted-foreground">Real-time status of physical device API ingestion.</p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <div className="flex items-center space-x-2">
            <Switch id="auto-refresh" checked={isAutoRefresh} onCheckedChange={setIsAutoRefresh} />
            <Label htmlFor="auto-refresh">Auto-refresh</Label>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Requests ({periodHours}h)</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.success_count}</div>
            <p className="text-xs text-muted-foreground">Successful data ingestions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Count ({periodHours}h)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.error_count}</div>
            <p className="text-xs text-muted-foreground">Failed requests or validations</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.error_rate * 100).toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground">Percentage of total requests</p>
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
                <p className="text-sm font-semibold">Alert Threshold</p>
                <p className="text-xs text-muted-foreground">
                  {isThresholdBreached
                    ? `Error rate is ${currentErrorRatePercent.toFixed(2)}% and exceeded threshold (${errorRateThreshold.toFixed(
                        2
                      )}%).`
                    : `Error rate is ${currentErrorRatePercent.toFixed(2)}%, below threshold (${errorRateThreshold.toFixed(
                        2
                      )}%).`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Label htmlFor="error-threshold" className="text-xs text-muted-foreground whitespace-nowrap">
                Alert if Error Rate ≥
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
                <p className="text-xs font-semibold">Spike Alert (Last 1h vs Previous 1h)</p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedDeviceId ? `${selectedDeviceId} · ` : "All devices · "}
                  {spikeAlert.signedChangeLabel} | Now {spikeAlert.currentCount} / Prev {spikeAlert.previousCount}
                </p>
              </div>
            </div>
            {spikeAlert.level === "critical" && (
              <Badge variant="destructive" className="w-fit">
                Immediate Attention
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
                {isTrendChart ? "Error Trend Over Time" : "Errors by Device ID"}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-3 sm:gap-5">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 sm:size-3 rounded-full bg-[#7ac2f0]" />
                <span className="text-[10px] sm:text-xs text-muted-foreground">
                  {isTrendChart ? `${periodLabels[periodHours]} trend` : periodLabels[periodHours]}
                </span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center size-7 sm:size-8 rounded-md hover:bg-muted">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Chart Options</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <BarChart3 className="size-4 mr-2" />
                    Chart Type
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setChartType("bar")}>
                      <BarChart3 className="size-4 mr-2" />
                      Device Comparison
                      {chartType === "bar" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("line")}>
                      <LineChartIcon className="size-4 mr-2" />
                      Time Trend (Line)
                      {chartType === "line" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("area")}>
                      <TrendingUp className="size-4 mr-2" />
                      Time Trend (Area)
                      {chartType === "area" && <Check className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Calendar className="size-4 mr-2" />
                    Time Period
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {timePeriods.map((periodKey) => (
                      <DropdownMenuItem key={periodKey} onClick={() => setPeriodHours(periodKey)}>
                        {periodLabels[periodKey]}
                        {periodHours === periodKey && <Check className="size-4 ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
                  <Grid3X3 className="size-4 mr-2" />
                  Show Grid Lines
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
                  Reset to Default
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
                    ? `Errors in Timeline (${periodLabels[periodHours]})`
                    : `Total Device Errors (${periodLabels[periodHours]})`}
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-3 space-y-2.5">
                <p className="text-xs sm:text-sm font-semibold">
                  {isTrendChart ? "Peak Time Window" : "Top Failing Device"}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">
                  {isTrendChart
                    ? peakTrendPoint.count > 0
                      ? `${peakTrendPoint.label} has the highest activity with ${peakTrendPoint.count} errors`
                      : "No error events in the selected timeline window"
                    : topDevice
                      ? `${topDevice.device_id} has the highest errors with ${topDevice.count} occurrences`
                      : "No device errors found in the selected period"}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                {isTrendChart
                  ? `Timeline derived from recent error logs in ${periodLabels[periodHours].toLowerCase()}.`
                  : `Top devices encountering issues in ${periodLabels[periodHours].toLowerCase()}.`}
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
                      content={<DeviceErrorTooltip />}
                      cursor={{ fill: isDark ? "#27272a" : "#f4f4f5", radius: 4 }}
                    />
                    <Bar
                      dataKey="count"
                      name="Errors"
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
                    <Tooltip content={<DeviceErrorTooltip />} cursor={{ stroke: isDark ? "#52525b" : "#d4d4d8" }} />
                    <Line
                      type="linear"
                      dataKey="count"
                      name="Errors"
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
                    <Tooltip content={<DeviceErrorTooltip />} cursor={{ stroke: isDark ? "#52525b" : "#d4d4d8" }} />
                    <Area
                      type="linear"
                      dataKey="count"
                      name="Errors"
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
                    Top Failing Devices Details
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1">
                    Click a device to filter Error by Type and Recent Logs.
                  </p>
                </div>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Top 3</span>
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
                            {device.isOnline ? "Online" : "Offline"}
                          </Badge>
                          {selectedDeviceId === device.deviceId && (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px] leading-none">
                              Active Filter
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums">
                          {device.errorCount} errors · {device.share.toFixed(1)}%
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
                          Type: <span className="font-medium text-foreground">{device.dominantType}</span>
                          {device.dominantTypeCount > 0 ? ` (${device.dominantTypeCount})` : ""}
                        </span>
                        <span>
                          Last seen:{" "}
                          <span className="font-medium text-foreground">{formatTimeAgo(device.lastSeen)}</span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  No device errors found in {periodLabels[periodHours].toLowerCase()}.
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
                  ? `Filtered by ${selectedDeviceId}`
                  : "No device filter. Select a top failing device to drill down."}
              </span>
            </div>
            {selectedDeviceId && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedDeviceId(null)}>
                Clear
              </Button>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Error by Type</CardTitle>
              <CardDescription>
                Categorized from recent error messages
                {selectedDeviceId ? ` for ${selectedDeviceId}` : ""}.
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
                        width={98}
                      />
                      <Tooltip content={<DeviceErrorTooltip />} cursor={{ fill: isDark ? "#27272a" : "#f4f4f5" }} />
                      <Bar dataKey="count" name="Errors" radius={[0, 4, 4, 0]}>
                        {errorTypeData.map((entry) => (
                          <Cell key={entry.type} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                  No error events found for this period
                  {selectedDeviceId ? ` for ${selectedDeviceId}` : ""}.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Recent Error Logs</CardTitle>
              <CardDescription>
                Latest 50 error events
                {selectedDeviceId ? ` for ${selectedDeviceId}` : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentScopedErrors.slice(0, 50).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(log.occurred_at).toLocaleTimeString()}
                        </TableCell>
                        <TableCell className="font-medium text-xs">{log.device_id}</TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[160px] truncate" title={log.error_message}>
                          {log.error_message}
                        </TableCell>
                      </TableRow>
                    ))}
                    {recentScopedErrors.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          No errors found{selectedDeviceId ? ` for ${selectedDeviceId}` : ""}.
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
          <CardTitle>Device Health Table</CardTitle>
          <CardDescription>Error-focused health view ranked by risk and frequency.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="text-right">Error Count</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Risk Level</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDeviceHealthRows.map((row) => {
                const riskMeta = getRiskMeta(row.riskLevel);
                return (
                  <TableRow key={row.deviceId}>
                    <TableCell className="font-medium">{row.deviceId}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.errorCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.share.toFixed(1)}%</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatLastSeen(row.lastSeen)}</TableCell>
                    <TableCell>
                      <Badge variant={riskMeta.variant}>{riskMeta.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedDeviceHealthRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No devices with errors in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-4 pt-4 border-t border-border/60 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {deviceHealthStart}-{deviceHealthEnd} of {deviceHealthRows.length}
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
