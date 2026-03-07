"use client";

import { AlertBanner } from "./alert-banner";
import { StatsCards } from "./stats-cards";
import { FinancialFlowChart } from "./financial-flow-chart";
import { PatientsTable } from "./patients-table";
import { useDashboardStore } from "@/store/dashboard-store";

export function OverviewContent() {
    const showAlertBanner = useDashboardStore((s) => s.showAlertBanner);
    const showStatsCards = useDashboardStore((s) => s.showStatsCards);
    const showChart = useDashboardStore((s) => s.showChart);
    const showTable = useDashboardStore((s) => s.showTable);

    return (
        <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4 space-y-5">
            {showAlertBanner && <AlertBanner />}
            {showStatsCards && <StatsCards />}
            {showChart && <FinancialFlowChart />}
            {showTable && <PatientsTable />}
        </main>
    );
}
