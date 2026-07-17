import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/diagnose",
        destination: "/assignments",
        statusCode: 301,
      },
      {
        source: "/dashboard",
        destination: "/analytics",
        statusCode: 301,
      },
      {
        source: "/assignments/:assignmentId/dashboard",
        destination: "/analytics/:assignmentId",
        statusCode: 301,
      },
      {
        source: "/assignments/:assignmentId/students/:membershipId/corrected",
        destination:
          "/analytics/:assignmentId/corrected-copies/:membershipId",
        statusCode: 301,
      },
      {
        source: "/assignments/:assignmentId/practice/:worksheetId",
        destination: "/analytics/:assignmentId/practice/:worksheetId",
        statusCode: 301,
      },
    ];
  },
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
