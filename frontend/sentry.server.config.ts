import * as Sentry from "@sentry/nextjs";

const sentryDsn = process.env.SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  });
}
