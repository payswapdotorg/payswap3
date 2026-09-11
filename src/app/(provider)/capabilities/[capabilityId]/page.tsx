/**
 * UI-004 — Provider capability detail surface.
 *
 * The single capability view: authoritative state via the shared primitives
 * (UNKNOWN with reconciliation when indeterminate; availability unknown when
 * the reporting source is unavailable — never rendered as a definitive
 * value), the registry-stated composition, and provenance naming the
 * reporting authority. Deep links are role-checked on direct entry (P8).
 * Read-only: no control here mutates any state.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { guardSurface, resolveNavigation } from "@/lib/navigation";
import type { NavEntry } from "@/lib/navigation";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { requireRoleSurface } from "@/lib/shell-guard";
import { getCapabilityPort } from "@/lib/protocol/capability-port";
import { CapabilityDetailView } from "@/components/provider/capability-detail-view";
import { ProviderSurfaceFrame } from "@/components/provider/capability-surface-frame";

type Params = { capabilityId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { capabilityId } = await params;
  // Metadata is guarded without a redirect: non-provider audiences must not
  // learn capability truth from document titles.
  const audience = await resolveShellAudience();
  if (!guardSurface(audience, ["provider"])) {
    return { title: "PaySwap" };
  }
  const port = getCapabilityPort();
  const item = await port.getCapability(capabilityId);
  return {
    title: item
      ? `${item.descriptor.name} — PaySwap provider surface`
      : "Capability not found — PaySwap provider surface",
  };
}

export default async function ProviderCapabilityDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { capabilityId } = await params;
  await requireRoleSurface("provider");
  const audience = await resolveShellAudience();
  const resolved = resolveNavigation(audience);
  const entries: readonly NavEntry[] = [
    ...resolved.primary,
    ...resolved.footer,
  ];

  const port = getCapabilityPort();
  const listing = await port.listCapabilities();
  const item =
    listing.items.find((candidate) => candidate.descriptor.id === capabilityId) ??
    (await port.getCapability(capabilityId));

  if (!item) {
    notFound();
  }

  return (
    <ProviderSurfaceFrame
      audience={audience}
      entries={entries}
      activeId="provider-capabilities"
      surfaceLabel="Capability detail"
      surfaceDescription="One capability: state, composition, and provenance."
    >
      <CapabilityDetailView
        item={item}
        boundary={port.boundary}
        knownCapabilities={listing.items.map((candidate) => ({
          id: candidate.descriptor.id,
          name: candidate.descriptor.name,
        }))}
      />
    </ProviderSurfaceFrame>
  );
}
