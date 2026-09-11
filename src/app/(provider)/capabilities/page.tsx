/**
 * UI-004 — Provider capability list surface.
 *
 * The provider-facing capability list: a strictly read-only presentation of
 * capability and routing truth owned by protocol authorities. Role-gated to
 * the provider audience on direct entry (requireRoleSurface redirects home on
 * denial, P8); the provider sees only provider surfaces. Data flows through
 * the capability port only — the UI computes no capability, eligibility, or
 * routing decision.
 */
import { resolveNavigation } from "@/lib/navigation";
import type { NavEntry } from "@/lib/navigation";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getCapabilityPort } from "@/lib/protocol/capability-port";
import { CapabilityListView } from "@/components/provider/capability-list-view";
import { ProviderSurfaceFrame } from "@/components/provider/capability-surface-frame";

export const metadata = {
  title: "Capabilities — PaySwap provider surface",
  description:
    "Read-only presentation of protocol capability and routing truth for providers.",
};

export default async function ProviderCapabilitiesPage() {
  await requireRoleSurface("provider");
  const audience = await resolveShellAudience();
  const resolved = resolveNavigation(audience);
  const entries: readonly NavEntry[] = [
    ...resolved.primary,
    ...resolved.footer,
  ];

  const port = getCapabilityPort();
  const listing = await port.listCapabilities();

  return (
    <ProviderSurfaceFrame
      audience={audience}
      entries={entries}
      activeId="provider-capabilities"
      surfaceLabel="Capabilities"
      surfaceDescription="States, conditions, and provenance come from the capability port."
    >
      <CapabilityListView listing={listing} />
    </ProviderSurfaceFrame>
  );
}
