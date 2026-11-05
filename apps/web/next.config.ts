import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "mammoth", "@larksuiteoapi/node-sdk"],
  outputFileTracingRoot: "../../",
};

export default nextConfig;
