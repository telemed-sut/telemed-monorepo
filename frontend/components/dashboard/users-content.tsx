"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { useDashboardStore } from "@/store/dashboard-store";
import { UsersTable } from "./users-table";
import { Button } from "@/components/ui/button";
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
  type User,
  type UserMe,
  ROLE_LABEL_MAP,
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
import { useTheme } from "next-themes";

// ── Welcome Section ──
function WelcomeSection({
  users,
  currentUser,
}: {
  users: User[];
  currentUser: UserMe | null;
}) {
  const active = users.filter((u) => u.is_active).length;
  const pending = users.filter(
    (u) => u.verification_status === "pending"
  ).length;
  const firstName = currentUser?.first_name || "Admin";

  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
      <div className="space-y-2 sm:space-y-5">
        <h2 className="text-lg sm:text-[22px] font-semibold leading-relaxed">
          Welcome Back, {firstName}!
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground">
          You have{" "}
          <span className="text-foreground font-medium">
            {active} active users
          </span>
          ,{" "}
          <span className="text-foreground font-medium">
            {pending} pending verification
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground px-3 text-xs sm:text-sm font-medium h-8 sm:h-9 gap-2 sm:gap-3">
            <span className="hidden xs:inline">Import/Export</span>
            <span className="xs:hidden">
              <Download className="size-4" />
            </span>
            <ChevronDown className="size-3 sm:size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Upload className="size-4 mr-2" />
              Import CSV
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Upload className="size-4 mr-2" />
              Import Excel
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Download className="size-4 mr-2" />
              Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileText className="size-4 mr-2" />
              Export PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          className="gap-2 sm:gap-3 h-8 sm:h-9 text-xs sm:text-sm bg-linear-to-b from-foreground to-foreground/90 text-background"
        >
          <Plus className="size-3 sm:size-4" />
          <span className="hidden xs:inline">Create New</span>
          <span className="xs:hidden">New</span>
        </Button>
      </div>
    </div>
  );
}

