import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence warning about multiple lockfiles
  serverExternalPackages: ["@game-studio/types", "@game-studio/agents", "@game-studio/skills"],
};

export default nextConfig;