import type { Metadata } from 'next';
import { ReviewIntentView } from '@/components/pay/review-intent-view';
import { describeEnvironment } from '@/lib/environment';
import { requireRoleSurface } from '@/lib/shell-guard';

export const metadata: Metadata = {
  title: 'Review the full consequences',
  description:
    'The complete intent and its plain-language consequences, visible in full before the single explicit submit.',
};

/**
 * Consequence review + explicit submit (UI-002). Deep-link role check on
 * direct entry (P8): customer surface only.
 */
export default async function PayReviewPage() {
  await requireRoleSurface('customer');
  return <ReviewIntentView environment={describeEnvironment()} />;
}
