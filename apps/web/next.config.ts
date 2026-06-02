import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strict typed routes: catches typos in <Link href="..."> and router
  // pushes at compile time. Off by default in Next 15 because it can be
  // noisy for routes generated dynamically (e.g. session ids). We turn
  // it on because every static route in this app is fully typed and the
  // payoff (no broken-nav bugs in production) is worth the churn.
  typedRoutes: true,
  transpilePackages: ["@game-studio/types", "@game-studio/agents", "@game-studio/skills"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
