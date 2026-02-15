"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { NovuInbox } from "@/components/dashboard/novu-inbox";
import { Settings, RefreshCw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDashboardStore } from "@/store/dashboard-store";

const pageTitles: Record<string, string> = {
  "/overview": "Overview",
  "/": "Overview",
  "/patients": "Patients",
  "/users": "Users",
  "/meetings": "Meetings",
  "/audit-logs": "Audit Logs",
  "/security": "Security",
};

export function DashboardHeader() {
  const pathname = usePathname();

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

  const pageTitle = pageTitles[pathname] || "Dashboard";

  return (
    <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-3 sm:py-4 border-b bg-card sticky top-0 z-10 w-full">
      <SidebarTrigger className="-ml-1 sm:-ml-2" />
      <h1 className="text-base sm:text-lg font-medium truncate">{pageTitle}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {hasEditLayout && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground h-8 sm:h-9">
              <Settings className="size-4" />
              <span className="hidden sm:inline">Edit Layout</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isOverview && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showAlertBanner}
                    onCheckedChange={setShowAlertBanner}
                  >
                    Alert Banner
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showStatsCards}
                    onCheckedChange={setShowStatsCards}
                  >
                    Stats Cards
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showChart}
                    onCheckedChange={setShowChart}
                  >
                    Visit Trends Chart
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showTable}
                    onCheckedChange={setShowTable}
                  >
                    Patients Table
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    Reset Layout
                  </DropdownMenuItem>
                </>
              )}
              {isPatients && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showPatientStats}
                    onCheckedChange={setShowPatientStats}
                  >
                    Stats Cards
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showPatientTable}
                    onCheckedChange={setShowPatientTable}
                  >
                    Patients Table
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetPatientsLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    Reset Layout
                  </DropdownMenuItem>
                </>
              )}
              {isUsers && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={showUserStats}
                    onCheckedChange={setShowUserStats}
                  >
                    Stats Cards
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUserCharts}
                    onCheckedChange={setShowUserCharts}
                  >
                    Charts
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={showUserTable}
                    onCheckedChange={setShowUserTable}
                  >
                    Users Table
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetUsersLayout}>
                    <RefreshCw className="size-4 mr-2" />
                    Reset Layout
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <NovuInbox />
        <ThemeToggle />
      </div>
    </header>
  );
}
