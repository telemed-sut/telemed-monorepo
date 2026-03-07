"use client";

import { PatientsTable } from "./patients-table";

export function DashboardContent() {
  return (
    <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
      <PatientsTable />
    </main>
  );
}
