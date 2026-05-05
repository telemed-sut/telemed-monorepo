"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { format, parseISO } from "date-fns";
import { th as thLocale, enGB } from "date-fns/locale";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoreHorizontalIcon,
  ChartBarLineIcon,
  ChartLineData01Icon,
  ChartAverageIcon,
  Calendar01Icon,
  GridIcon,
  RefreshIcon,
  Tick01Icon,
  Stethoscope02Icon,
} from "@hugeicons/core-free-icons";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { VitalTrendDataPoint } from "@/lib/api-types";
import type { AppLanguage } from "@/store/language-config";

interface VitalsTrendChartProps {
  data: VitalTrendDataPoint[];
  language: AppLanguage;
  isLoading: boolean;
  patientId: string;
  onRefreshData?: () => void;
}

type ChartType = "bar" | "line" | "area";
type DataSeries = "weight" | "heart_rate" | "sys_pressure";
type TimePeriod = "7d" | "14d" | "30d";

const isTh = (language: AppLanguage) => language === "th";

const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;

const PERIOD_DAYS: Record<TimePeriod, number> = { "7d": 7, "14d": 14, "30d": 30 };

const PERIOD_LABEL = (language: AppLanguage): Record<TimePeriod, string> => ({
  "7d": tr(language, "Last 7 Days", "7 วันล่าสุด"),
  "14d": tr(language, "Last 14 Days", "14 วันล่าสุด"),
  "30d": tr(language, "Last 30 Days", "30 วันล่าสุด"),
});

// Thresholds
const isWeightAbnormal = (w: number) => w < 40 || w > 120;
const isHrAbnormal = (hr: number) => hr < 60 || hr > 100;
const isSysAbnormal = (sys: number) => sys >= 140 || sys < 90;

