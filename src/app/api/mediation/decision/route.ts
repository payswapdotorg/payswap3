import { NextResponse } from "next/server";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole, ProposalDecisionKind } from "@/lib/protocol/mediation-port";

/**
 * UI-008 — Proposal decision endpoint.
 *
 * The actor is resolved SERVER-SIDE from the simulated shell audience cookie;
 * a client-claimed role is never trusted. The mock authority re-validates
 * per-role protocol authorization on every call: authorized decisions are
 * applied and recorded; unauthorized ones are denied with the reason. Denials
 * are protocol results (HTTP 200, kind: "denied"), not transport errors.
 */

export const dynamic = "force-dynamic";

const DECISIONS: readonly ProposalDecisionKind[] = ["accept", "reject", "counter", "escalate"];

const UNAUTHENTICATED_REASON =
  "No party role is active for this session. Switch to a party audience (customer or merchant) before deciding.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    proposalId?: unknown;
    decision?: unknown;
    counterTerms?: unknown;
  } | null;
  const proposalId = typeof body?.proposalId === "string" ? body.proposalId : null;
  const decision =
    typeof body?.decision === "string" && DECISIONS.includes(body.decision as ProposalDecisionKind)
      ? (body.decision as ProposalDecisionKind)
      : null;
  if (!proposalId || !decision) {
    return NextResponse.json(
      {
        kind: "denied",
        reason:
          "Malformed decision request: a proposalId and exactly one decision kind (accept, reject, counter, escalate) are required.",
      },
      { status: 200 },
    );
  }
  const counterTerms =
    typeof body?.counterTerms === "string" && body.counterTerms.trim().length > 0
      ? body.counterTerms
      : undefined;

  const audience = await resolveShellAudience();
  if (audience === "unauthenticated") {
    return NextResponse.json({ kind: "denied", reason: UNAUTHENTICATED_REASON }, { status: 200 });
  }

  const outcome = await getMediationPort().submitProposalDecision({
    proposalId,
    decision,
    actor: audience as PartyRole,
    counterTerms,
  });
  return NextResponse.json(outcome);
}
