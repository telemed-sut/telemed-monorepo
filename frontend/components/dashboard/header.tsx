"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Settings, RefreshCw, Languages, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDashboardStore } from "@/store/dashboard-store";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const pageTitles: Record<AppLanguage, Record<string, string>> = {
  en: {
    "/overview": "Overview",
    "/": "Overview",
    "/patients": "Patients",
    "/users": "Users",
    "/meetings": "Meetings",
    "/audit-logs": "Audit Logs",
    "/security": "Security",
    "/device-registry": "Device Registry",
    "/profile": "Profile",
    "/settings": "Settings",
    "/device-monitor": "Device Monitor",
  },
  th: {
    "/overview": "ภาพรวม",
    "/": "ภาพรวม",
    "/patients": "ผู้ป่วย",
    "/users": "ผู้ใช้",
    "/meetings": "การนัดหมาย",
    "/audit-logs": "บันทึก Audit",
    "/security": "ความปลอดภัย",
    "/device-registry": "ทะเบียนอุปกรณ์",
    "/profile": "โปรไฟล์",
    "/settings": "ตั้งค่า",
    "/device-monitor": "มอนิเตอร์อุปกรณ์",
  },
};

const labels: Record<
  AppLanguage,
  {
    dashboard: string;
    editLayout: string;
    alertBanner: string;
    statsCards: string;
    visitTrendsChart: string;
    patientsTable: string;
    resetLayout: string;
    charts: string;
    usersTable: string;
    language: string;
  }
> = {
  en: {
    dashboard: "Dashboard",
    editLayout: "Edit Layout",
    alertBanner: "Alert Banner",
    statsCards: "Stats Cards",
    visitTrendsChart: "Visit Trends Chart",
    patientsTable: "Patients Table",
    resetLayout: "Reset Layout",
    charts: "Charts",
    usersTable: "Users Table",
    language: "Language",
  },
  th: {
    dashboard: "แดชบอร์ด",
    editLayout: "จัดวางหน้า",
    alertBanner: "แบนเนอร์แจ้งเตือน",
    statsCards: "การ์ดสถิติ",
    visitTrendsChart: "กราฟแนวโน้มการเข้ารับบริการ",
    patientsTable: "ตารางผู้ป่วย",
    resetLayout: "รีเซ็ตเลย์เอาต์",
    charts: "กราฟ",
    usersTable: "ตารางผู้ใช้",
    language: "ภาษา",
  },
};

export function DashboardHeader() {
  const pathname = usePathname();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const t = labels[language];

  // Overview layout
  const showAlertBanner = useDashboardStore((s) => s.showAlertBanner);
  const showStatsCards = useDashboardStore((s) => s.showStatsCards);
  const showChart = useDashboardStore((s) => s.showChart);
  const showTable = useDashboardStore((s) => s.showTable);
  const setShowAlertBanner = useDashboardStore((s) => s.setShowAlertBanner);
  const setShowStatsCards = useDashboardStore((s) => s.setShowStatsCards);
  const setShowChart = useDashboardStore((s) => s.setShowChart);
  const setShowTable = useDashboardStore((s) => s.setShowTable);
  const resetLayout = useDashboardStore((s) => s.resetLayout);

  // Patients layout
  const showPatientStats = useDashboardStore((s) => s.showPatientStats);
  const showPatientTable = useDashboardStore((s) => s.showPatientTable);
  const setShowPatientStats = useDashboardStore((s) => s.setShowPatientStats);
  const setShowPatientTable = useDashboardStore((s) => s.setShowPatientTable);
  const resetPatientsLayout = useDashboardStore((s) => s.resetPatientsLayout);

  // Users layout
  const showUserStats = useDashboardStore((s) => s.showUserStats);
  const showUserCharts = useDashboardStore((s) => s.showUserCharts);
  const showUserTable = useDashboardStore((s) => s.showUserTable);
  const setShowUserStats = useDashboardStore((s) => s.setShowUserStats);
  const setShowUserCharts = useDashboardStore((s) => s.setShowUserCharts);
  const setShowUserTable = useDashboardStore((s) => s.setShowUserTable);
  const resetUsersLayout = useDashboardStore((s) => s.resetUsersLayout);

  const isOverview = pathname === "/overview" || pathname === "/";
  const isPatients = pathname === "/patients";
  const isUsers = pathname === "/users";
  const hasEditLayout = isOverview || isPatients || isUsers;

  const pageTitle = pageTitles[language][pathname] || t.dashboard;
  const selectedLanguageLabel =
    APP_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    APP_LANGUAGE_OPTIONS.find((option) => option.value === "en")?.label;

  return (
    <header className="sticky top-0 z-30 flex w-full items-center gap-2 border-b bg-card px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
      <SidebarTrigger className="-ml-1 sm:-ml-2" />
      <h1 className="truncate text-lg font-medium sm:text-xl">{pageTitle}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {hasEditLayout && (
          <DropdownMenu>
            <DropdownMenuTrigger id="header-edit-layout-button" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-[0.95rem] font-medium hover:bg-accent hover:text-accent-foreground sm:h-10">
              <Settings className="size-4" />
              <span className="hidden sm:inline">{t.editLayout}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isOverview && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showAlertBanner}
                    onCheckedChange={setShowAlertBanner}
                  >
                    {t.alertBanner}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showStatsCards}
                    onCheckedChange={setShowStatsCards}
                  >
                    {t.statsCards}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showChart}
                    onCheckedChange={setShowChart}
                  >
                    {t.visitTrendsChart}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showTable}
                    onCheckedChange={setShowTable}
                  >
                    {t.patientsTable}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    {t.resetLayout}
                  </DropdownMenuItem>
                </>
              )}
              {isPatients && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showPatientStats}
                    onCheckedChange={setShowPatientStats}
                  >
                    {t.statsCards}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showPatientTable}
                    onCheckedChange={setShowPatientTable}
                  >
                    {t.patientsTable}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetPatientsLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    {t.resetLayout}
                  </DropdownMenuItem>
                </>
              )}
              {isUsers && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showUserStats}
                    onCheckedChange={setShowUserStats}
                  >
                    {t.statsCards}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUserCharts}
                    onCheckedChange={setShowUserCharts}
                  >
                    {t.charts}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUserTable}
                    onCheckedChange={setShowUserTable}
                  >
                    {t.usersTable}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetUsersLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    {t.resetLayout}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            id="header-language-button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-[0.95rem] font-medium hover:bg-accent hover:text-accent-foreground sm:h-10 sm:px-3"
          >
            <Languages className="size-4" />
            <span className="hidden sm:inline">{selectedLanguageLabel}</span>
            <span className="sm:hidden">{language.toUpperCase()}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setLanguage(option.value)}
                  className="flex items-center justify-between"
                >
                  <span>{option.label}</span>
                  {option.value === language && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
