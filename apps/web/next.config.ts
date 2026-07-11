import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // `next build` runs inside the bind-mounted dev container; its type-check
  // phase tried to auto-install typescript and hit ERR_PNPM_INCLUDED_DEPS_CONFLICT
  // against the host node_modules, failing the build (real CI e2e run
  // 29158802923). Type-checking and linting are dedicated CI `check`-job steps
  // (npx tsc --noEmit on both apps) — skip them during the build itself so the
  // production build is fast and self-contained.
  // Next 16 doesn't run ESLint during `next build`, so only the TypeScript
  // check needs disabling here.
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
