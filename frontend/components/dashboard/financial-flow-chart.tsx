"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Stethoscope02Icon,
  MoreHorizontalIcon,
  ChartBarLineIcon,
  ChartLineData01Icon,
  ChartAverageIcon,
  Calendar01Icon,
  GridIcon,
  RefreshIcon,
  Tick01Icon,
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
  TooltipProps,
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
import { fetchOverviewStats, type MonthlyStats } from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

type ChartType = "bar" | "line" | "area";
type TimePeriod = "3months" | "6months" | "year" | "q1" | "q2" | "q3" | "q4";

const PERIOD_LABELS: Record<AppLanguage, Record<TimePeriod, string>> = {
  en: {
    "3months": "Last 3 Months",
    "6months": "Last 6 Months",
    year: "Full Year",
    q1: "Q1 (Jan-Mar)",
    q2: "Q2 (Apr-Jun)",
    q3: "Q3 (Jul-Sep)",
    q4: "Q4 (Oct-Dec)",
  },
  th: {
    "3months": "3 เดือนล่าสุด",
    "6months": "6 เดือนล่าสุด",
    year: "ทั้งปี",
    q1: "ไตรมาส 1 (ม.ค.-มี.ค.)",
    q2: "ไตรมาส 2 (เม.ย.-มิ.ย.)",
    q3: "ไตรมาส 3 (ก.ค.-ก.ย.)",
    q4: "ไตรมาส 4 (ต.ค.-ธ.ค.)",
  },
};

const MONTH_LABELS: Record<AppLanguage, Record<string, string>> = {
  en: {},
  th: {
    Jan: "ม.ค.",
    Feb: "ก.พ.",
    Mar: "มี.ค.",
    Apr: "เม.ย.",
    May: "พ.ค.",
    Jun: "มิ.ย.",
    Jul: "ก.ค.",
    Aug: "ส.ค.",
    Sep: "ก.ย.",
    Oct: "ต.ค.",
    Nov: "พ.ย.",
    Dec: "ธ.ค.",
  },
};

const I18N: Record<
  AppLanguage,
  {
    trendTitle: string;
    newPatients: string;
    consultations: string;
    chartType: string;
    barChart: string;
    lineChart: string;
    areaChart: string;
    timePeriod: string;
    displayOptions: string;
    showGridLines: string;
    smoothCurve: string;
    dataSeries: string;
    showNewPatients: string;
    showConsultations: string;
    resetToDefault: string;
    newPatientsTooltip: string;
    consultationsTooltip: string;
  }
> = {
  en: {
    trendTitle: "Patient & Consultation Trends",
    newPatients: "New Patients",
    consultations: "Consultations",
    chartType: "Chart Type",
    barChart: "Bar Chart",
    lineChart: "Line Chart",
    areaChart: "Area Chart",
    timePeriod: "Time Period",
    displayOptions: "Display Options",
    showGridLines: "Show Grid Lines",
    smoothCurve: "Smooth Curve",
    dataSeries: "Data Series",
    showNewPatients: "Show New Patients",
    showConsultations: "Show Consultations",
    resetToDefault: "Reset to Default",
    newPatientsTooltip: "new patients",
    consultationsTooltip: "consultations",
  },
  th: {
    trendTitle: "แนวโน้มผู้ป่วยและการปรึกษา",
    newPatients: "ผู้ป่วยใหม่",
    consultations: "การปรึกษา",
    chartType: "ประเภทรายงาน",
    barChart: "กราฟแท่ง",
    lineChart: "กราฟเส้น",
    areaChart: "กราฟพื้นที่",
    timePeriod: "ช่วงเวลา",
    displayOptions: "ตัวเลือกการแสดงผล",
    showGridLines: "แสดงเส้นกริด",
    smoothCurve: "เส้นโค้งแบบนุ่ม",
    dataSeries: "ชุดข้อมูล",
    showNewPatients: "แสดงผู้ป่วยใหม่",
    showConsultations: "แสดงการปรึกษา",
    resetToDefault: "รีเซ็ตค่าเริ่มต้น",
    newPatientsTooltip: "ผู้ป่วยใหม่",
    consultationsTooltip: "การปรึกษา",
  },
};

