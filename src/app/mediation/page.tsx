import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import { AvailabilityUnknownState } from "@/components/state";
import { PartyDocketView } from "@/components/mediation/party-docket-view";

/**
 * UI-008 — Party surface (customer + merchant, role-gated): the viewer's own
 * agent proposals, mediations, and disputes with deep-linkable detail routes.
 *
 * SPLICE NOTE (Tech Lead integration): the work order names
 * (customer)/mediation/page.tsx + (merchant)/mediation/page.tsx, but Next.js
 * forbids two parallel route-group pages at the same URL; the worker
 * delivered both self-contained with a splice note delegating the routing
 * decision. Integration decision: ONE dual-party page at /mediation — the
 * guard admits customer and merchant (requireRoleSurface with
 * extraAllowed), the audience resolves the docket, and every other
 * audience is redirected home (P8). The nav entry for /mediation declares
 * exactly these two audiences (spec/product/mediation-nav-entries.json).
 */

export const dynamic = "force-dynamic";

export default async function PartyMediationPage() {
  await requireRoleSurface("customer", ["merchant"]);
  const audience = await resolveShellAudience();
  const viewer = audience === "merchant" ? "merchant" : "customer";
  const fetched = await getMediationPort().getPartyDocket(viewer);

  return (
    <section
      aria-label={`${viewer === "merchant" ? "Merchant" : "Customer"} mediation, proposals, and disputes`}
    >
      {fetched.kind === "fetched" ? (
        <PartyDocketView docket={fetched.record} audience={viewer} />
      ) : fetched.kind === "not-visible" ? (
        <p className="text-sm text-muted-foreground">{fetched.reason}</p>
      ) : (
        <AvailabilityUnknownState target={fetched.target} detail={fetched.detail} />
      )}
    </section>
  );
}
