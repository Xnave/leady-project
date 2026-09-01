import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // Parent ~/yarn.lock made Next treat ~ as the app root and skip this project's .env
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
