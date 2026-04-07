"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// TODO: Integrate error monitoring service (e.g., @sentry/nextjs)
// import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
      console.error("[global-error-boundary]", {
        message: error?.message ?? "Unknown error",
        digest: error?.digest,
        timestamp: Date.now(),
      });
    }
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-xl font-semibold">Unexpected application error</h1>
          <p className="text-sm text-muted-foreground">
            Please retry. If the issue continues, contact support.
          </p>
          <Button onClick={reset}>Reload</Button>
        </main>
      </body>
    </html>
  );
}
