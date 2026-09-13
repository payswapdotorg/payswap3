// src/app/api/protocol/commands/route.ts — SYS-001 (D-1): the protocol
// gateway's HTTP binding over the web boundary.
//
// THE TRANSPORT for the composed runtime's sole admission point
// (deploy/contracts/components.json protocol-gateway: "the sole admission
// point for protocol commands"; spec/deployment/topology.md: "There is
// exactly one protocol-command admission point"). POST admits one command
// envelope through ProtocolGateway.submitCommand — the A01 admission
// contract, end to end:
//
//   • authorization  — the envelope's attributable authority slot + the
//                      per-command subject binding (the gateway's steps
//                      (1)/(3)/(6); an unattributable submission is
//                      refused before any effect);
//   • body validation — the owning authority's registered command schema
//                      (the gateway's steps (4)/(5) — COMMAND_KIND_UNKNOWN /
//                      COMMAND_BODY_INVALID typed refusals, each recorded
//                      as A15 rejection evidence);
//   • idempotent receipts — the recorded (kind, idempotencyKey) receipt
//                      returned verbatim on re-submission (INV-1-3; no
//                      second enqueue, no second effect).
//
// NO financial authority lives here (the SYS-001 forbidden clause): this
// route forwards the submission VERBATIM — it never validates command
// semantics, never calls an authority method, never touches the durable
// substrate; every typed refusal and every receipt comes from the gateway
// itself. Effects occur only via the transition path the gateway enqueues
// onto (the single-writer discipline).
//
// Transport vocabulary (this route's own, clearly typed as transport —
// never admission semantics):
//   POST 200 — the gateway's typed CommandAdmissionResult (accepted arm
//              {ok, replayed, created, receipt, jobId} or typed refusal
//              arm {ok: false, reasonCode, problem, field?}; refusals are
//              protocol results, HTTP 200, per the mediation-route
//              precedent).
//   POST 400 — the submission could not be submitted at all:
//              {ok: false, transportError: "malformed-json" |
//              "unattributable-submission", problem} (malformed JSON
//              bodies; gateway TypeError — the submission names no
//              registry authority, so no typed refusal can be recorded
//              without fabricating one).
//   POST 500 — fail-closed on unexpected transport-side errors (never a
//              silent pass; nothing is retried silently).
//
//   GET /api/protocol/commands?kind=<kind>&idempotencyKey=<key> — the
//   read-only receipt lookup (gateway.getReceipt, INV-1-3's query arm):
//   {found: true, receipt} | {found: false} | 400 on missing parameters.
//
// The route resolves the composed runtime through
// src/lib/protocol/server-composition.ts (the D-2 wiring — the same
// process-global composition the instrumentation hook boots); submitted
// commands EXECUTE through the worker's auto-poll loop and the D-3 bounded
// drain (server-runtime.ts).
//
// Environment contract: no new externally-configurable names (the binding
// uses the in-process composition; components.json configuration.md stay
// unchanged by this route). Reachable in every environment class the
// web-api-boundary component serves (development, test-ci, sandbox,
// staging, production per its environment_reachability) — the environment
// allowlist, fail-safe and F1–F8 rules hold unchanged; PAYSWAP_ENV never
// selects a different admission semantics.

import { NextResponse } from "next/server";
import {
  ensureProductPortsWired,
  getServerProtocolGateway,
} from "@/lib/protocol/server-composition";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // (1) Malformed JSON is a transport-level refusal (typed, 400) — it
  //     never reaches the gateway (there is no submission to attribute).
  const submission = await request.json().catch(() => null);
  if (submission === null || typeof submission !== "object") {
    return NextResponse.json(
      {
        ok: false,
        transportError: "malformed-json",
        problem:
          "The request body is not valid JSON — no submission reached the protocol gateway. " +
          "POST a kernel CommandEnvelope object (kind, authority, subjectIds, idempotencyKey, protocolTime, body).",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // (2) THE sole admission point — the composed runtime's gateway, reached
  //     through the D-2 wiring (this route's module graph shares the
  //     process-global composition). The submission is forwarded VERBATIM.
  await ensureProductPortsWired();
  const gateway = await getServerProtocolGateway();
  try {
    const admission = await gateway.submitCommand(submission);
    // Typed result vocabulary (accepted or typed refusal) — HTTP 200.
    return NextResponse.json(admission, {
      status: 200,
      headers: { "Cache-Control": "no-store" } as Record<string, string>,
    });
  } catch (error) {
    // The gateway throws TypeError for unattributable submissions (an
    // authority slot naming no registry authority — the refusal cannot be
    // recorded without fabricating an authority) and when the durable
    // enqueue itself fails (no receipt; the same-key retry is safe).
    if (error instanceof TypeError) {
      return NextResponse.json(
        {
          ok: false,
          transportError: "unattributable-submission",
          problem:
            `${error instanceof Error ? error.message : String(error)} — nothing was admitted and nothing was recorded; ` +
            "the submission must name a protocol authority that hosts a gateway command surface.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } as Record<string, string> },
      );
    }
    // Fail-closed: an unexpected error is surfaced, never swallowed.
    return NextResponse.json(
      {
        ok: false,
        transportError: "transport-failure",
        problem:
          `The admission call failed before a typed result was produced: ` +
          `${error instanceof Error ? error.message : String(error)}. Nothing is retried silently; ` +
          "re-submit explicitly if appropriate (the durable queue dedupes on the idempotency key).",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } as Record<string, string> },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const idempotencyKey = url.searchParams.get("idempotencyKey");
  if (kind === null || idempotencyKey === null) {
    return NextResponse.json(
      {
        ok: false,
        transportError: "missing-lookup-parameters",
        problem:
          "Receipt lookup requires both query parameters: kind and idempotencyKey " +
          "(INV-1-3's recorded-receipt query, gateway.getReceipt).",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } as Record<string, string> },
    );
  }
  await ensureProductPortsWired();
  const gateway = await getServerProtocolGateway();
  const receipt = gateway.getReceipt(kind, idempotencyKey);
  return NextResponse.json(
    receipt === undefined ? { found: false } : { found: true, receipt },
    { status: 200, headers: { "Cache-Control": "no-store" } as Record<string, string> },
  );
}
