"use client";

import { PatientsTable } from "./patients-table";

export function DashboardContent() {
  return (
    <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
      <PatientsTable />
    </main>
  );
}
