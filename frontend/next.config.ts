import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker containerization
  experimental: {
    viewTransition: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/:path*',
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Forwarded-For, CF-Connecting-IP" },
        ],
      },
    ];
  },
};

export default nextConfig;
