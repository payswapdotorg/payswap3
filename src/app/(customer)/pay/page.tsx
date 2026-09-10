import type { Metadata } from 'next';
import { ComposeIntentView } from '@/components/pay/compose-intent-view';
import { describeEnvironment } from '@/lib/environment';
import { requireRoleSurface } from '@/lib/shell-guard';

export const metadata: Metadata = {
  title: 'Send a payment intent',
  description:
    'Outcome-first payment intent composition: state the outcome, then the details the intent needs. Nothing is submitted on this page.',
};

/**
 * Customer payment intent composition — outcome-first entry (UI-002).
 * Deep-link role check on direct entry (P8): customer surface only.
 */
export default async function PayComposePage() {
  await requireRoleSurface('customer');
  return <ComposeIntentView environment={describeEnvironment()} />;
}
