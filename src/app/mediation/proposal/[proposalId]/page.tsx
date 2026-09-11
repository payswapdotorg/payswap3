import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole } from "@/lib/protocol/mediation-port";
import { FetchedRecordFrame } from "@/components/mediation/fetched-record-frame";
import { ProposalReviewView } from "@/components/mediation/proposal-review-view";

/**
 * UI-008 — Agent-proposal review/decision detail (deep link, role-checked).
 * Route shape chosen by UI-008: /mediation/proposal/[proposalId].
 * Only the addressed party and the counterparty may open a proposal; the
 * authority additionally gates which of them may decide.
 */

export const dynamic = "force-dynamic";

export default async function ProposalReviewPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const audience = await resolveShellAudience();
  await requireRoleSurface("customer", ["merchant"]);
  const viewer: PartyRole = audience === "merchant" ? "merchant" : "customer";
  const fetched = await getMediationPort().getProposal({ proposalId, viewer });

  return (
    <section aria-label="Agent proposal review and decision">
      <FetchedRecordFrame fetch={fetched} recordLabel="Agent proposal">
        {(proposal) => (
          <ProposalReviewView
            initialProposal={proposal}
            viewer={viewer}
            viewerLabel={
              proposal.addressedTo.role === viewer
                ? proposal.addressedTo.label
                : proposal.counterparty.label
            }
          />
        )}
      </FetchedRecordFrame>
    </section>
  );
}
