import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The pipeline lives in the same package; keep it out of the web bundle.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
