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

  // Post-closure serverless runtime adaptation — bundle the runtime-read
  // static assets that Next's output file tracing cannot see because they
  // are walked on the filesystem at RUNTIME (never imported):
  //
  //   - deploy/migrations — the DEP-003 durable-substrate migrations
  //     (src/lib/durable/db.ts resolveMigrationsDir walks up from cwd);
  //   - src/lib/protocol-runtime/<domain>/migrations — the seventeen
  //     per-domain persistence migrations (each domain's persistence
  //     module resolves its owned directory by walking up from cwd).
  //
  // Without these includes a serverless bundle (Vercel functions) omits
  // the .sql trees and every store open fails with DurableMigrationError
  // ("migrations directory not found") — the DEPLOY-B audit's secondary
  // FS risk. Read-only assets only: no runtime state is bundled (state
  // lives under the PAYSWAP_RUNTIME_DIR runtime-state root).
  outputFileTracingIncludes: {
    "/**": ["./deploy/migrations/*.sql", "./src/lib/protocol-runtime/**/migrations/*.sql"],
  },
};

export default nextConfig;
