import type { Metadata } from 'next';
import { IntentFlowHarness } from '@/components/verification/intent-flow-harness';

export const metadata: Metadata = {
  title: 'Intent flow verification',
  description:
    'Verification harness for the customer payment intent surface: workflow evidence, the intent state matrix including UNKNOWN, the role matrix, and the adapter boundary report.',
};

/**
 * Verification surface extension (UI-002): evidences the full customer
 * intent flow — composition, review, explicit submit, explicit state —
 * including the UNKNOWN path, through the same port and primitives the
 * customer surface uses. Reachable from the shell footer for every
 * audience (it presents the harness, not customer content).
 */
export default function VerificationIntentFlowPage() {
  return <IntentFlowHarness />;
}
