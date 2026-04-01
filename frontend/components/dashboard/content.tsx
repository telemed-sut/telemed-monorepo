"use client";

import { PatientsTable } from "./patients-table";
import { useDashboardStore } from "@/store/dashboard-store";

export function DashboardContent() {
  const showPatientStats = useDashboardStore((state) => state.showPatientStats);
  const showPatientTable = useDashboardStore((state) => state.showPatientTable);

  return (
    <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
      <PatientsTable
        showStats={showPatientStats}
        showTable={showPatientTable}
      />
    </main>
  );
}