function getDataForPeriod(data: MonthlyStats[], period: TimePeriod) {
  switch (period) {
    case "3months":
      return data.slice(-3);
    case "6months":
      return data.slice(-6);
    case "q1":
      return data.slice(0, 3);
    case "q2":
      return data.slice(3, 6);
    case "q3":
      return data.slice(6, 9);
    case "q4":
      return data.slice(9, 12);
    default:
      return data;
  }
}

function localizeMonthLabel(month: string, language: AppLanguage): string {
  return MONTH_LABELS[language][month] ?? month;
}

function CustomTooltip({
  active,
  payload,
  label,
  t,
}: TooltipProps<number, string> & { t: (typeof I18N)[AppLanguage] }) {
  if (!active || !payload?.length) return null;

  const patientsData = payload.find((p) => p.dataKey === "new_patients");
  const consultationsData = payload.find((p) => p.dataKey === "consultations");
  const patients = patientsData?.value || 0;
  const consultations = consultationsData?.value || 0;

  return (
    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg min-w-[160px]">
      <p className="text-sm font-medium text-foreground mb-3">{label}</p>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-[var(--med-primary-light)]" />
            <span className="text-sm font-semibold text-foreground">
              {Number(patients)} {t.newPatientsTooltip}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-[var(--med-primary)]" />
            <span className="text-sm font-semibold text-foreground">
              {Number(consultations)} {t.consultationsTooltip}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinancialFlowChart() {
  const { theme } = useTheme();
  const token = useAuthStore((state) => state.token);
  const language = useLanguageStore((state) => state.language);
  const t = I18N[language];
  const periodLabels = PERIOD_LABELS[language];
  const [chartType, setChartType] = useState<ChartType>("area");
  const [period, setPeriod] = useState<TimePeriod>("year");
  const [showGrid, setShowGrid] = useState(true);
  const [showPatients, setShowPatients] = useState(true);
  const [showConsultations, setShowConsultations] = useState(true);
  const [smoothCurve, setSmoothCurve] = useState(true);
  const [monthlyData, setMonthlyData] = useState<MonthlyStats[]>([]);
  const [loading, setLoading] = useState(true);

  const isDark = theme === "dark";
  const axisColor = isDark ? "#71717a" : "#a1a1aa";
  const gridColor = isDark ? "#27272a" : "#e5e7eb";
  const consultationsColor = "var(--med-primary)";

  useEffect(() => {
    if (!token) return;
    fetchOverviewStats(token)
      .then((res) => setMonthlyData(res.monthly))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const chartData = getDataForPeriod(monthlyData, period).map((item) => ({
    ...item,
    month: localizeMonthLabel(item.month, language),
  }));

  const resetToDefault = () => {
    setChartType("area");
    setPeriod("year");
    setShowGrid(true);
    setShowPatients(true);
    setShowConsultations(true);
    setSmoothCurve(true);
  };

  if (loading) {
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

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Stethoscope02Icon}
            className="size-4 text-[var(--med-primary-light)]"
          />
          <span className="text-sm font-medium text-muted-foreground">
            {t.trendTitle}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-5">
          <div className="hidden items-center gap-4 sm:flex">
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-full bg-[var(--med-primary-light)]" />
                <span className="text-sm font-medium text-muted-foreground">
                {t.newPatients}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-full bg-[var(--med-primary)]" />
                <span className="text-sm font-medium text-muted-foreground">
                {t.consultations}
              </span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted">
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {t.chartType}
                </p>
                <DropdownMenuItem onClick={() => setChartType("bar")}>
                  <HugeiconsIcon icon={ChartBarLineIcon} className="size-4 mr-2" />
                  {t.barChart}
                  {chartType === "bar" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("line")}>
                  <HugeiconsIcon icon={ChartLineData01Icon} className="size-4 mr-2" />
                  {t.lineChart}
                  {chartType === "line" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("area")}>
                  <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                  {t.areaChart}
                  {chartType === "area" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={Calendar01Icon} className="size-4 mr-2" />
                  {t.timePeriod}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(periodLabels) as TimePeriod[]).map((key) => (
                    <DropdownMenuItem key={key} onClick={() => setPeriod(key)}>
                      {periodLabels[key]}
                      {period === key && (
                        <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {t.displayOptions}
                </p>
                <DropdownMenuCheckboxItem
                  checked={showGrid}
                  onCheckedChange={setShowGrid}
                >
                  <HugeiconsIcon icon={GridIcon} className="size-4 mr-2" />
                  {t.showGridLines}
                </DropdownMenuCheckboxItem>

                {(chartType === "line" || chartType === "area") && (
                  <DropdownMenuCheckboxItem
                    checked={smoothCurve}
                    onCheckedChange={setSmoothCurve}
                  >
                    <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                    {t.smoothCurve}
                  </DropdownMenuCheckboxItem>
                )}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {t.dataSeries}
                </p>
                <DropdownMenuCheckboxItem
                  checked={showPatients}
                  onCheckedChange={setShowPatients}
                >
                  <div className="size-3 rounded-full bg-[var(--med-primary-light)] mr-2" />
                  {t.showNewPatients}
                </DropdownMenuCheckboxItem>

                <DropdownMenuCheckboxItem
                  checked={showConsultations}
                  onCheckedChange={setShowConsultations}
                >
                  <div className="size-3 rounded-full bg-[var(--med-primary)] mr-2" />
                  {t.showConsultations}
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={resetToDefault}>
                <HugeiconsIcon icon={RefreshIcon} className="size-4 mr-2" />
                {t.resetToDefault}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="h-[220px] px-2 pb-4 sm:h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart data={chartData} barGap={4}>
              <defs>
                <linearGradient id="patientsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--med-primary-light)" stopOpacity={1} />
                  <stop offset="100%" stopColor="var(--med-primary-light)" stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="consultationsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={consultationsColor} stopOpacity={1} />
                  <stop offset="100%" stopColor={consultationsColor} stopOpacity={0.6} />
                </linearGradient>
              </defs>
              {showGrid && (
                <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />
              )}
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip t={t} />} cursor={{ fill: "#f4f4f5", radius: 4 }} />
              {showPatients && (
                <Bar dataKey="new_patients" fill="url(#patientsGradient)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              )}
              {showConsultations && (
                <Bar dataKey="consultations" fill="url(#consultationsGradient)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              )}
            </BarChart>
          ) : chartType === "line" ? (
            <LineChart data={chartData}>
              {showGrid && (
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={true} />
              )}
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip t={t} />} cursor={{ stroke: "#d4d4d8" }} />
              {showPatients && (
                <Line
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="new_patients"
                  stroke="var(--med-primary-light)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: "var(--med-primary-light)", stroke: "white", strokeWidth: 2 }}
                />
              )}
              {showConsultations && (
                <Line
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="consultations"
                  stroke={consultationsColor}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: consultationsColor, stroke: "white", strokeWidth: 2 }}
                />
              )}
            </LineChart>
          ) : (
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="patientsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--med-primary-light)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--med-primary-light)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="consultationsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={consultationsColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={consultationsColor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              {showGrid && (
                <CartesianGrid strokeDasharray="0" stroke={gridColor} vertical={false} />
              )}
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: axisColor, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip t={t} />} cursor={{ stroke: "#d4d4d8" }} />
              {showPatients && (
                <Area
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="new_patients"
                  stroke="var(--med-primary-light)"
                  strokeWidth={2}
                  fill="url(#patientsAreaGradient)"
                />
              )}
              {showConsultations && (
                <Area
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="consultations"
                  stroke={consultationsColor}
                  strokeWidth={2}
                  fill="url(#consultationsAreaGradient)"
                />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
