import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['adm-zip', 'playwright', 'better-sqlite3'],
  outputFileTracingExcludes: {
    '*': [
      './profiles/**',
      './profiles/**/*',
      './public/uploads/**'
    ],
  },
};

export default nextConfig;
