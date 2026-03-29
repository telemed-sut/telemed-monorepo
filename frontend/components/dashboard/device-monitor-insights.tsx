"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  BarChart2,
  BarChart3,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
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
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";

import type { DeviceErrorLog } from "@/lib/api";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ChartType = "bar" | "line" | "area";
type TimePreset = "today" | "yesterday" | "7d" | "30d" | "custom";
type ComparisonDirection = "up" | "down" | "flat";
type RiskLevel = "stable" | "warning" | "critical";

type TopFailingDeviceDetail = {
  deviceId: string;
  errorCount: number;
  share: number;
  lastSeen: number | null;
  dominantType: string;
  dominantTypeCount: number;
  isOnline: boolean;
};

type DeviceHealthRow = {
  deviceId: string;
  errorCount: number;
  share: number;
  lastSeen: number | null;
  riskLevel: RiskLevel;
};

type DeviceMonitorInsightsProps = {
  language: AppLanguage;
  rangeLabel: string;
  previousWindowLabel: string | null;
  errorCountDirection: ComparisonDirection;
  errorCountDiff: number;
  errorRateDiffPctPoint: number;
  isThresholdBreached: boolean;
  currentErrorRatePercent: number;
  errorRateThreshold: number;
  setErrorRateThreshold: Dispatch<SetStateAction<number>>;
  spikeAlert: {
    currentCount: number;
    previousCount: number;
    direction: ComparisonDirection;
    signedChangeLabel: string;
    level: RiskLevel;
  };
  selectedDeviceSummary: string;
  chartType: ChartType;
  setChartType: Dispatch<SetStateAction<ChartType>>;
  timePreset: TimePreset;
  setTimePreset: Dispatch<SetStateAction<TimePreset>>;
  showGrid: boolean;
  setShowGrid: Dispatch<SetStateAction<boolean>>;
  isTrendChart: boolean;
  filteredErrorsCount: number;
  totalDeviceErrors: number;
  peakTrendPoint: { label: string; count: number };
  topDevice?: { device_id: string; count: number };
  deviceChartData: Array<{ device_id: string; count: number }>;
  trendChartData: Array<{ label: string; count: number }>;
  yAxisMax: number;
  showNoDataFallback: boolean;
  noErrorButHasTraffic: boolean;
  noDataReasonText: string;
  latestErrorActivityAt: string | null;
  jumpToLatestDataWindow: () => void;
  hasSingleDeviceBar: boolean;
  topFailingDeviceDetails: TopFailingDeviceDetail[];
  selectedDeviceIds: string[];
  setSelectedDeviceIds: Dispatch<SetStateAction<string[]>>;
  availableDeviceIds: string[];
  errorTypeData: Array<{ type: string; count: number; color: string }>;
  recentScopedErrors: DeviceErrorLog[];
  paginatedDeviceHealthRows: DeviceHealthRow[];
  deviceHealthRowsCount: number;
  deviceHealthStart: number;
  deviceHealthEnd: number;
  deviceHealthPageIndex: number;
  setDeviceHealthPageIndex: Dispatch<SetStateAction<number>>;
  deviceHealthPageCount: number;
  deviceHealthPageSize: number;
  setDeviceHealthPageSize: Dispatch<SetStateAction<number>>;
};

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

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

function getFreshnessMeta(lastSeen: number | null, language: AppLanguage) {
  if (!lastSeen) {
    return {
      label: tr(language, "No recent data", "ไม่มีข้อมูลล่าสุด"),
      className: "bg-muted text-muted-foreground border-border",
    };
  }

  const ageMin = (Date.now() - lastSeen) / 60_000;
  if (ageMin <= 5) {
    return {
      label: tr(language, "Fresh", "สด"),
      className: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
    };
  }
  if (ageMin <= 30) {
    return {
      label: tr(language, "Delayed", "เริ่มขาดช่วง"),
      className: "bg-amber-500/15 text-amber-700 border-amber-300",
    };
  }
  return {
    label: tr(language, "Stale", "ขาดการเชื่อมต่อ"),
    className: "bg-destructive/15 text-destructive border-destructive/30",
  };
}