// ── Stats Cards ──
function UserStatsCards({ users }: { users: User[] }) {
  const total = users.length;
  const active = users.filter((u) => u.is_active).length;
  const admins = users.filter((u) => u.role === "admin").length;
  const doctors = users.filter((u) => u.role === "doctor").length;

  const stats = [
    {
      title: "Total Users",
      value: total,
      change: `+${total}`,
      changeValue: "",
      isPositive: true,
      icon: Users,
    },
    {
      title: "Active Users",
      value: active,
      change: `+${total > 0 ? Math.round((active / total) * 100) : 0}%`,
      changeValue: `(${active})`,
      isPositive: active > 0,
      icon: UserCheck,
    },
    {
      title: "Administrators",
      value: admins,
      change: `${admins}`,
      changeValue: "accounts",
      isPositive: true,
      icon: ShieldCheck,
    },
    {
      title: "Doctors",
      value: doctors,
      change: `${doctors}`,
      changeValue: "accounts",
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
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium truncate">
                {stat.title}
              </span>
            </div>
            <p className="text-lg sm:text-xl lg:text-[28px] font-semibold leading-tight tracking-tight">
              {stat.value}
            </p>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs lg:text-sm font-medium">
              <span
                className={
                  stat.isPositive ? "text-emerald-600" : "text-red-600"
                }
              >
                {stat.change}
                <span className="hidden sm:inline"> {stat.changeValue}</span>
              </span>
              <span className="text-muted-foreground hidden sm:inline">
                vs Last Months
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
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg p-2 sm:p-3 shadow-lg">
      <p className="text-xs sm:text-sm font-medium text-foreground mb-1.5 sm:mb-2">
        {label}
      </p>
      <div className="space-y-1 sm:space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className="size-2 sm:size-2.5 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="text-[10px] sm:text-sm text-muted-foreground">
              {entry.name}:
            </span>
            <span className="text-[10px] sm:text-sm font-medium text-foreground">
              {entry.value} users
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

const periodLabels: Record<TimePeriod, string> = {
  "3months": "Last 3 Months",
  "6months": "Last 6 Months",
  year: "Full Year",
};

function MonthlyUserGrowthChart({ users }: { users: User[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const axisColor = isDark ? "#71717a" : "#a1a1aa";
  const gridColor = isDark ? "#27272a" : "#f4f4f5";

  const [chartType, setChartType] = useState<ChartType>("bar");
  const [period, setPeriod] = useState<TimePeriod>("6months");
  const [showGrid, setShowGrid] = useState(true);
  const [currentInsight, setCurrentInsight] = useState(0);

  const fullYearData = useMemo(() => {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
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
  }, [users]);

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
      `${bestMonth.month} had the highest registrations with ${bestMonth.users} users`,
      `Total of ${totalUsers} users registered in ${periodLabels[period].toLowerCase()}`,
      `Average ${(totalUsers / (chartData.length || 1)).toFixed(1)} users per month`,
    ],
    [bestMonth, totalUsers, period, chartData.length]
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
            User Growth
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-1.5">
            <div className="size-2.5 sm:size-3 rounded-full bg-[#7ac2f0]" />
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              This Year
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
                  Bar Chart
                  {chartType === "bar" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("line")}>
                  <LineChartIcon className="size-4 mr-2" />
                  Line Chart
                  {chartType === "line" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartType("area")}>
                  <TrendingUp className="size-4 mr-2" />
                  Area Chart
                  {chartType === "area" && (
                    <Check className="size-4 ml-auto" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Calendar className="size-4 mr-2" />
                Time Period
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
              Show Grid Lines
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
              Reset to Default
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
            <p className="text-xs sm:text-sm text-muted-foreground">
              Total Registrations ({periodLabels[period]})
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 sm:p-4 space-y-3 sm:space-y-4">
            <p className="text-xs sm:text-sm font-semibold">
              🏆 Best Performing Month
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">
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
                {insights.map((_, index) => (
                  <div
                    key={index}
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
                      stopColor="#7ac2f0"
                      stopOpacity={1}
                    />
                    <stop
                      offset="100%"
                      stopColor="#7ac2f0"
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
                  content={<CustomTooltip />}
                  cursor={{
                    fill: isDark ? "#27272a" : "#f4f4f5",
                    radius: 4,
                  }}
                />
                <Bar
                  dataKey="users"
                  name="Users"
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
                  content={<CustomTooltip />}
                  cursor={{
                    stroke: isDark ? "#52525b" : "#d4d4d8",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="users"
                  name="Users"
                  stroke="#7ac2f0"
                  strokeWidth={2}
                  dot={{ fill: "#7ac2f0", strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: "#7ac2f0" }}
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
                      stopColor="#7ac2f0"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor="#7ac2f0"
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
                  content={<CustomTooltip />}
                  cursor={{
                    stroke: isDark ? "#52525b" : "#d4d4d8",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  name="Users"
                  stroke="#7ac2f0"
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
function UsersByRoleChart({ users }: { users: User[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const roleData = useMemo(() => {
    const counts: Record<string, number> = {};
    users.forEach((u) => {
      counts[u.role] = (counts[u.role] || 0) + 1;
    });
    const colors: Record<string, string> = {
      admin: "#7ac2f0",
      doctor: "#5aade0",
      staff: "#3d98d0",
      nurse: "#2d88c0",
      pharmacist: "#a855f7",
      medical_technologist: "#06b6d4",
      psychologist: "#ec4899",
    };
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([role, count]) => ({
        name:
          ROLE_LABEL_MAP[role] ||
          role.charAt(0).toUpperCase() + role.slice(1),
        value: count,
        color: colors[role] || "#7ac2f0",
      }));
  }, [users]);

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
            Users by Role
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center size-7 sm:size-8 rounded-md hover:bg-muted">
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuItem>
              <Download className="size-4 mr-2" />
              Export as PNG
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
                {roleData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-lg sm:text-xl font-semibold">
              {totalUsers}
            </span>
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              Total Users
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
              <span className="flex-1 text-xs sm:text-sm text-muted-foreground truncate">
                {item.name}
              </span>
              <span className="text-xs sm:text-sm font-semibold tabular-nums">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Settings2 className="size-3" />
        <span>All registered users</span>
      </div>
    </div>
  );
}

// ── Main Content ──
export function UsersContent() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);

  const showUserStats = useDashboardStore((s) => s.showUserStats);
  const showUserCharts = useDashboardStore((s) => s.showUserCharts);
  const showUserTable = useDashboardStore((s) => s.showUserTable);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    if (!token) return;
    fetchUsers({ page: 1, limit: 100 }, token)
      .then((res) => setUsers(res.items))
      .catch((err) => {
        if ((err as { status?: number }).status === 401) {
          clearToken();
          router.replace("/login");
        }
      });
    fetchCurrentUser(token)
      .then((me) => setCurrentUser(me))
      .catch(() => {});
  }, [token, clearToken, router]);

  if (!hydrated || !token) {
    return null;
  }

  return (
    <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 bg-background w-full">
      <WelcomeSection users={users} currentUser={currentUser} />
      {showUserStats && <UserStatsCards users={users} />}
      {showUserCharts && (
        <div className="flex flex-col xl:flex-row gap-4 sm:gap-6">
          <MonthlyUserGrowthChart users={users} />
          <UsersByRoleChart users={users} />
        </div>
      )}
      {showUserTable && <UsersTable />}
    </main>
  );
}
