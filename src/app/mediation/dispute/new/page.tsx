import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import type { PartyRole } from "@/lib/protocol/mediation-port";
import { AvailabilityUnknownState } from "@/components/state";
import { DisputeInitiationForm } from "@/components/dispute/dispute-initiation-form";

/**
 * UI-008 — Dispute initiation (deep link, role-checked).
 * Route shape chosen by UI-008: /mediation/dispute/new?intentReference=...
 * Only parties to a reference may initiate a dispute on it (the authority
 * re-validates; denials are displayed explicitly, never swallowed).
 */

export const dynamic = "force-dynamic";

export default async function DisputeInitiationPage({
  searchParams,
}: {
  searchParams: Promise<{ intentReference?: string }>;
}) {
  const { intentReference } = await searchParams;
  const audience = await resolveShellAudience();
  await requireRoleSurface("customer", ["merchant"]);
  const viewer: PartyRole = audience === "merchant" ? "merchant" : "customer";
  const port = getMediationPort();
  const [briefing, docket] = await Promise.all([
    port.getDisputeInitiationBriefing(),
    port.getPartyDocket(viewer),
  ]);

  if (docket.kind !== "fetched") {
    return (
      <section aria-label="Dispute initiation unavailable">
        {docket.kind === "not-visible" ? (
          <p className="text-sm text-muted-foreground">{docket.reason}</p>
        ) : (
          <AvailabilityUnknownState target={docket.target} detail={docket.detail} />
        )}
      </section>
    );
  }

  return (
    <section aria-label="Dispute initiation">
      <h1 className="sr-only">Initiate a dispute</h1>
      <DisputeInitiationForm
        viewer={viewer}
        viewerLabel={docket.record.viewerLabel}
        briefing={briefing}
        intents={docket.record.disputableIntents}
        defaultIntentReference={intentReference}
      />
    </section>
  );
}
