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

const nextConfig: NextConfig = {
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
};

export default nextConfig;
