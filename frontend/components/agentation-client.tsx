"use client";

import dynamic from "next/dynamic";

const AgentationOverlay = dynamic(
  () => import("agentation").then((mod) => mod.Agentation),
  { ssr: false }
);

const DEFAULT_AGENTATION_ENDPOINT = "http://localhost:4747";

export function AgentationClient() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <AgentationOverlay
      endpoint={
        process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT ??
        DEFAULT_AGENTATION_ENDPOINT
      }
    />
  );
}
