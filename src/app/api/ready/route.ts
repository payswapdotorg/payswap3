// src/app/api/ready/route.ts — web-api-boundary READINESS (DEP-002).
//
// The component's health signal from deploy/contracts/components.json.
// Runs the startup configuration validation (src/lib/startup-config.ts):
//
//   - ok    → 200 with the checks summary
//   - not ok→ 503 with the NAMED failing check ids — ids only, never values
//
// Fail-closed (F6): readiness NEVER infers or guesses. Missing required
// configuration ⇒ NOT ready. In `production` every required secret NAME
// (PAYSWAP_DATABASE_URL, PAYSWAP_QUEUE_URL, PAYSWAP_EVIDENCE_STORE_URL,
// PAYSWAP_RAIL_ADAPTERS_URL) must be present at runtime; absence ⇒ 503.
//
// Semantics (spec/deployment/packaging.md): GET /api/ready → 200 | 503

import { NextResponse } from "next/server";
import { validateStartupConfig } from "@/lib/startup-config";

// Evaluated per request against the live process environment — never
// statically prerendered or cached (F2: configuration is injected at
// runtime; a build-time evaluation would bake stale results).
export const dynamic = "force-dynamic";

export async function GET() {
  const result = validateStartupConfig();

  if (result.ok) {
    // Ready: return the checks summary (ids, outcomes, value-free details).
    return NextResponse.json(
      {
        status: "ok",
        component: "web-api-boundary",
        env: result.env,
        checks: result.checks.map((check) => ({
          id: check.id,
          ok: check.ok,
          detail: check.detail,
        })),
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  // NOT ready: fail closed. 503 with the NAMED failing check ids only —
  // never values, never partial readiness, never a guess (F6, S4).
  return NextResponse.json(
    {
      status: "not_ready",
      component: "web-api-boundary",
      env: result.env,
      failing: result.checks
        .filter((check) => !check.ok)
        .map((check) => check.id),
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
