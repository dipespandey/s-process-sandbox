import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static export: the Worker serves these assets and hosts the realtime Durable Object.
  output: "export",
  reactCompiler: true,
  images: { unoptimized: true },
};

export default nextConfig;
