import { NextResponse } from "next/server";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { MediationActionKind, PartyRole } from "@/lib/protocol/mediation-port";

/**
 * UI-008 — Mediation party-action endpoint (submit statement; accept/decline
 * a proposed resolution).
 *
 * The actor is resolved SERVER-SIDE from the simulated shell audience cookie;
 * the mock authority re-validates per-role protocol authorization on every
 * call. Denials are protocol results (HTTP 200, kind: "denied").
 */

export const dynamic = "force-dynamic";

const ACTIONS: readonly MediationActionKind[] = [
  "submit-statement",
  "accept-proposed-resolution",
  "decline-proposed-resolution",
];

const UNAUTHENTICATED_REASON =
  "No party role is active for this session. Switch to a party audience (customer or merchant) before acting in a mediation.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    caseId?: unknown;
    action?: unknown;
    statement?: unknown;
  } | null;
  const caseId = typeof body?.caseId === "string" ? body.caseId : null;
  const action =
    typeof body?.action === "string" && ACTIONS.includes(body.action as MediationActionKind)
      ? (body.action as MediationActionKind)
      : null;
  if (!caseId || !action) {
    return NextResponse.json(
      {
        kind: "denied",
        reason:
          "Malformed action request: a caseId and exactly one action kind are required.",
      },
      { status: 200 },
    );
  }
  const statement =
    typeof body?.statement === "string" && body.statement.trim().length > 0
      ? body.statement
      : undefined;

  const audience = await resolveShellAudience();
  if (audience === "unauthenticated") {
    return NextResponse.json({ kind: "denied", reason: UNAUTHENTICATED_REASON }, { status: 200 });
  }

  const outcome = await getMediationPort().submitMediationAction({
    caseId,
    action,
    actor: audience as PartyRole,
    statement,
  });
  return NextResponse.json(outcome);
}
