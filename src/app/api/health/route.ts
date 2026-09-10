// src/app/api/health/route.ts — web-api-boundary LIVENESS (DEP-002).
//
// Liveness only: answers "is the process serving?" — always 200 while the
// component is alive, regardless of readiness. No readiness logic, no
// configuration checks, no secrets (F6 separation of liveness/readiness).
//
// Semantics (spec/deployment/packaging.md):
//   GET /api/health → 200 {status: "ok", component: "web-api-boundary", env}

import { NextResponse } from "next/server";
import { getEnvironment } from "@/lib/environment";

// Evaluated per request against the live process environment — never
// statically prerendered or cached, so the reported environment always
// reflects runtime injection (F2: PAYSWAP_ENV is never baked at build time).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      component: "web-api-boundary",
      env: getEnvironment(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
