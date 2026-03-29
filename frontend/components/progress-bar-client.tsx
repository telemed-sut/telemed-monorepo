"use client";

import dynamic from "next/dynamic";

const ProgressBar = dynamic(
  () => import("@/components/progress-bar").then((mod) => mod.ProgressBar),
  { ssr: false }
);

export function ProgressBarClient() {
  return <ProgressBar />;
}
