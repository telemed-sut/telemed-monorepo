"use client";

import RippleWaveLoader from "@/components/mvpblocks/ripple-loader";

export type DashboardPageSkeletonVariant =
  | "overview"
  | "table"
  | "calendar"
  | "form"
  | "detail"
  | "monitor"
  | "call";

export function DashboardPageSkeleton({
  variant = "table",
}: {
  variant?: DashboardPageSkeletonVariant;
}) {
  void variant;

  return (
    <main
      className="flex flex-1 items-center justify-center overflow-hidden bg-background"
      aria-busy="true"
    >
      <div className="flex min-h-[45svh] flex-col items-center justify-center gap-5">
        <RippleWaveLoader />
        <span className="sr-only">Loading dashboard content</span>
      </div>
    </main>
  );
}
