import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // Parent ~/yarn.lock made Next treat ~ as the app root and skip this project's .env
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingIncludes: {
    "/api/documents/blank-form": ["./assets/blank-forms/**/*"],
    "/api/demo/message": ["./assets/blank-forms/**/*"],
    "/api/inngest": ["./assets/blank-forms/**/*"],
  },
};

export default nextConfig;
