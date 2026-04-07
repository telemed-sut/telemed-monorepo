import type { NextConfig } from "next";

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
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

function createDashboardCsp() {
  const scriptSrc = IS_DEVELOPMENT
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self'";
  const connectSrc = IS_DEVELOPMENT
    ? "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    connectSrc,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
  ].join("; ");
}

const DASHBOARD_CSP = createDashboardCsp();

const CALL_SURFACE_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.zego.im https://*.zego.im wss://*.zego.im wss://*.zego.im:*",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
].join("; ");

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

const DASHBOARD_HEADERS = [
  ...BASE_SECURITY_HEADERS,
  { key: "Content-Security-Policy", value: DASHBOARD_CSP },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const CALL_SURFACE_HEADERS = [
  ...BASE_SECURITY_HEADERS,
  { key: "Content-Security-Policy", value: CALL_SURFACE_CSP },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), fullscreen=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Keep Strict Mode on in production builds while avoiding double-invoke noise during local development.
  reactStrictMode: process.env.NODE_ENV === "production",
  devIndicators: false,
  output: "standalone", // Required for Docker containerization
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
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/((?!patient/join$|meetings/call/.*).*)",
        headers: DASHBOARD_HEADERS,
      },
      {
        source: "/patient/join",
        headers: CALL_SURFACE_HEADERS,
      },
      {
        source: "/meetings/call/:meetingId",
        headers: CALL_SURFACE_HEADERS,
      },
    ];
  },
};

export default nextConfig;
