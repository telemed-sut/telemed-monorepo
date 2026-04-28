"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
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
