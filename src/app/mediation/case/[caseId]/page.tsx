import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole } from "@/lib/protocol/mediation-port";
import { FetchedRecordFrame } from "@/components/mediation/fetched-record-frame";
import { MediationThreadView } from "@/components/mediation/mediation-thread-view";

/**
 * UI-008 — Mediation participation detail (deep link, role-checked).
 * Route shape chosen by UI-008: /mediation/case/[caseId].
 * Only parties to the mediation may open the thread.
 */

export const dynamic = "force-dynamic";

export default async function MediationCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const audience = await resolveShellAudience();
  await requireRoleSurface("customer", ["merchant"]);
  const viewer: PartyRole = audience === "merchant" ? "merchant" : "customer";
  const fetched = await getMediationPort().getMediationCase({ caseId, viewer });

  return (
    <section aria-label="Mediation thread">
      <h1 className="sr-only">Mediation thread</h1>
      <FetchedRecordFrame fetch={fetched} recordLabel="Mediation">
        {(mediationCase) => (
          <MediationThreadView
            initialCase={mediationCase}
            viewer={viewer}
            viewerLabel={
              mediationCase.parties.find((entry) => entry.party.role === viewer)?.party.label ??
              viewer
            }
          />
        )}
      </FetchedRecordFrame>
    </section>
  );
}
