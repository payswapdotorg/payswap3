import { NextResponse } from "next/server";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { DisputeGroundId, EvidenceRef, PartyRole } from "@/lib/protocol/mediation-port";

/**
 * UI-008 — Dispute initiation endpoint.
 *
 * The actor is resolved SERVER-SIDE from the simulated shell audience cookie;
 * the mock authority re-validates party status on the reference, open/resolved
 * dispute state, grounds, evidence requirements, and the substantive-account
 * requirement. Denials are protocol results (HTTP 200, kind: "denied") and are
 * always displayed explicitly by the initiation surface.
 */

export const dynamic = "force-dynamic";

const GROUND_IDS: readonly string[] = [
  "goods-not-received",
  "goods-not-as-described",
  "settlement-mismatch",
  "authorization-disagreement",
  "other-with-evidence",
];

const UNAUTHENTICATED_REASON =
  "No party role is active for this session. Switch to a party audience (customer or merchant) before initiating a dispute.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    intentReference?: unknown;
    grounds?: unknown;
    accountOfWhatHappened?: unknown;
    evidence?: unknown;
  } | null;
  const intentReference =
    typeof body?.intentReference === "string" && body.intentReference.length > 0
      ? body.intentReference
      : null;
  const grounds = Array.isArray(body?.grounds)
    ? (body.grounds as unknown[]).filter(
        (id): id is DisputeGroundId => typeof id === "string" && GROUND_IDS.includes(id),
      )
    : [];
  const accountOfWhatHappened =
    typeof body?.accountOfWhatHappened === "string" ? body.accountOfWhatHappened : "";
  const evidence: EvidenceRef[] = Array.isArray(body?.evidence)
    ? (body.evidence as unknown[])
        .filter(
          (entry): entry is EvidenceRef =>
            Boolean(entry) &&
            typeof (entry as EvidenceRef).label === "string" &&
            typeof (entry as EvidenceRef).href === "string",
        )
        .map((entry) => ({ label: entry.label, href: entry.href }))
    : [];

  if (!intentReference) {
    return NextResponse.json(
      {
        kind: "denied",
        reason: "Malformed initiation request: an intentReference for the disputed swap is required.",
      },
      { status: 200 },
    );
  }

  const audience = await resolveShellAudience();
  if (audience === "unauthenticated") {
    return NextResponse.json({ kind: "denied", reason: UNAUTHENTICATED_REASON }, { status: 200 });
  }

  const outcome = await getMediationPort().initiateDispute({
    intentReference,
    grounds,
    accountOfWhatHappened,
    evidence,
    actor: audience as PartyRole,
  });
  return NextResponse.json(outcome);
}
