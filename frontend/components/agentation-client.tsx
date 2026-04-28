"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const AgentationOverlay = dynamic(
  () => import("agentation").then((mod) => mod.Agentation),
  { ssr: false }
);

const DEFAULT_AGENTATION_ENDPOINT = "http://localhost:4747";
const AGENTATION_HEALTH_TIMEOUT_MS = 1500;

function getAgentationHealthUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/health`;
}

export function AgentationClient() {
  const [isAvailable, setIsAvailable] = useState(false);
  const isDevelopment = process.env.NODE_ENV === "development";
  const isSyncEnabled =
    process.env.NEXT_PUBLIC_AGENTATION_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_AGENTATION_SYNC_ENABLED === "true";
  const endpoint =
    process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT ?? DEFAULT_AGENTATION_ENDPOINT;

  useEffect(() => {
    if (!isDevelopment || !isSyncEnabled) {
      setIsAvailable(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, AGENTATION_HEALTH_TIMEOUT_MS);

    async function checkHealth() {
      try {
        const response = await fetch(getAgentationHealthUrl(endpoint), {
          method: "GET",
          signal: controller.signal,
        });
        if (response.ok) {
          setIsAvailable(true);
        } else {
          setIsAvailable(false);
        }
      } catch {
        setIsAvailable(false);
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void checkHealth();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [endpoint, isDevelopment, isSyncEnabled]);

  if (!isDevelopment) {
    return null;
  }

  return (
    <AgentationOverlay endpoint={isSyncEnabled && isAvailable ? endpoint : undefined} />
  );
}
