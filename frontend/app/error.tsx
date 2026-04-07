"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// TODO: Integrate error monitoring service (e.g., @sentry/nextjs)
// import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      // Redact sensitive details in production — forward to monitoring instead
      // TODO: Replace with actual error monitoring service (e.g., @sentry/nextjs)
      console.error("[error-boundary]", {
        message: error?.message ?? "Unknown error",
        digest: error?.digest,
        timestamp: Date.now(),
      });
    }
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this page. Please try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