function CustomTooltip({
  active,
  payload,
  label,
  language,
  showWeight,
  showHeartRate,
  showSys,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; name: string; value: number; color: string }>;
  label?: string;
  language: AppLanguage;
  showWeight: boolean;
  showHeartRate: boolean;
  showSys: boolean;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg min-w-[160px]">
      <p className="text-sm font-medium text-foreground mb-3">{label}</p>
      <div className="space-y-2">
        {payload.map((entry) => {
          const unit =
            entry.dataKey === "weight_kg"
              ? "kg"
              : entry.dataKey === "heart_rate"
              ? "BPM"
              : "mmHg";
          const abnormal =
            (entry.dataKey === "weight_kg" && isWeightAbnormal(entry.value)) ||
            (entry.dataKey === "heart_rate" && isHrAbnormal(entry.value)) ||
            (entry.dataKey === "sys_pressure" && isSysAbnormal(entry.value));
          return (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-sm text-muted-foreground">{entry.name}</span>
              </div>
              <span
                className={
                  "text-sm font-semibold tabular-nums " +
                  (abnormal ? "text-red-600" : "text-foreground")
                }
              >
                {entry.value} {unit}
                {abnormal && " ⚠"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { PatientVitalsManager } from "./patient-vitals-manager";
import { Button } from "@/components/ui/button";

export function VitalsTrendChart({ data, language, isLoading, patientId, onRefreshData }: VitalsTrendChartProps) {
  const { theme } = useTheme();
  const [chartType, setChartType] = useState<ChartType>("area");
  const [period, setPeriod] = useState<TimePeriod>("30d");
  const [showGrid, setShowGrid] = useState(true);
  const [smoothCurve, setSmoothCurve] = useState(true);
  const [showWeight, setShowWeight] = useState(true);
  const [showHeartRate, setShowHeartRate] = useState(true);
  const [showSys, setShowSys] = useState(true);
  const [showManager, setShowManager] = useState(false);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#71717a" : "#a1a1aa";
  const gridColor = isDark ? "#27272a" : "#e5e7eb";

  const dateLocale = isTh(language) ? thLocale : enGB;

  const periodDays = PERIOD_DAYS[period];
  const periodLabels = PERIOD_LABEL(language);

  const filteredData = useMemo(() => {
    const sorted = [...data].sort(
      (a, b) =>
        new Date(a.recorded_at ?? a.date).getTime() -
        new Date(b.recorded_at ?? b.date).getTime()
    );
    return sorted.slice(-periodDays).map((d) => ({
      ...d,
      label: format(parseISO(d.recorded_at ?? d.date), "d MMM HH:mm", { locale: dateLocale }),
    }));
  }, [data, periodDays, dateLocale]);

  // Summary stats from latest point
  const latestWeight = useMemo(
    () => [...data].reverse().find((d) => d.weight_kg != null)?.weight_kg ?? null,
    [data]
  );
  const latestHeight = useMemo(
    () => [...data].reverse().find((d) => d.height_cm != null)?.height_cm ?? null,
    [data]
  );

  const hasWeight = data.some((d) => d.weight_kg != null);
  const hasHr = data.some((d) => d.heart_rate != null);
  const hasSys = data.some((d) => d.sys_pressure != null);
  const hasAny = hasWeight || hasHr || hasSys;

  // Abnormal count for badge
  const abnormalCount = useMemo(() => {
    let count = 0;
    for (const d of data) {
      if (d.weight_kg != null && isWeightAbnormal(d.weight_kg)) count++;
      if (d.heart_rate != null && isHrAbnormal(d.heart_rate)) count++;
      if (d.sys_pressure != null && isSysAbnormal(d.sys_pressure)) count++;
    }
    return count;
  }, [data]);

  const resetToDefault = () => {
    setChartType("area");
    setPeriod("30d");
    setShowGrid(true);
    setSmoothCurve(true);
    setShowWeight(true);
    setShowHeartRate(true);
    setShowSys(true);
  };

  const effectiveChartType: ChartType = filteredData.length < 2 ? "bar" : chartType;

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-4">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="h-[220px] px-4 pb-4 sm:h-[250px]">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-4">
          <span className="text-sm font-medium text-muted-foreground">
            {tr(language, "Weight & Vital Sign Trends", "แนวโน้มน้ำหนักและสัญญาณชีพ")}
          </span>
        </div>
        <div className="h-[120px] flex flex-col items-center justify-center px-4 pb-4 text-center">
          <HugeiconsIcon icon={Stethoscope02Icon} className="size-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">
            {tr(language, "No trend data recorded yet", "ยังไม่มีข้อมูลแนวโน้ม")}
          </p>
        </div>
      </div>
    );
  }

  const curveType = smoothCurve ? "monotone" : "linear";
  const weightColor = "#10b981"; // emerald
  const hrColor = "#ef4444";     // red
  const sysColor = "#f59e0b";    // amber

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header — same style as FinancialFlowChart */}
      <div className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 flex-wrap">
          <HugeiconsIcon
            icon={Stethoscope02Icon}
            className="size-4 text-[var(--med-primary-light)]"
          />
          <span className="text-sm font-medium text-muted-foreground">
            {tr(language, "Weight & Vital Sign Trends", "แนวโน้มน้ำหนักและสัญญาณชีพ")}
          </span>
          {abnormalCount > 0 && (
            <Badge
              variant="outline"
              className="rounded-full border-red-200 bg-red-50 px-2 py-0 text-[0.68rem] text-red-700 h-5"
            >
              ⚠ {abnormalCount} {tr(language, "abnormal", "ผิดปกติ")}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-5">
          {/* Manage Records Button */}
          <Button variant="outline" size="sm" onClick={() => setShowManager(true)}>
            {tr(language, "Manage Records", "จัดการข้อมูล")}
          </Button>

          {/* Legend */}
          <div className="hidden items-center gap-4 sm:flex">
            {showWeight && hasWeight && (
              <div className="flex items-center gap-1.5">
                <div className="size-3 rounded-full" style={{ backgroundColor: weightColor }} />
                <span className="text-sm font-medium text-muted-foreground">
                  {tr(language, "Weight", "น้ำหนัก")}
                  {latestWeight != null && (
                    <span className="ml-1 font-semibold text-foreground">{latestWeight} kg</span>
                  )}
                </span>
              </div>
            )}
            {showHeartRate && hasHr && (
              <div className="flex items-center gap-1.5">
                <div className="size-3 rounded-full" style={{ backgroundColor: hrColor }} />
                <span className="text-sm font-medium text-muted-foreground">
                  {tr(language, "Heart Rate", "ชีพจร")}
                </span>
              </div>
            )}
            {showSys && hasSys && (
              <div className="flex items-center gap-1.5">
                <div className="size-3 rounded-full" style={{ backgroundColor: sysColor }} />
                <span className="text-sm font-medium text-muted-foreground">
                  {tr(language, "SYS Pressure", "ความดัน SYS")}
                </span>
              </div>
            )}
            {latestHeight != null && (
              <span className="text-xs text-muted-foreground/80">
                {tr(language, "Height", "ส่วนสูง")}: {latestHeight} cm
              </span>
            )}
          </div>

          {/* ⋯ Dropdown — mirrors FinancialFlowChart exactly */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted">
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {tr(language, "Chart Type", "ประเภทรายงาน")}
                </p>
                <DropdownMenuItem onClick={() => setChartType("bar")}>
                  <HugeiconsIcon icon={ChartBarLineIcon} className="size-4 mr-2" />
                  {tr(language, "Bar Chart", "กราฟแท่ง")}
                  {chartType === "bar" && <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("line")}>
                  <HugeiconsIcon icon={ChartLineData01Icon} className="size-4 mr-2" />
                  {tr(language, "Line Chart", "กราฟเส้น")}
                  {chartType === "line" && <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("area")}>
                  <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                  {tr(language, "Area Chart", "กราฟพื้นที่")}
                  {chartType === "area" && <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={Calendar01Icon} className="size-4 mr-2" />
                  {tr(language, "Time Period", "ช่วงเวลา")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(PERIOD_DAYS) as TimePeriod[]).map((key) => (
                    <DropdownMenuItem key={key} onClick={() => setPeriod(key)}>
                      {periodLabels[key]}
                      {period === key && <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {tr(language, "Display Options", "ตัวเลือกการแสดงผล")}
                </p>
                <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
                  <HugeiconsIcon icon={GridIcon} className="size-4 mr-2" />
                  {tr(language, "Show Grid Lines", "แสดงเส้นกริด")}
                </DropdownMenuCheckboxItem>
                {(chartType === "line" || chartType === "area") && (
                  <DropdownMenuCheckboxItem checked={smoothCurve} onCheckedChange={setSmoothCurve}>
                    <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                    {tr(language, "Smooth Curve", "เส้นโค้งแบบนุ่ม")}
                  </DropdownMenuCheckboxItem>
                )}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {tr(language, "Data Series", "ชุดข้อมูล")}
                </p>
                {hasWeight && (
                  <DropdownMenuCheckboxItem checked={showWeight} onCheckedChange={setShowWeight}>
                    <div className="size-3 rounded-full mr-2" style={{ backgroundColor: weightColor }} />
                    {tr(language, "Show Weight", "แสดงน้ำหนัก")}
                  </DropdownMenuCheckboxItem>
                )}
                {hasHr && (
                  <DropdownMenuCheckboxItem checked={showHeartRate} onCheckedChange={setShowHeartRate}>
                    <div className="size-3 rounded-full mr-2" style={{ backgroundColor: hrColor }} />
                    {tr(language, "Show Heart Rate", "แสดงชีพจร")}
                  </DropdownMenuCheckboxItem>
                )}
                {hasSys && (
                  <DropdownMenuCheckboxItem checked={showSys} onCheckedChange={setShowSys}>
                    <div className="size-3 rounded-full mr-2" style={{ backgroundColor: sysColor }} />
                    {tr(language, "Show SYS Pressure", "แสดงความดัน SYS")}
                  </DropdownMenuCheckboxItem>
                )}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={resetToDefault}>
                <HugeiconsIcon icon={RefreshIcon} className="size-4 mr-2" />
                {tr(language, "Reset to Default", "รีเซ็ตค่าเริ่มต้น")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Chart area — same size as FinancialFlowChart */}
      <div className="h-[220px] px-2 pb-4 sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          {effectiveChartType === "bar" ? (
            <BarChart data={filteredData} barGap={4}>
              <defs>
                <linearGradient id="vtWeightGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={weightColor} stopOpacity={1} />
                  <stop offset="100%" stopColor={weightColor} stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="vtHrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={hrColor} stopOpacity={1} />
                  <stop offset="100%" stopColor={hrColor} stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="vtSysGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sysColor} stopOpacity={1} />
                  <stop offset="100%" stopColor={sysColor} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis hide />
              <Tooltip
                content={
                  <CustomTooltip language={language} showWeight={showWeight} showHeartRate={showHeartRate} showSys={showSys} />
                }
                cursor={{ fill: isDark ? "#27272a" : "#f4f4f5", radius: 4 }}
              />
              {showWeight && hasWeight && (
                <Bar dataKey="weight_kg" name={tr(language, "Weight", "น้ำหนัก")} fill="url(#vtWeightGrad)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              )}
              {showHeartRate && hasHr && (
                <Bar dataKey="heart_rate" name={tr(language, "Heart Rate", "ชีพจร")} fill="url(#vtHrGrad)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              )}
              {showSys && hasSys && (
                <Bar dataKey="sys_pressure" name={tr(language, "SYS Pressure", "ความดัน SYS")} fill="url(#vtSysGrad)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              )}
            </BarChart>
          ) : effectiveChartType === "line" ? (
            <LineChart data={filteredData}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />}
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis hide />
              <Tooltip
                content={
                  <CustomTooltip language={language} showWeight={showWeight} showHeartRate={showHeartRate} showSys={showSys} />
                }
                cursor={{ stroke: "#d4d4d8" }}
              />
              {showWeight && hasWeight && (
                <Line type={curveType} dataKey="weight_kg" name={tr(language, "Weight", "น้ำหนัก")} stroke={weightColor} strokeWidth={2} dot={{ r: 3, fill: weightColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: weightColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
              {showHeartRate && hasHr && (
                <Line type={curveType} dataKey="heart_rate" name={tr(language, "Heart Rate", "ชีพจร")} stroke={hrColor} strokeWidth={2} dot={{ r: 3, fill: hrColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: hrColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
              {showSys && hasSys && (
                <Line type={curveType} dataKey="sys_pressure" name={tr(language, "SYS Pressure", "ความดัน SYS")} stroke={sysColor} strokeWidth={2} dot={{ r: 3, fill: sysColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: sysColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
            </LineChart>
          ) : (
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="vtWeightArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={weightColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={weightColor} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="vtHrArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={hrColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={hrColor} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="vtSysArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sysColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={sysColor} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              {showGrid && <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />}
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis hide />
              <Tooltip
                content={
                  <CustomTooltip language={language} showWeight={showWeight} showHeartRate={showHeartRate} showSys={showSys} />
                }
                cursor={{ stroke: "#d4d4d8" }}
              />
              {showWeight && hasWeight && (
                <Area type={curveType} dataKey="weight_kg" name={tr(language, "Weight", "น้ำหนัก")} stroke={weightColor} strokeWidth={2} fill="url(#vtWeightArea)" dot={{ r: 3, fill: weightColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: weightColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
              {showHeartRate && hasHr && (
                <Area type={curveType} dataKey="heart_rate" name={tr(language, "Heart Rate", "ชีพจร")} stroke={hrColor} strokeWidth={2} fill="url(#vtHrArea)" dot={{ r: 3, fill: hrColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: hrColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
              {showSys && hasSys && (
                <Area type={curveType} dataKey="sys_pressure" name={tr(language, "SYS Pressure", "ความดัน SYS")} stroke={sysColor} strokeWidth={2} fill="url(#vtSysArea)" dot={{ r: 3, fill: sysColor, strokeWidth: 0 }} activeDot={{ r: 6, fill: sysColor, stroke: "white", strokeWidth: 2 }} connectNulls />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      <PatientVitalsManager
        patientId={patientId}
        language={language}
        open={showManager}
        onOpenChange={setShowManager}
        onRecordsChanged={() => onRefreshData?.()}
      />
    </div>
  );
}
