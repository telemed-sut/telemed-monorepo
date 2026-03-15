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
  "connect-src 'self' https: wss: ws:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
].join("; ");

const BASE_SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const CALL_SURFACE_HEADERS = [
  ...BASE_SECURITY_HEADERS,
  { key: "Content-Security-Policy", value: CALL_SURFACE_CSP },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), fullscreen=(self)",
  },
];

const nextConfig: NextConfig = {
  // Strict Mode double-invokes effects in dev; disable to prevent ZEGO SDK,
  // camera warmup, and heartbeat API calls from firing twice on every HMR update.
  reactStrictMode: false,
  output: 'standalone', // Required for Docker containerization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
      },
    ],
  },
  experimental: {
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
        source: "/(.*)",
        headers: BASE_SECURITY_HEADERS,
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
