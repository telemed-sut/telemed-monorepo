"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { useDashboardStore } from "@/store/dashboard-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  UserCheck,
  ShieldCheck,
  Flame,
  ChevronDown,
  Plus,
  Download,
  Upload,
  FileText,
  BarChart2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  LineChartIcon,
  TrendingUp,
  Calendar,
  Grid3X3,
  RefreshCw,
  Check,
  Settings2,
} from "lucide-react";
import {
  fetchUsers,
  fetchCurrentUser,
  getRoleLabel,
  type User,
  type UserMe,
} from "@/lib/api";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
  PieChart,
  Pie,
  Cell,
  Sector,
} from "recharts";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const UsersTable = dynamic(
  () => import("./users-table").then((mod) => mod.UsersTable),
  {
    loading: () => (
      <section className="rounded-[28px] border border-slate-200/80 bg-white/95 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="space-y-3">
          <Skeleton className="h-6 w-44 rounded-full" />
          <Skeleton className="h-4 w-72 rounded-full" />
          <Skeleton className="h-[620px] rounded-[24px]" />
        </div>
      </section>
    ),
  }
);

function tr(language: AppLanguage, en: string, th: string): string {
  return language === "th" ? th : en;
}

const USER_REGISTRATION_SIGNAL_KEY = "telemed:user-registered";
const USER_REGISTRATION_CHANNEL = "telemed-user-events";

type UsersStreamEvent = {
  type?: string;
};

function parseSseEvent(rawEvent: string): { event: string; data: UsersStreamEvent | null } {
  const lines = rawEvent.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataLines.join("\n");
  if (!dataText) {
    return { event, data: null };
  }

  try {
    return { event, data: JSON.parse(dataText) as UsersStreamEvent };
  } catch {
    return { event, data: null };
  }
}

function shouldSendBearer(token: string | null): boolean {
  return Boolean(token && token.split(".").length === 3);
}

