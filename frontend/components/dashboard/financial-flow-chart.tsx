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

type ChartType = "bar" | "line" | "area";
type TimePeriod = "3months" | "6months" | "year" | "q1" | "q2" | "q3" | "q4";

const periodLabels: Record<TimePeriod, string> = {
  "3months": "Last 3 Months",
  "6months": "Last 6 Months",
  year: "Full Year",
  q1: "Q1 (Jan-Mar)",
  q2: "Q2 (Apr-Jun)",
  q3: "Q3 (Jul-Sep)",
  q4: "Q4 (Oct-Dec)",
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

function CustomTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
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
            <div className="size-2 rounded-full bg-[#7ac2f0]" />
            <span className="text-sm font-semibold text-foreground">
              {Number(patients)} new patients
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-[#5aade0]" />
            <span className="text-sm font-semibold text-foreground">
              {Number(consultations)} consultations
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
  const consultationsColor = "#5aade0";

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchOverviewStats(token)
      .then((res) => setMonthlyData(res.monthly))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const chartData = getDataForPeriod(monthlyData, period);

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
        <div className="px-5 py-4">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="h-[250px] sm:h-[280px] px-5 pb-4">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Stethoscope02Icon}
            className="size-5 text-[#7ac2f0]"
          />
          <span className="font-medium text-muted-foreground">
            Patient &amp; Consultation Trends
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="hidden sm:flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-full bg-[#7ac2f0]" />
              <span className="text-xs font-medium text-muted-foreground">
                New Patients
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded-full bg-[#5aade0]" />
              <span className="text-xs font-medium text-muted-foreground">
                Consultations
              </span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center size-8 rounded-md hover:bg-muted">
              <HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                  Chart Type
                </p>
                <DropdownMenuItem onClick={() => setChartType("bar")}>
                  <HugeiconsIcon icon={ChartBarLineIcon} className="size-4 mr-2" />
                  Bar Chart
                  {chartType === "bar" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("line")}>
                  <HugeiconsIcon icon={ChartLineData01Icon} className="size-4 mr-2" />
                  Line Chart
                  {chartType === "line" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("area")}>
                  <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                  Area Chart
                  {chartType === "area" && (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HugeiconsIcon icon={Calendar01Icon} className="size-4 mr-2" />
                  Time Period
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
                <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                  Display Options
                </p>
                <DropdownMenuCheckboxItem
                  checked={showGrid}
                  onCheckedChange={setShowGrid}
                >
                  <HugeiconsIcon icon={GridIcon} className="size-4 mr-2" />
                  Show Grid Lines
                </DropdownMenuCheckboxItem>

                {(chartType === "line" || chartType === "area") && (
                  <DropdownMenuCheckboxItem
                    checked={smoothCurve}
                    onCheckedChange={setSmoothCurve}
                  >
                    <HugeiconsIcon icon={ChartAverageIcon} className="size-4 mr-2" />
                    Smooth Curve
                  </DropdownMenuCheckboxItem>
                )}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                  Data Series
                </p>
                <DropdownMenuCheckboxItem
                  checked={showPatients}
                  onCheckedChange={setShowPatients}
                >
                  <div className="size-3 rounded-full bg-[#7ac2f0] mr-2" />
                  Show New Patients
                </DropdownMenuCheckboxItem>

                <DropdownMenuCheckboxItem
                  checked={showConsultations}
                  onCheckedChange={setShowConsultations}
                >
                  <div className="size-3 rounded-full bg-[#5aade0] mr-2" />
                  Show Consultations
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={resetToDefault}>
                <HugeiconsIcon icon={RefreshIcon} className="size-4 mr-2" />
                Reset to Default
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="h-[250px] sm:h-[280px] px-2 pb-4">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart data={chartData} barGap={4}>
              <defs>
                <linearGradient id="patientsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7ac2f0" stopOpacity={1} />
                  <stop offset="100%" stopColor="#7ac2f0" stopOpacity={0.6} />
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
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f4f4f5", radius: 4 }} />
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
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#d4d4d8" }} />
              {showPatients && (
                <Line
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="new_patients"
                  stroke="#7ac2f0"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: "#7ac2f0", stroke: "white", strokeWidth: 2 }}
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
                  <stop offset="0%" stopColor="#7ac2f0" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#7ac2f0" stopOpacity={0.05} />
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
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#d4d4d8" }} />
              {showPatients && (
                <Area
                  type={smoothCurve ? "monotone" : "linear"}
                  dataKey="new_patients"
                  stroke="#7ac2f0"
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
