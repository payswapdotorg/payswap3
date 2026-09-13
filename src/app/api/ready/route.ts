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
//
// DEP-007 — STRICTLY ADDITIVE enrichment (this work item): the response
// bodies additionally carry a `componentHealth` field — the nine-domain
// health model (src/lib/observability/) derived over the durable store
// the application hosts. The enrichment is additive ONLY:
//   - the F6 configuration checks above REMAIN the readiness authority;
//     this field never flips a status code;
//   - every pre-existing response field and every status code are
//     byte-identical to the pre-DEP-007 route;
//   - src/app/api/health/route.ts (liveness — the F6 separation) is
//     untouched;
//   - when the durable store cannot be opened or the health cannot be
//     derived, the field reports `unknown-data` with a named error
//     (fail-closed — never a guessed 'ok', never a thrown error).

import { NextResponse } from "next/server";
import { validateStartupConfig } from "@/lib/startup-config";
import { probeComponentHealth } from "@/lib/observability/readiness";

// Evaluated per request against the live process environment — never
// statically prerendered or cached (F2: configuration is injected at
// runtime; a build-time evaluation would bake stale results).
export const dynamic = "force-dynamic";

export async function GET() {
  const result = validateStartupConfig();

  // DEP-007 additive enrichment: the nine-domain component health over the
  // durable store. Never throws, never changes the status code (fail-closed
  // to `unknown-data` when the store is unreachable — F6 discipline).
  const componentHealth = probeComponentHealth();

  if (result.ok) {
    // Ready: return the checks summary (ids, outcomes, value-free details)
    // plus the additive component health.
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
        componentHealth,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  // NOT ready: fail closed. 503 with the NAMED failing check ids only —
  // never values, never partial readiness, never a guess (F6, S4). The
  // additive component health rides along for the operator.
  return NextResponse.json(
    {
      status: "not_ready",
      component: "web-api-boundary",
      env: result.env,
      failing: result.checks
        .filter((check) => !check.ok)
        .map((check) => check.id),
      componentHealth,
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
