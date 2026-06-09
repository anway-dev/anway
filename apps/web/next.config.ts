import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: "/Users/raj/workspace_code/ai-proj/restol",
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules",
        "/Users/raj/",
      ],
    };
    return config;
  },
};

export default nextConfig;
