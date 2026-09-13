import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole } from "@/lib/protocol/mediation-port";
import { FetchedRecordFrame } from "@/components/mediation/fetched-record-frame";
import { RecourseTracker } from "@/components/dispute/recourse-tracker";
import { ensureProductPortsWired } from "@/lib/protocol/server-composition";

/**
 * UI-008 — Dispute record + recourse tracking detail (deep link, role-checked).
 * Route shape chosen by UI-008: /mediation/dispute/[disputeId].
 * Only the parties to the dispute (its opener and its respondent) may open it.
 */

export const dynamic = "force-dynamic";

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ disputeId: string }>;
}) {
  const { disputeId } = await params;
  const audience = await resolveShellAudience();
  // SYS-001 (D-2): ensure this route's module graph resolves the runtime-backed
  // port adapters (the process-global composed runtime; idempotent per graph).
  await ensureProductPortsWired();
  await requireRoleSurface("customer", ["merchant"]);
  const viewer: PartyRole = audience === "merchant" ? "merchant" : "customer";
  const fetched = await getMediationPort().getDispute({ disputeId, viewer });

  return (
    <section aria-label="Dispute record and recourse tracking">
      <h1 className="sr-only">Dispute record and recourse tracking</h1>
      <FetchedRecordFrame fetch={fetched} recordLabel="Dispute record">
        {(dispute) => (
          <RecourseTracker
            initialDispute={dispute}
            viewer={viewer}
            viewerLabel={
              dispute.openedBy.role === viewer
                ? dispute.openedBy.label
                : dispute.against.role === viewer
                  ? dispute.against.label
                  : viewer
            }
          />
        )}
      </FetchedRecordFrame>
    </section>
  );
}
