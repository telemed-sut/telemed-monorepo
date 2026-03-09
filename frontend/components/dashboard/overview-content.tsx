"use client";

import dynamic from "next/dynamic";

import { AlertBanner } from "./alert-banner";
import { StatsCards } from "./stats-cards";
import { useDashboardStore } from "@/store/dashboard-store";

function ChartSkeleton() {
    return (
        <section className="overflow-hidden rounded-xl border bg-card p-5">
            <div className="space-y-3">
                <div className="h-5 w-52 rounded-md bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded-md bg-muted animate-pulse" />
            </div>
            <div className="mt-5 h-[320px] rounded-xl bg-muted/70 animate-pulse" />
        </section>
    );
}

function TableSkeleton() {
    return (
        <section className="overflow-hidden rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                    <div className="h-5 w-40 rounded-md bg-muted animate-pulse" />
                    <div className="h-4 w-28 rounded-md bg-muted animate-pulse" />
                </div>
                <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
            </div>
            <div className="mt-5 space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-12 rounded-lg bg-muted/70 animate-pulse" />
                ))}
            </div>
        </section>
    );
}

const FinancialFlowChart = dynamic(
    () =>
        import("./financial-flow-chart").then((module) => ({
            default: module.FinancialFlowChart,
        })),
    {
        loading: () => <ChartSkeleton />,
    }
);

const PatientsTable = dynamic(
    () =>
        import("./patients-table").then((module) => ({
            default: module.PatientsTable,
        })),
    {
        loading: () => <TableSkeleton />,
    }
);

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