function getPresetLabel(preset: TimePreset, language: AppLanguage): string {
  if (preset === "today") return tr(language, "Today", "วันนี้");
  if (preset === "yesterday") return tr(language, "Yesterday", "เมื่อวาน");
  if (preset === "7d") return tr(language, "Last 7 Days", "7 วันล่าสุด");
  if (preset === "30d") return tr(language, "Last 30 Days", "30 วันล่าสุด");
  return tr(language, "Custom Range", "ช่วงกำหนดเอง");
}

function DeviceErrorTooltip({
  active,
  payload,
  label,
  language,
}: TooltipProps<number, string> & { language: AppLanguage }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
      <p className="mb-2 text-sm font-medium text-foreground">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div
            key={`${entry.name ?? "metric"}-${entry.dataKey ?? "value"}-${entry.color ?? "default"}`}
            className="flex items-center gap-2"
          >
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

export function DeviceMonitorInsights({
  language,
  rangeLabel,
  previousWindowLabel,
  errorCountDirection,
  errorCountDiff,
  errorRateDiffPctPoint,
  isThresholdBreached,
  currentErrorRatePercent,
  errorRateThreshold,
  setErrorRateThreshold,
  spikeAlert,
  selectedDeviceSummary,
  chartType,
  setChartType,
  timePreset,
  setTimePreset,
  showGrid,
  setShowGrid,
  isTrendChart,
  filteredErrorsCount,
  totalDeviceErrors,
  peakTrendPoint,
  topDevice,
  deviceChartData,
  trendChartData,
  yAxisMax,
  showNoDataFallback,
  noErrorButHasTraffic,
  noDataReasonText,
  latestErrorActivityAt,
  jumpToLatestDataWindow,
  hasSingleDeviceBar,
  topFailingDeviceDetails,
  selectedDeviceIds,
  setSelectedDeviceIds,
  availableDeviceIds,
  errorTypeData,
  recentScopedErrors,
  paginatedDeviceHealthRows,
  deviceHealthRowsCount,
  deviceHealthStart,
  deviceHealthEnd,
  deviceHealthPageIndex,
  setDeviceHealthPageIndex,
  deviceHealthPageCount,
  deviceHealthPageSize,
  setDeviceHealthPageSize,
}: DeviceMonitorInsightsProps) {
  const axisColor = "var(--muted-foreground)";
  const gridColor = "var(--border)";
  const selectedDeviceSet = useMemo(
    () => new Set(selectedDeviceIds),
    [selectedDeviceIds]
  );

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="text-sm font-semibold">
              {tr(language, "Compare with Previous Period", "เปรียบเทียบกับช่วงก่อนหน้า")}
            </p>
            <p className="text-sm text-muted-foreground">
              {previousWindowLabel ?? tr(language, "Previous range unavailable", "ไม่มีข้อมูลช่วงก่อนหน้า")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Badge
              variant={
                errorCountDirection === "up"
                  ? "destructive"
                  : errorCountDirection === "down"
                    ? "secondary"
                    : "outline"
              }
            >
              {tr(language, "Error Count:", "จำนวน Error:")} {errorCountDiff >= 0 ? "+" : ""}
              {errorCountDiff}
            </Badge>
            <Badge variant="outline">
              {tr(language, "Error Rate:", "อัตรา Error:")} {errorRateDiffPctPoint >= 0 ? "+" : ""}
              {errorRateDiffPctPoint}pp
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className={isThresholdBreached ? "border-destructive/40" : ""}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-full p-1.5 ${
                  isThresholdBreached
                    ? "bg-destructive/15 text-destructive"
                    : "bg-emerald-500/15 text-emerald-600"
                }`}
              >
                <ShieldAlert className="size-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{tr(language, "Alert Threshold", "เกณฑ์แจ้งเตือน")}</p>
                <p className="text-sm text-muted-foreground">
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
              <Label htmlFor="error-threshold" className="whitespace-nowrap text-sm text-muted-foreground">
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
                  className="h-9 w-24 text-sm"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                <p className="text-sm font-semibold">
                  {tr(language, "Spike Alert (Last 1h vs Previous 1h)", "แจ้งเตือนสไปก์ (1 ชม.ล่าสุด เทียบ 1 ชม.ก่อนหน้า)")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedDeviceSummary} · {spikeAlert.signedChangeLabel} | {tr(language, "Now", "ตอนนี้")}{" "}
                  {spikeAlert.currentCount} / {tr(language, "Prev", "ก่อนหน้า")} {spikeAlert.previousCount}
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

      <div className="grid grid-cols-1 items-start gap-4 min-[500px]:grid-cols-7">
        <div className="min-[500px]:col-span-4 min-w-0 self-start rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="flex flex-1 items-center gap-2 sm:gap-2.5">
              <Button variant="outline" size="icon" className="size-7 sm:size-8">
                <BarChart2 className="size-4 text-muted-foreground sm:size-[18px]" />
              </Button>
              <span className="text-sm font-medium sm:text-base">
                {isTrendChart
                  ? tr(language, "Error Trend Over Time", "แนวโน้มข้อผิดพลาดตามเวลา")
                  : tr(language, "Errors by Device ID", "ข้อผิดพลาดแยกตาม Device ID")}
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted sm:size-8">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{tr(language, "Chart Options", "ตัวเลือกกราฟ")}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <BarChart3 className="mr-2 size-4" />
                    {tr(language, "Chart Type", "ประเภทกราฟ")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setChartType("bar")}>
                      <BarChart3 className="mr-2 size-4" />
                      {tr(language, "Device Comparison", "เปรียบเทียบอุปกรณ์")}
                      {chartType === "bar" && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("line")}>
                      <LineChartIcon className="mr-2 size-4" />
                      {tr(language, "Time Trend (Line)", "แนวโน้มเวลา (เส้น)")}
                      {chartType === "line" && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setChartType("area")}>
                      <TrendingUp className="mr-2 size-4" />
                      {tr(language, "Time Trend (Area)", "แนวโน้มเวลา (พื้นที่)")}
                      {chartType === "area" && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Calendar className="mr-2 size-4" />
                    {tr(language, "Time Period", "ช่วงเวลา")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(["today", "yesterday", "7d", "30d", "custom"] as TimePreset[]).map((preset) => (
                      <DropdownMenuItem key={preset} onClick={() => setTimePreset(preset)}>
                        {getPresetLabel(preset, language)}
                        {timePreset === preset && <Check className="ml-auto size-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
                  <Grid3X3 className="mr-2 size-4" />
                  {tr(language, "Show Grid Lines", "แสดงเส้นกริด")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setChartType("bar");
                    setTimePreset("today");
                    setShowGrid(true);
                  }}
                >
                  <RefreshCw className="mr-2 size-4" />
                  {tr(language, "Reset to Default", "รีเซ็ตค่าเริ่มต้น")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-3 flex flex-col gap-3 min-[500px]:flex-row sm:gap-4">
            <div className="w-full shrink-0 min-[500px]:w-[170px] lg:w-[190px]">
              <div className="space-y-2 sm:space-y-4">
                <p className="text-2xl font-semibold leading-tight tracking-tight lg:text-[34px]">
                  {isTrendChart ? filteredErrorsCount : totalDeviceErrors}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isTrendChart
                    ? `${tr(language, "Errors in Timeline", "ข้อผิดพลาดตามไทม์ไลน์")} (${rangeLabel})`
                    : `${tr(language, "Total Device Errors", "ข้อผิดพลาดอุปกรณ์ทั้งหมด")} (${rangeLabel})`}
                </p>
              </div>

              <div className="mt-3 rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-semibold">
                  {isTrendChart
                    ? tr(language, "Peak Time Window", "ช่วงเวลาที่พีคที่สุด")
                    : tr(language, "Top Failing Device", "อุปกรณ์ที่ผิดพลาดมากสุด")}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {isTrendChart
                    ? peakTrendPoint.count > 0
                      ? tr(
                          language,
                          `${peakTrendPoint.label} has the highest activity with ${peakTrendPoint.count} errors`,
                          `${peakTrendPoint.label} มีกิจกรรมสูงสุดด้วยข้อผิดพลาด ${peakTrendPoint.count} ครั้ง`
                        )
                      : tr(language, "No error events in the selected timeline window", "ไม่พบเหตุการณ์ข้อผิดพลาดในช่วงเวลาที่เลือก")
                    : topDevice
                      ? tr(
                          language,
                          `${topDevice.device_id} has the highest errors with ${topDevice.count} occurrences`,
                          `${topDevice.device_id} มีข้อผิดพลาดสูงสุด ${topDevice.count} ครั้ง`
                        )
                      : tr(language, "No device errors found in the selected period", "ไม่พบข้อผิดพลาดของอุปกรณ์ในช่วงเวลาที่เลือก")}
                </p>
              </div>
            </div>

            <div className="min-h-[360px] flex-1">
              {(showNoDataFallback || noErrorButHasTraffic) && (
                <div className="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">{noDataReasonText}</p>
                  {(showNoDataFallback || latestErrorActivityAt) && (
                    <Button variant="outline" size="sm" className="h-8 text-sm" onClick={jumpToLatestDataWindow}>
                      {tr(language, "Go to latest data window", "ไปช่วงที่มีข้อมูลล่าสุด")}
                    </Button>
                  )}
                </div>
              )}

              <ResponsiveContainer width="100%" height={340}>
                {!isTrendChart ? (
                  <BarChart data={deviceChartData}>
                    <defs>
                      <linearGradient id="deviceErrorBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--med-primary-light)" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="var(--med-primary-light)" stopOpacity={0.45} />
                      </linearGradient>
                    </defs>
                    {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
                    <XAxis dataKey="device_id" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 9 }} dy={8} />
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
                      cursor={{
                        fill: "var(--med-primary-light)",
                        fillOpacity: 0.18,
                        stroke: "var(--med-primary)",
                        strokeOpacity: 0.2,
                      }}
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
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 9 }} dy={8} />
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
                      cursor={{ stroke: "var(--med-primary)", strokeOpacity: 0.28 }}
                    />
                    <Line
                      type="linear"
                      dataKey="count"
                      name={tr(language, "Errors", "ข้อผิดพลาด")}
                      stroke="var(--med-primary-light)"
                      strokeWidth={3}
                      dot={{ fill: "var(--med-primary-light)", strokeWidth: 0, r: 4 }}
                      activeDot={{ r: 6, fill: "var(--med-primary-light)" }}
                      connectNulls
                    />
                  </LineChart>
                ) : (
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="deviceErrorAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--med-primary-light)" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="var(--med-primary-light)" stopOpacity={0.2} />
                      </linearGradient>
                    </defs>
                    {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 9 }} dy={8} />
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
                      cursor={{ stroke: "var(--med-primary)", strokeOpacity: 0.28 }}
                    />
                    <Area
                      type="linear"
                      dataKey="count"
                      name={tr(language, "Errors", "ข้อผิดพลาด")}
                      stroke="var(--med-primary-light)"
                      strokeWidth={3}
                      fill="url(#deviceErrorAreaGrad)"
                      dot={{ fill: "var(--med-primary-light)", strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, fill: "var(--med-primary-light)" }}
                      connectNulls
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>

              {hasSingleDeviceBar && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {tr(
                    language,
                    "Only one device has errors in this period, so hover appears on a single zone.",
                    "ช่วงเวลานี้มีอุปกรณ์ที่ผิดพลาดเพียง 1 ตัว จึงแสดงโฮเวอร์ได้เพียงโซนเดียว"
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3 sm:p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {tr(language, "Top Failing Devices Details", "รายละเอียดอุปกรณ์ที่ผิดพลาดสูงสุด")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr(language, "Click a device to filter Error by Type and Recent Logs.", "คลิกอุปกรณ์เพื่อกรองประเภทข้อผิดพลาดและบันทึกล่าสุด")}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{tr(language, "Top 3", "อันดับสูงสุด 3 รายการ")}</span>
            </div>
            {topFailingDeviceDetails.length > 0 ? (
              <div className="mt-3 grid gap-2.5">
                {topFailingDeviceDetails.map((device) => {
                  const freshness = getFreshnessMeta(device.lastSeen, language);
                  const selected = selectedDeviceSet.has(device.deviceId);
                  return (
                    <button
                      type="button"
                      key={device.deviceId}
                      onClick={() =>
                        setSelectedDeviceIds((current) =>
                          current.includes(device.deviceId)
                            ? current.filter((id) => id !== device.deviceId)
                            : [...current, device.deviceId]
                        )
                      }
                      className={`w-full rounded-md border p-2.5 text-left transition-colors sm:p-3 ${
                        selected
                          ? "border-[var(--med-primary-light)] bg-[var(--med-primary-light)]/10"
                          : "border-border/60 bg-background/90 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{device.deviceId}</span>
                          <Badge variant={device.isOnline ? "secondary" : "outline"} className="h-5 px-2 text-xs leading-none">
                            {device.isOnline ? tr(language, "Online", "ออนไลน์") : tr(language, "Offline", "ออฟไลน์")}
                          </Badge>
                          {selected && (
                            <Badge variant="secondary" className="h-5 px-2 text-xs leading-none">
                              {tr(language, "Active Filter", "ตัวกรองที่ใช้งาน")}
                            </Badge>
                          )}
                          <Badge className={`h-5 border px-2 text-xs leading-none ${freshness.className}`}>
                            {freshness.label}
                          </Badge>
                        </div>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {device.errorCount} {tr(language, "errors", "ข้อผิดพลาด")} · {device.share.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-[var(--med-primary-light)] transition-all"
                          style={{ width: `${Math.min(100, Math.max(device.share, 5))}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span>
                          {tr(language, "Type", "ประเภท")}:{" "}
                          <span className="font-medium text-foreground">
                            {localizeErrorType(device.dominantType, language)}
                          </span>
                          {device.dominantTypeCount > 0 ? ` (${device.dominantTypeCount})` : ""}
                        </span>
                        <span>
                          {tr(language, "Last seen", "พบล่าสุด")}:{" "}
                          <span className="font-medium text-foreground">
                            {formatTimeAgo(device.lastSeen, language)}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                {tr(language, "No device errors found in", "ไม่พบข้อผิดพลาดของอุปกรณ์ในช่วง")} {rangeLabel}.
              </div>
            )}
          </div>
        </div>

        <div className="min-[500px]:col-span-3 grid gap-4 self-start">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <Filter className="size-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {selectedDeviceIds.length > 0
                  ? tr(language, `Filtered by ${selectedDeviceSummary}`, `กรองโดย ${selectedDeviceSummary}`)
                  : tr(language, "No device filter. Select devices to drill down.", "ยังไม่ได้เลือกตัวกรองอุปกรณ์ เลือกอุปกรณ์เพื่อดูรายละเอียด")}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-sm")}
                >
                  {tr(language, "Choose Devices", "เลือกอุปกรณ์")}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-auto">
                  <DropdownMenuLabel>{tr(language, "Device Filter", "ตัวกรองอุปกรณ์")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {availableDeviceIds.map((deviceId) => (
                    <DropdownMenuCheckboxItem
                      key={deviceId}
                      checked={selectedDeviceSet.has(deviceId)}
                      onCheckedChange={(checked) => {
                        setSelectedDeviceIds((prev) =>
                          checked ? [...prev, deviceId] : prev.filter((id) => id !== deviceId)
                        );
                      }}
                    >
                      {deviceId}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {selectedDeviceIds.length > 0 && (
                <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={() => setSelectedDeviceIds([])}>
                  {tr(language, "Clear", "ล้าง")}
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>{tr(language, "Error by Type", "ข้อผิดพลาดตามประเภท")}</CardTitle>
              <CardDescription>
                {tr(language, "Categorized from recent error messages", "จัดหมวดหมู่จากข้อความข้อผิดพลาดล่าสุด")}
                {selectedDeviceIds.length > 0
                  ? tr(language, ` for ${selectedDeviceSummary}`, ` สำหรับ ${selectedDeviceSummary}`)
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
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 10 }} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="type"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: axisColor, fontSize: 11 }}
                        tickFormatter={(value: string) => localizeErrorType(String(value), language)}
                        width={98}
                      />
                      <Tooltip
                        content={<DeviceErrorTooltip language={language} />}
                        cursor={{
                          fill: "var(--med-primary-light)",
                          fillOpacity: 0.18,
                          stroke: "var(--med-primary)",
                          strokeOpacity: 0.2,
                        }}
                      />
                      <Bar dataKey="count" name={tr(language, "Errors", "ข้อผิดพลาด")} radius={[0, 4, 4, 0]}>
                        {errorTypeData.map((entry) => (
                          <Cell key={entry.type} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                  {tr(language, "No error events found for this period", "ไม่พบเหตุการณ์ข้อผิดพลาดในช่วงเวลานี้")}
                  {selectedDeviceIds.length > 0
                    ? tr(language, ` for ${selectedDeviceSummary}`, ` สำหรับ ${selectedDeviceSummary}`)
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
                {selectedDeviceIds.length > 0
                  ? tr(language, ` for ${selectedDeviceSummary}`, ` สำหรับ ${selectedDeviceSummary}`)
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
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(log.occurred_at).toLocaleTimeString(localeOf(language))}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{log.device_id}</TableCell>
                        <TableCell className="max-w-[170px] truncate text-sm font-mono text-amber-600" title={log.error_code || "-"}>
                          {log.error_code || "-"}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm text-red-500" title={log.error_message}>
                          {log.error_message}
                        </TableCell>
                        <TableCell className="max-w-[340px] truncate text-sm text-muted-foreground" title={log.suggestion || ""}>
                          {log.suggestion || tr(language, "Check backend logs for details", "ดู backend logs เพิ่มเติม")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {recentScopedErrors.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          {tr(language, "No errors found", "ไม่พบข้อผิดพลาด")}
                          {selectedDeviceIds.length > 0
                            ? tr(language, ` for ${selectedDeviceSummary}`, ` สำหรับ ${selectedDeviceSummary}`)
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
          <CardDescription>
            {tr(language, "Error-focused health view ranked by risk and frequency.", "มุมมองสุขภาพอุปกรณ์ที่จัดอันดับตามความเสี่ยงและความถี่ของข้อผิดพลาด")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr(language, "Device", "อุปกรณ์")}</TableHead>
                <TableHead className="text-right">{tr(language, "Error Count", "จำนวนข้อผิดพลาด")}</TableHead>
                <TableHead className="text-right">{tr(language, "Share", "สัดส่วน")}</TableHead>
                <TableHead>{tr(language, "Last Seen", "พบล่าสุด")}</TableHead>
                <TableHead>{tr(language, "Freshness", "ความสดของข้อมูล")}</TableHead>
                <TableHead>{tr(language, "Risk Level", "ระดับความเสี่ยง")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDeviceHealthRows.map((row) => {
                const riskMeta = getRiskMeta(row.riskLevel, language);
                const freshness = getFreshnessMeta(row.lastSeen, language);
                return (
                  <TableRow key={row.deviceId}>
                    <TableCell className="font-medium">{row.deviceId}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.errorCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.share.toFixed(1)}%</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatLastSeen(row.lastSeen, language)}</TableCell>
                    <TableCell>
                      <Badge className={`border ${freshness.className}`}>{freshness.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={riskMeta.variant}>{riskMeta.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedDeviceHealthRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {noDataReasonText}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {deviceHealthStart}-{deviceHealthEnd} {tr(language, "of", "จาก")} {deviceHealthRowsCount}
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Select
                value={String(deviceHealthPageSize)}
                onValueChange={(value) => {
                  setDeviceHealthPageSize(Number(value));
                  setDeviceHealthPageIndex(0);
                }}
              >
                <SelectTrigger className="h-9 w-[88px] rounded-full text-sm">
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

                <div className="flex size-8 items-center justify-center rounded-full bg-[#54B3D6] text-sm font-medium text-white">
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
                  onClick={() => setDeviceHealthPageIndex(Math.max(0, deviceHealthPageCount - 1))}
                  disabled={deviceHealthPageIndex >= deviceHealthPageCount - 1}
                >
                  <ChevronsRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
