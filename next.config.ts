import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "sharp"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
