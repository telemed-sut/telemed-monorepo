import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker containerization
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
