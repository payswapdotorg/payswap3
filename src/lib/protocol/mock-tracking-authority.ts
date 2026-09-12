/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK TRACKING AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock tracking authority: the tracking port
 * (src/lib/protocol/tracking-port.ts) is now backed by the RUNTIME
 * ADAPTER over the composed A01 Intent Authority + the real A15 evidence
 * chain (src/lib/protocol/runtime-tracking-adapter.ts). This module is no
 * longer a port backing and implements NO authority semantics.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only verification surface frozen by UI-005
 * (src/app/verification/tracking-flow/page.tsx imports
 * getMockTrackingAuthority + MOCK_REFERENCE_SUMMARIES) imports this module
 * BY PATH, and the work order forbids changing product surfaces. The
 * retained API: getMockTrackingAuthority() returns the CURRENT port
 * backing — the runtime tracking adapter, which itself carries the
 * verification affordances (resetScripting / scriptEvidenceAvailability:
 * the A15 READ's availability axis) — and MOCK_REFERENCE_SUMMARIES is the
 * verification reference catalog, re-anchored honestly: lookups resolve
 * against the composed runtime, so the catalog describes the
 * presentations and notes that a fresh runtime reports no record for the
 * legacy sandbox ids.
 */

import { getTrackingPort } from './tracking-port';
import type { TrackingPort } from './tracking-port';
import type { RuntimeTrackingScripting } from './runtime-tracking-adapter';
import type { NavAudience } from '@/lib/navigation';

export interface MockReferenceSummary {
  readonly referenceId: string;
  readonly subjectWording: string;
  readonly subjectKind: string;
  readonly state: string;
  readonly authorizedAudiences: readonly NavAudience[];
  readonly note: string;
}

/**
 * The verification-harness reference catalog. Post-UI-011 the lookups run
 * against the composed runtime: the runtime records the protocol object
 * ids it actually holds (A01 intent ids), and the legacy sandbox ids
 * below honestly resolve to not-found there — the matrix renders the
 * not-found presentation for them unless the runtime records an intent
 * under the id. The catalog rows keep their display-state coverage notes
 * for the presentations the harness demonstrates.
 */
export const MOCK_REFERENCE_SUMMARIES: readonly MockReferenceSummary[] = [
  {
    referenceId: 'PWS-9QM2',
    subjectWording: 'Payment of 18.40 EUR to Meridian Coffee (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'succeeded',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note:
      'Covers the succeeded display state. Post-UI-011 this lookup resolves against the composed runtime — a fresh runtime reports no record for this legacy id (not-found, the honest answer); drive the runtime (an intent through the gateway) to see live tracked states.',
  },
  {
    referenceId: 'PWS-5VBM',
    subjectWording: 'Payment of 94.00 EUR to Harbor Print Studio (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'succeeded',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note:
      'Covers the succeeded display state with a fixed no-answer evidence record (the A15-read availability scripting demonstrates the no-answer record view).',
  },
  {
    referenceId: 'PWS-7F3K',
    subjectWording: 'Payment of 12.00 EUR to Meridian Coffee (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'waiting',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note: 'Covers the waiting display state.',
  },
  {
    referenceId: 'STL-4419',
    subjectWording: 'Settlement of the day\u2019s captured payments (legacy sandbox id)',
    subjectKind: 'settlement',
    state: 'waiting',
    authorizedAudiences: ['merchant', 'provider', 'operator', 'administrator'],
    note:
      'Covers the waiting display state for a settlement subject. Settlement objects are recorded by the composed A12/A13 runtime when its flows execute.',
  },
  {
    referenceId: 'PWS-2H8D',
    subjectWording: 'Payment of 64.00 EUR to Atlas Bookbindery (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'failed',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note: 'Covers the failed display state with the authority\u2019s recorded reason code.',
  },
  {
    referenceId: 'PWS-4TNN',
    subjectWording: 'Payment of 22.50 EUR to Meridian Coffee (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'in-progress',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note: 'Covers the in-progress display state.',
  },
  {
    referenceId: 'PWS-6KLP',
    subjectWording: 'Payment of 130.00 EUR to Loom & Ledger (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'unknown',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note: 'Covers the unknown display state with its reconciliation path (P5).',
  },
  {
    referenceId: 'PWS-8XRQ',
    subjectWording: 'Payment of 41.10 EUR to Copperline Coffee (legacy sandbox id)',
    subjectKind: 'payment intent',
    state: 'action-required',
    authorizedAudiences: ['customer', 'merchant', 'operator', 'administrator'],
    note: 'Covers the action-required display state.',
  },
] as const;

/**
 * The tracking authority the verification page drives: the CURRENT port
 * backing (the runtime tracking adapter — which itself carries the
 * verification affordances resetScripting / scriptEvidenceAvailability
 * over the A15 READ's availability axis). No mock state exists to reset;
 * the scripting surface is the adapter's own read affordance.
 */
export function getMockTrackingAuthority(): TrackingPort & RuntimeTrackingScripting {
  const port = getTrackingPort();
  const scripting = port as TrackingPort & RuntimeTrackingScripting;
  if (
    typeof scripting.resetScripting !== 'function' ||
    typeof scripting.scriptEvidenceAvailability !== 'function'
  ) {
    // The transport-unavailable backing (browser context) has no scripting
    // affordance; return a fail-closed stand-in so the frozen page keeps a
    // working shape (its scripting calls are no-ops there by design).
    return {
      ...port,
      resetScripting() {
        /* no runtime read to script in this context */
      },
      scriptEvidenceAvailability() {
        /* no runtime read to script in this context */
      },
    };
  }
  return scripting;
}