// ── Welcome Section ──
function WelcomeSection({
  users,
  currentUser,
  language,
  onCreateInvite,
}: {
  users: User[];
  currentUser: UserMe | null;
  language: AppLanguage;
  onCreateInvite: () => void;
}) {
  const active = users.filter((u) => u.is_active).length;
  const pending = users.filter(
    (u) => u.verification_status === "pending"
  ).length;
  const firstName = currentUser?.first_name || tr(language, "Admin", "ผู้ดูแล");

  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
      <div className="space-y-2 sm:space-y-5">
        <h2 className="text-lg sm:text-[22px] font-semibold leading-relaxed">
          {tr(language, "Welcome Back", "ยินดีต้อนรับกลับ")}, {firstName}!
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          {tr(language, "You have", "คุณมี")}{" "}
          <span className="text-foreground font-medium">
            {active} {tr(language, "active users", "ผู้ใช้ที่ใช้งานอยู่")}
          </span>
          {language === "th" ? " และ" : ","}{" "}
          <span className="text-foreground font-medium">
            {pending} {tr(language, "pending verification", "รอยืนยันตัวตน")}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground px-3 text-sm font-medium h-9 gap-2 sm:gap-3">
            <span className="hidden xs:inline">{tr(language, "Import/Export", "นำเข้า/ส่งออก")}</span>
            <span className="xs:hidden">
              <Download className="size-4" />
            </span>
            <ChevronDown className="size-3 sm:size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Upload className="size-4 mr-2" />
              {tr(language, "Import CSV", "นำเข้า CSV")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Upload className="size-4 mr-2" />
              {tr(language, "Import Excel", "นำเข้า Excel")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Download className="size-4 mr-2" />
              {tr(language, "Export CSV", "ส่งออก CSV")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileText className="size-4 mr-2" />
              {tr(language, "Export PDF", "ส่งออก PDF")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          className="h-9 gap-2 sm:gap-3 text-sm bg-linear-to-b from-foreground to-foreground/90 text-background"
          onClick={onCreateInvite}
        >
          <Plus className="size-3 sm:size-4" />
          <span className="hidden xs:inline">{tr(language, "Create New", "สร้างใหม่")}</span>
          <span className="xs:hidden">{tr(language, "New", "ใหม่")}</span>
        </Button>
      </div>
    </div>
  );
}

// ── Stats Cards ──
function UserStatsCards({ users, language }: { users: User[]; language: AppLanguage }) {
  const total = users.length;
  const active = users.filter((u) => u.is_active).length;
  const admins = users.filter((u) => u.role === "admin").length;
  const doctors = users.filter((u) => u.role === "doctor").length;

  const stats = [
    {
      title: tr(language, "Total Users", "ผู้ใช้ทั้งหมด"),
      value: total,
      change: `+${total}`,
      changeValue: "",
      isPositive: true,
      icon: Users,
    },
    {
      title: tr(language, "Active Users", "ผู้ใช้ที่ใช้งานอยู่"),
      value: active,
      change: `+${total > 0 ? Math.round((active / total) * 100) : 0}%`,
      changeValue: `(${active})`,
      isPositive: active > 0,
      icon: UserCheck,
    },
    {
      title: tr(language, "Administrators", "ผู้ดูแลระบบ"),
      value: admins,
      change: `${admins}`,
      changeValue: tr(language, "accounts", "บัญชี"),
      isPositive: true,
      icon: ShieldCheck,
    },
    {
      title: tr(language, "Doctors", "แพทย์"),
      value: doctors,
      change: `${doctors}`,
      changeValue: tr(language, "accounts", "บัญชี"),
      isPositive: true,
      icon: Flame,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 p-3 sm:p-4 lg:p-6 rounded-xl border bg-card">
      {stats.map((stat, index) => (
        <div key={stat.title} className="flex items-start">
          <div className="flex-1 space-y-2 sm:space-y-4 lg:space-y-6">
            <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground">
              <stat.icon className="size-3.5 sm:size-[18px]" />
              <span className="text-xs sm:text-sm font-medium truncate">
                {stat.title}
              </span>
            </div>
            <p className="text-lg sm:text-xl lg:text-[28px] font-semibold leading-tight tracking-tight">
              {stat.value}
            </p>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium">
              <span
                className={
                  stat.isPositive ? "text-emerald-600" : "text-red-600"
                }
              >
                {stat.change}
                <span className="hidden sm:inline"> {stat.changeValue}</span>
              </span>
              <span className="text-muted-foreground hidden sm:inline">
                {tr(language, "vs Last Months", "เทียบเดือนก่อน")}
              </span>
            </div>
          </div>
          {index < stats.length - 1 && (
            <div className="hidden lg:block w-px h-full bg-border mx-4 xl:mx-6" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Custom Tooltip ──
function CustomTooltip({
  active,
  payload,
  label,
  language,
}: TooltipProps<number, string> & { language: AppLanguage }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg p-2 sm:p-3 shadow-lg">
      <p className="mb-1.5 text-sm font-medium text-foreground sm:mb-2">
        {label}
      </p>
      <div className="space-y-1 sm:space-y-1.5">
        {payload.map((entry) => (
          <div key={`${entry.name ?? "metric"}-${entry.dataKey ?? "value"}-${entry.color ?? "default"}`} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className="size-2 sm:size-2.5 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="text-xs sm:text-sm text-muted-foreground">
              {entry.name}:
            </span>
            <span className="text-xs sm:text-sm font-medium text-foreground">
              {entry.value} {tr(language, "users", "ผู้ใช้")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Monthly User Growth Chart (Revenue Flow style) ──
type ChartType = "bar" | "line" | "area";
type TimePeriod = "3months" | "6months" | "year";

function MonthlyUserGrowthChart({ users, language }: { users: User[]; language: AppLanguage }) {
  const periodLabels = useMemo<Record<TimePeriod, string>>(
    () => ({
      "3months": tr(language, "Last 3 Months", "3 เดือนล่าสุด"),
      "6months": tr(language, "Last 6 Months", "6 เดือนล่าสุด"),
      year: tr(language, "Full Year", "ทั้งปี"),
    }),
    [language]
  );
  const axisColor = "var(--muted-foreground)";
  const gridColor = "var(--border)";

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [period, setPeriod] = useState<TimePeriod>("6months");
  const [showGrid, setShowGrid] = useState(true);
  const [currentInsight, setCurrentInsight] = useState(0);

  const fullYearData = useMemo(() => {
    const monthFormatter = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
      month: "short",
    });
    const months = Array.from({ length: 12 }, (_, monthIndex) =>
      monthFormatter.format(new Date(2026, monthIndex, 1))
    );
    const counts: Record<number, number> = {};
    const currentYear = new Date().getFullYear();
    users.forEach((u) => {
      if (!u.created_at) return;
      const d = new Date(u.created_at);
      if (d.getFullYear() === currentYear) {
        const m = d.getMonth();
        counts[m] = (counts[m] || 0) + 1;
      }
    });
    return months.map((month, i) => ({ month, users: counts[i] || 0 }));
  }, [users, language]);

  const chartData = useMemo(() => {
    switch (period) {
      case "3months":
        return fullYearData.slice(-3);
      case "6months":
        return fullYearData.slice(0, 6);
      default:
        return fullYearData;
    }
  }, [fullYearData, period]);

  const totalUsers = chartData.reduce((acc, item) => acc + item.users, 0);
  const bestMonth = chartData.reduce(
    (best, item) => (item.users > best.users ? item : best),
    chartData[0] || { month: "-", users: 0 }
  );

  const insights = useMemo(
    () => [
      tr(
        language,
        `${bestMonth.month} had the highest registrations with ${bestMonth.users} users`,
        `${bestMonth.month} มีการลงทะเบียนสูงสุด ${bestMonth.users} คน`
      ),
      tr(
        language,
        `Total of ${totalUsers} users registered in ${periodLabels[period].toLowerCase()}`,
        `มีผู้ลงทะเบียนรวม ${totalUsers} คน ในช่วง${periodLabels[period]}`
      ),
      tr(
        language,
        `Average ${(totalUsers / (chartData.length || 1)).toFixed(1)} users per month`,
        `เฉลี่ย ${(totalUsers / (chartData.length || 1)).toFixed(1)} คนต่อเดือน`
      ),
    ],
    [bestMonth, totalUsers, period, chartData.length, periodLabels, language]
  );

  return (
    <div className="flex-1 flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 rounded-xl border bg-card min-w-0">
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-2.5 flex-1">
          <Button
            variant="outline"
            size="icon"
            className="size-7 sm:size-8"
          >
            <BarChart2 className="size-4 sm:size-[18px] text-muted-foreground" />
          </Button>
            <span className="text-sm sm:text-base font-medium">
            {tr(language, "User Growth", "การเติบโตของผู้ใช้")}
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 sm:size-3 rounded-full bg-[var(--med-primary-light)]" />
            <span className="text-xs text-muted-foreground sm:text-sm">
              {tr(language, "This Year", "ปีนี้")}
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
                  {tr(language, "Bar Chart", "กราฟแท่ง")}
                  {chartType === "bar" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("line")}>
                  <LineChartIcon className="size-4 mr-2" />
                  {tr(language, "Line Chart", "กราฟเส้น")}
                  {chartType === "line" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("area")}>
                  <TrendingUp className="size-4 mr-2" />
                  {tr(language, "Area Chart", "กราฟพื้นที่")}
                  {chartType === "area" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Calendar className="size-4 mr-2" />
                {tr(language, "Time Period", "ช่วงเวลา")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(Object.keys(periodLabels) as TimePeriod[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => setPeriod(key)}
                  >
                    {periodLabels[key]}
                    {period === key && (
                      <Check className="size-4 ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showGrid}
              onCheckedChange={setShowGrid}
            >
              <Grid3X3 className="size-4 mr-2" />
              {tr(language, "Show Grid Lines", "แสดงเส้นกริด")}
            </DropdownMenuCheckboxItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setChartType("bar");
                setPeriod("6months");
                setShowGrid(true);
              }}
            >
              <RefreshCw className="size-4 mr-2" />
              {tr(language, "Reset to Default", "รีเซ็ตค่าเริ่มต้น")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-10 flex-1 min-h-0">
        <div className="flex flex-col gap-4 w-full lg:w-[200px] xl:w-[220px] shrink-0">
          <div className="space-y-2 sm:space-y-4">
            <p className="text-xl sm:text-2xl lg:text-[28px] font-semibold leading-tight tracking-tight">
              {totalUsers}
            </p>
            <p className="text-sm text-muted-foreground">
              {tr(language, "Total Registrations", "ผู้ลงทะเบียนรวม")} ({periodLabels[period]})
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 sm:p-4 space-y-3 sm:space-y-4">
            <p className="text-sm font-semibold">
              🏆 {tr(language, "Best Performing Month", "เดือนที่ผลงานดีที่สุด")}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {insights[currentInsight]}
            </p>
            <div className="flex items-center gap-2.5 sm:gap-3.5">
              <ChevronLeft
                className="size-3 sm:size-3.5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                onClick={() =>
                  setCurrentInsight((prev) =>
                    prev === 0 ? insights.length - 1 : prev - 1
                  )
                }
              />
              <div className="flex-1 flex items-center gap-1">
                {insights.map((insight, index) => (
                  <div
                    key={insight}
                    className={`flex-1 h-0.5 rounded-full transition-colors ${
                      index === currentInsight
                        ? "bg-foreground"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <ChevronRight
                className="size-3 sm:size-3.5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                onClick={() =>
                  setCurrentInsight((prev) =>
                    prev === insights.length - 1 ? 0 : prev + 1
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="flex-1 h-[180px] sm:h-[200px] lg:h-[240px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart data={chartData}>
                <defs>
                  <linearGradient
                    id="userBarGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--med-primary-light)"
                      stopOpacity={1}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--med-primary-light)"
                      stopOpacity={0.6}
                    />
                  </linearGradient>
                </defs>
                {showGrid && (
                  <CartesianGrid
                    strokeDasharray="0"
                    stroke={gridColor}
                    vertical={false}
                  />
                )}
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dx={-5}
                  width={40}
                />
                <Tooltip
                  content={<CustomTooltip language={language} />}
                  cursor={{
                    fill: "var(--med-primary-light)",
                    fillOpacity: 0.18,
                    stroke: "var(--med-primary)",
                    strokeOpacity: 0.2,
                    radius: 4,
                  }}
                />
                <Bar
                  dataKey="users"
                  name={tr(language, "Users", "ผู้ใช้")}
                  fill="url(#userBarGrad)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                />
              </BarChart>
            ) : chartType === "line" ? (
              <LineChart data={chartData}>
                {showGrid && (
                  <CartesianGrid
                    strokeDasharray="0"
                    stroke={gridColor}
                    vertical={false}
                  />
                )}
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dx={-5}
                  width={40}
                />
                <Tooltip
                  content={<CustomTooltip language={language} />}
                  cursor={{
                    stroke: "var(--med-primary)",
                    strokeOpacity: 0.28,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="users"
                  name={tr(language, "Users", "ผู้ใช้")}
                  stroke="var(--med-primary-light)"
                  strokeWidth={2}
                  dot={{ fill: "var(--med-primary-light)", strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: "var(--med-primary-light)" }}
                />
              </LineChart>
            ) : (
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient
                    id="userAreaGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--med-primary-light)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--med-primary-light)"
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                {showGrid && (
                  <CartesianGrid
                    strokeDasharray="0"
                    stroke={gridColor}
                    vertical={false}
                  />
                )}
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: axisColor, fontSize: 10 }}
                  dx={-5}
                  width={40}
                />
                <Tooltip
                  content={<CustomTooltip language={language} />}
                  cursor={{
                    stroke: "var(--med-primary)",
                    strokeOpacity: 0.28,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  name={tr(language, "Users", "ผู้ใช้")}
                  stroke="var(--med-primary-light)"
                  strokeWidth={2}
                  fill="url(#userAreaGrad)"
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Users by Role Chart (Donut/Pie — Lead Sources style) ──
function UsersByRoleChart({ users, language }: { users: User[]; language: AppLanguage }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const roleData = useMemo(() => {
    const counts: Record<string, number> = {};
    users.forEach((u) => {
      counts[u.role] = (counts[u.role] || 0) + 1;
    });
    const colors: Record<string, string> = {
      admin: "var(--med-primary-light)",
      doctor: "var(--med-primary)",
      medical_student: "#8b5cf6",
    };
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([role, count]) => ({
        name: getRoleLabel(role, language),
        value: count,
        color: colors[role] || "var(--med-primary-light)",
      }));
  }, [users, language]);

  const totalUsers = roleData.reduce((acc, item) => acc + item.value, 0);

  const onPieEnter = (_: unknown, index: number) => {
    setActiveIndex(index);
  };
  const onPieLeave = () => {
    setActiveIndex(null);
  };

  const renderActiveShape = (props: unknown) => {
    const typedProps = props as {
      cx: number;
      cy: number;
      innerRadius: number;
      outerRadius: number;
      startAngle: number;
      endAngle: number;
      fill: string;
    };
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } =
      typedProps;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 8}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 rounded-xl border bg-card w-full xl:w-[410px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <Button
            variant="outline"
            size="icon"
            className="size-7 sm:size-8"
          >
            <ShieldCheck className="size-4 sm:size-[18px] text-muted-foreground" />
          </Button>
          <span className="text-sm sm:text-base font-medium">
            {tr(language, "Users by Role", "ผู้ใช้ตามบทบาท")}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center size-7 sm:size-8 rounded-md hover:bg-muted">
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuItem>
              <Download className="size-4 mr-2" />
              {tr(language, "Export as PNG", "ส่งออกเป็น PNG")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        <div className="relative shrink-0 size-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={roleData}
                cx="50%"
                cy="50%"
                innerRadius="42%"
                outerRadius="70%"
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
                activeIndex={
                  activeIndex !== null ? activeIndex : undefined
                }
                activeShape={renderActiveShape}
                onMouseEnter={onPieEnter}
                onMouseLeave={onPieLeave}
              >
                {roleData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg sm:text-xl font-semibold">
              {totalUsers}
            </span>
            <span className="text-xs text-muted-foreground sm:text-sm">
              {tr(language, "Total Users", "ผู้ใช้ทั้งหมด")}
            </span>
          </div>
        </div>

        <div className="flex-1 w-full grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-4">
          {roleData.map((item, index) => (
            <div
              key={item.name}
              className={`flex items-center gap-2 sm:gap-2.5 cursor-pointer transition-opacity ${
                activeIndex !== null && activeIndex !== index
                  ? "opacity-50"
                  : ""
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <div
                className="w-1 h-4 sm:h-5 rounded-sm shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="flex-1 truncate text-sm text-muted-foreground">
                {item.name}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Settings2 className="size-3" />
        <span>{tr(language, "All registered users", "ผู้ใช้ที่ลงทะเบียนทั้งหมด")}</span>
      </div>
    </div>
  );
}

// ── Main Content ──
export function UsersContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const authCurrentUser = useAuthStore((state) => state.currentUser);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const setAuthCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const language = useLanguageStore((state) => state.language);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [tableSeedVersion, setTableSeedVersion] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inviteRequestKey, setInviteRequestKey] = useState(0);

  const showUserStats = useDashboardStore((s) => s.showUserStats);
  const showUserCharts = useDashboardStore((s) => s.showUserCharts);
  const showUserTable = useDashboardStore((s) => s.showUserTable);
  const initialTableUsers = useMemo(() => users.slice(0, 10), [users]);
  const initialTableTotal = users.length;

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token || !userId) {
      setCurrentUser(null);
      return;
    }

    if (!authCurrentUser || authCurrentUser.id !== userId) {
      setCurrentUser(null);
      return;
    }

    setCurrentUser(authCurrentUser);
  }, [authCurrentUser, hydrated, token, userId]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const triggerCreateInvite = useCallback(() => {
    setInviteRequestKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleRefreshSignal = () => {
      triggerRefresh();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== USER_REGISTRATION_SIGNAL_KEY || !event.newValue) return;
      handleRefreshSignal();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleRefreshSignal();
      }
    };

    window.addEventListener("focus", handleRefreshSignal);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let channel: BroadcastChannel | null = null;
    if (typeof window.BroadcastChannel !== "undefined") {
      channel = new window.BroadcastChannel(USER_REGISTRATION_CHANNEL);
      channel.addEventListener("message", handleRefreshSignal);
    }

    return () => {
      window.removeEventListener("focus", handleRefreshSignal);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      channel?.removeEventListener("message", handleRefreshSignal);
      channel?.close();
    };
  }, [triggerRefresh]);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;

    const loadUsersForDashboard = async () => {
      const pageSize = 100;
      let page = 1;
      let total = 0;
      const allUsers: User[] = [];

      do {
        const res = await fetchUsers({ page, limit: pageSize, skipCache: true }, token);
        allUsers.push(...res.items);
        total = res.total;
        page += 1;
      } while (allUsers.length < total);

      if (!cancelled) {
        setUsers(allUsers);
        setUsersLoaded(true);
        setTableSeedVersion((prev) => prev + 1);
      }
    };

    void loadUsersForDashboard().catch((err) => {
      if (!cancelled) {
        setUsersLoaded(true);
      }
      if ((err as { status?: number }).status === 401) {
        clearToken();
        router.replace("/login");
      }
    });

    void fetchCurrentUser(token)
      .then((me) => {
        if (!cancelled && me.id === userId) {
          setAuthCurrentUser(me);
          setCurrentUser(me);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [token, userId, clearToken, router, refreshKey, setAuthCurrentUser]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let retryDelay = 1000;
    let retryTimeoutId: number | null = null;
    let controller: AbortController | null = null;

    const scheduleReconnect = () => {
      if (!active) return;
      if (retryTimeoutId) {
        window.clearTimeout(retryTimeoutId);
      }
      retryTimeoutId = window.setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 30000);
        void connect();
      }, retryDelay);
    };

    const connect = async () => {
      if (!active) return;
      controller?.abort();
      controller = new AbortController();

      const headers: HeadersInit = {};
      if (shouldSendBearer(token)) {
        headers.Authorization = `Bearer ${token}`;
      }

      try {
        const res = await fetch("/api/events/users", {
          method: "GET",
          headers,
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            return;
          }
          throw new Error(`SSE connection failed (${res.status})`);
        }

        if (!res.body) {
          throw new Error("SSE connection closed");
        }

        retryDelay = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            if (!rawEvent) continue;
            const parsed = parseSseEvent(rawEvent);
            if (parsed.event === "user.registered") {
              triggerRefresh();
            }
          }
        }
      } catch {
        if (!active) return;
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      active = false;
      if (retryTimeoutId) {
        window.clearTimeout(retryTimeoutId);
      }
      controller?.abort();
    };
  }, [token, triggerRefresh]);

  if (!hydrated || !token) {
    return null;
  }

  return (
    <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
      <WelcomeSection
        users={users}
        currentUser={currentUser}
        language={language}
        onCreateInvite={triggerCreateInvite}
      />
      {showUserStats && <UserStatsCards users={users} language={language} />}
      {showUserCharts && (
        <div className="flex flex-col xl:flex-row gap-4 sm:gap-6">
          <MonthlyUserGrowthChart users={users} language={language} />
          <UsersByRoleChart users={users} language={language} />
        </div>
      )}
      {showUserTable && (
        <UsersTable
          refreshKey={refreshKey}
          inviteRequestKey={inviteRequestKey}
          initialUsers={initialTableUsers}
          initialTotal={initialTableTotal}
          initialSeedKey={tableSeedVersion}
          initialSeedReady={usersLoaded}
          onUsersMutated={triggerRefresh}
        />
      )}
    </main>
  );
}
