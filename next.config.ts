import type { NextConfig } from "next";

// DEP-002 — runtime packaging configuration.
//
// `output: "standalone"` makes the production build emit a self-contained
// server (`.next/standalone/server.js` + traced node_modules + static
// assets). That standalone output is the reproducible runtime package the
// Dockerfile copies into its runtime stage (see spec/deployment/packaging.md).
//
// DEP-002 adds NOTHING else with packaging semantics: no environment
// selection, no build-time configuration, no secrets. PAYSWAP_ENV is a
// RUNTIME variable injected by deployment configuration and is never baked
// into build artifacts (F2).
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
