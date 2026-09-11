import { NextResponse } from "next/server";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole } from "@/lib/protocol/mediation-port";

/**
 * UI-008 — Record query endpoint (GET) used by the interactive surfaces to
 * recheck records with the owning authorities.
 *
 * The viewer is resolved SERVER-SIDE from the simulated shell audience cookie
 * (the client-supplied viewer is never trusted), so every fetch is
 * role-checked by the authority: fetched / not-visible / unavailable.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  if (!id || (type !== "proposal" && type !== "mediation" && type !== "dispute")) {
    return NextResponse.json(
      {
        kind: "unavailable",
        target: "UI-008 record query",
        detail: "Malformed query: type must be proposal, mediation, or dispute, with an id.",
      },
      { status: 200 },
    );
  }

  const audience = await resolveShellAudience();
  if (audience === "unauthenticated") {
    return NextResponse.json(
      {
        kind: "not-visible",
        reason:
          "No party role is active for this session. Switch to a party audience (customer or merchant) to view mediation and dispute records.",
      },
      { status: 200 },
    );
  }
  const viewer: PartyRole = audience as PartyRole;
  const port = getMediationPort();

  if (type === "proposal") {
    return NextResponse.json(await port.getProposal({ proposalId: id, viewer }));
  }
  if (type === "mediation") {
    return NextResponse.json(await port.getMediationCase({ caseId: id, viewer }));
  }
  return NextResponse.json(await port.getDispute({ disputeId: id, viewer }));
}
