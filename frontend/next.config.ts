import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

function getApiProxyTarget(): string {
  const rawTarget =
    process.env.NEXT_SERVER_API_PROXY_TARGET ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://backend:8000";
  const normalizedTarget = rawTarget.endsWith("/")
    ? rawTarget.slice(0, -1)
    : rawTarget;

  if (
    normalizedTarget.startsWith("http://") ||
    normalizedTarget.startsWith("https://")
  ) {
    return normalizedTarget;
  }

  return "http://backend:8000";
}

const API_PROXY_TARGET = getApiProxyTarget();

const BASE_SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const PUBLIC_SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "";
const PUBLIC_SENTRY_ENVIRONMENT =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
  process.env.SENTRY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  "";
const PUBLIC_SENTRY_RELEASE =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE ?? "";
const ENABLE_PRODUCTION_BROWSER_SOURCEMAPS =
  process.env.ENABLE_PRODUCTION_BROWSER_SOURCEMAPS === "true";

const nextConfig: NextConfig = {
  // Keep Strict Mode on in production builds while avoiding double-invoke noise during local development.
  reactStrictMode: process.env.NODE_ENV === "production",
  productionBrowserSourceMaps: ENABLE_PRODUCTION_BROWSER_SOURCEMAPS,
  devIndicators: false,
  output: "standalone", // Required for Docker containerization
  env: {
    NEXT_PUBLIC_SENTRY_DSN: PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_RELEASE: PUBLIC_SENTRY_RELEASE,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
      ...(process.env.NODE_ENV !== "production"
        ? [
            {
              protocol: "http" as const,
              hostname: "localhost",
            },
            {
              protocol: "http" as const,
              hostname: "127.0.0.1",
            },
          ]
        : []),
    ],
  },
  experimental: {
    // Keep the proxy/client body clone limit explicit so oversized payloads fail
    // predictably at the Next.js edge/proxy layer instead of relying on defaults.
    proxyClientMaxBodySize: "1mb",
    serverActions: {
      bodySizeLimit: "1mb",
    },
    viewTransition: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/((?!patient/join$|meetings/call/.*).*)",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        source: "/patient/join",
        headers: BASE_SECURITY_HEADERS,
      },
      {
        source: "/meetings/call/:meetingId",
        headers: BASE_SECURITY_HEADERS,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
