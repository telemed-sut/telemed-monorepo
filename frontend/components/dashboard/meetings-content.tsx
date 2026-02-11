"use client";

import { MeetingsTable } from "./meetings-table";

export function MeetingsContent() {
    return (
        <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
            <MeetingsTable />
        </main>
    );
}
