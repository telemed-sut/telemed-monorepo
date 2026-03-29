"use client";

import { useEffect, useRef, useState } from "react";

import { AlertBanner } from "./alert-banner";
import { StatsCards } from "./stats-cards";
import { useDashboardStore } from "@/store/dashboard-store";

import { OverviewStatsProvider } from "@/components/dashboard/overview-stats-context";
import { FinancialFlowChart } from "./financial-flow-chart";
import { PatientsTable } from "./patients-table";

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

function DeferredOverviewTable() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [shouldMount, setShouldMount] = useState(false);

    useEffect(() => {
        const node = containerRef.current;
        if (!node || shouldMount) {
            return;
        }

        if (typeof IntersectionObserver === "undefined") {
            setShouldMount(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setShouldMount(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "320px 0px" }
        );

        observer.observe(node);

        return () => observer.disconnect();
    }, [shouldMount]);

    return (
        <div ref={containerRef}>
            {shouldMount ? <PatientsTable /> : <TableSkeleton />}
        </div>
    );
}

export function OverviewContent() {
    const showAlertBanner = useDashboardStore((s) => s.showAlertBanner);
    const showStatsCards = useDashboardStore((s) => s.showStatsCards);
    const showChart = useDashboardStore((s) => s.showChart);
    const showTable = useDashboardStore((s) => s.showTable);

    return (
        <OverviewStatsProvider>
            <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4 space-y-5">
                {showAlertBanner && <AlertBanner />}
                {showStatsCards && <StatsCards />}
                {showChart && <FinancialFlowChart />}
                {showTable && <DeferredOverviewTable />}
            </main>
        </OverviewStatsProvider>
    );
}
