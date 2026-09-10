import type { Metadata } from 'next';
import { IntentStateView } from '@/components/pay/intent-state-view';
import { describeEnvironment } from '@/lib/environment';
import { requireRoleSurface } from '@/lib/shell-guard';

export const metadata: Metadata = {
  title: 'Payment intent state',
  description:
    'The intent’s state exactly as the Intent Authority reports it — acknowledged, failed, or explicitly unknown — with its evidence trail.',
};

/**
 * Intent state presentation (UI-002): explicit state from the port via the
 * shared display-state primitives. Deep-link role check on direct entry
 * (P8): customer surface only. A reference the authority cannot answer for
 * is presented as UNKNOWN with its reconciliation path — never as a 404,
 * never as failure.
 */
export default async function PayIntentStatePage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  await requireRoleSurface('customer');
  const { intentId } = await params;
  return <IntentStateView intentId={intentId} environment={describeEnvironment()} />;
}
