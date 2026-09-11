import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  ...(isProd ? { output: 'standalone' as const } : {}),
  serverExternalPackages: ['adm-zip', 'playwright', 'better-sqlite3'],
  outputFileTracingExcludes: {
    '*': [
      './profiles/**',
      './profiles/**/*',
      './public/uploads/**',
      './dist/**',
      './dist/**/*',
      './data/**',
      './data/**/*',
      './build/**'
    ],
  },
};

export default nextConfig;
