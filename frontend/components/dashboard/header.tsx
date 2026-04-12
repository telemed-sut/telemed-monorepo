"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Check, Languages, LayoutTemplate, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDashboardPageTitle } from "@/components/dashboard/dashboard-route-utils";
import { useDashboardStore } from "@/store/dashboard-store";
import {
  APP_LANGUAGE_OPTIONS,
  type AppLanguage,
} from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const HEADER_LANGUAGE_BUTTON_ID = "header-language-button";

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
  const selectedLanguageLabel =
    APP_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    APP_LANGUAGE_OPTIONS.find((option) => option.value === "en")?.label;

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

  const pageTitle = getDashboardPageTitle(pathname, language);

  return (
    <header className="flex w-full items-center gap-3 border-b border-slate-200/70 bg-white/85 px-3 py-3 sm:px-6">
      <SidebarTrigger className="-ml-1 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:bg-slate-50 sm:-ml-2" />

      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-slate-900 sm:text-[1.05rem]">
          {pageTitle}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            id={HEADER_LANGUAGE_BUTTON_ID}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 text-[0.92rem] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] outline-none transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-[3px] focus-visible:ring-sky-200 focus-visible:ring-offset-2"
            type="button"
          >
            <Languages className="size-4" />
            <span className="hidden md:inline">{selectedLanguageLabel}</span>
            <span className="md:hidden">{language.toUpperCase()}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
            <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {APP_LANGUAGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="flex items-center justify-between"
                onClick={() => setLanguage(option.value)}
              >
                <span>{option.label}</span>
                {option.value === language && (
                  <Check className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasEditLayout && (
          <DropdownMenu>
            <DropdownMenuTrigger
              id="header-edit-layout-button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-1.5 text-[0.95rem] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <LayoutTemplate className="size-4" />
              <span>{t.editLayout}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
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
      </div>
    </header>
  );
}
