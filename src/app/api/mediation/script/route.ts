import { NextResponse } from "next/server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { MediationHarnessScript } from "@/lib/protocol/mediation-port";

/**
 * UI-008 — Harness scripting endpoint (VERIFICATION SURFACE ONLY).
 *
 * Backs the /verification/mediation-flow harness: it scripts
 * AUTHORITY-OWNED outcomes on the presentation-only mock (mediation/dispute
 * states, proposed resolutions, authority notices, recourse progression,
 * fetch availability).
 *
 * It can never apply or script a proposal decision: decided-* proposal
 * outcomes are refused here and only reachable through
 * submitProposalDecision, which enforces per-role protocol authorization.
 * This endpoint exists only while the mock backs the surfaces (runtime
 * ARRIVING for the real authorities) and is part of no party surface.
 */

export const dynamic = "force-dynamic";

const SCRIPT_TYPES = new Set([
  "reset",
  "set-proposal-state",
  "set-mediation-state",
  "set-proposed-resolution",
  "clear-proposed-resolution",
  "add-authority-notice",
  "set-dispute-state",
  "advance-recourse",
  "set-fetch-availability",
]);

const PROPOSAL_SCRIPT_STATES = new Set(["awaiting-decision", "expired", "authority-unreachable"]);

export async function POST(request: Request) {
  const script = (await request.json().catch(() => null)) as MediationHarnessScript | null;
  if (!script || typeof script.type !== "string" || !SCRIPT_TYPES.has(script.type)) {
    return NextResponse.json(
      {
        applied: "refused",
        note: "Unknown harness script. Only authority-owned outcome scripts are accepted; proposal decisions are never scriptable.",
      },
      { status: 200 },
    );
  }
  if (
    script.type === "set-proposal-state" &&
    !PROPOSAL_SCRIPT_STATES.has(script.authorityState)
  ) {
    return NextResponse.json(
      {
        applied: "refused",
        note:
          "Scripting a proposal decision outcome is refused: decisions only flow through submitProposalDecision under per-role authorization.",
      },
      { status: 200 },
    );
  }
  const result = await getMediationPort().applyHarnessScript(script);
  return NextResponse.json(result);
}
