/**
 * PC-004 — Console module route entrypoint (composed): payment detail
 * (the design §7 flagship surface).
 *
 * Module:  console.payments.detail
 * Route:   /console/payments/[paymentId]
 *
 * Composed EXCLUSIVELY from the PC-003 payment-detail read model
 * (`readConsolePaymentDetail`) after the SYS-001 server wiring seam: the A01
 * intent snapshot with its A15 evidence records plus the A08 waiting/queued
 * sub-read scoped to the viewer role (the queue authority's own per-reference
 * data-level role check — the one check the read performs).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute resolves this
 * page's own registry template route (the [paymentId] segment value never
 * participates in authorization) and enforces the module's allowed roles
 * server-side (customer, merchant, operator). A missing or unmatched
 * reference renders UNKNOWN through the read model's honest no-answer branch
 * — never a fabricated "not found" failure.
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
import { readConsolePaymentDetail } from '@/lib/console/read-models/payments';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsolePaymentDetailView } from '@/components/console/views/payment-detail-view';

export const metadata = consoleRouteMetadata('/console/payments/[paymentId]');

export default async function ConsolePaymentsPaymentIdPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console/payments/[paymentId]');
  // SYS-001 (D-2): resolve the runtime-backed port adapters before the read
  // model resolves the ports (idempotent per module graph).
  await ensureProductPortsWired();
  const { paymentId } = await params;
  const result = await readConsolePaymentDetail(decodeURIComponent(paymentId), principal.role);

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/payments/[paymentId]"
        lead="Flagship payment detail: authority-quoted figures, relationships, timestamps, the A15 evidence timeline, and the waiting/queued sub-read — every consequential field attributed, every absence stated honestly."
      />
      <ConsolePaymentDetailView result={result} requestedIntentId={decodeURIComponent(paymentId)} />
    </article>
  );
}
