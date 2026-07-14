import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "sharp"],
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./uploads/**/*",
      "./fixtures/**/*",
      "./.git/**/*",
      "./.next/cache/**/*",
    ],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
