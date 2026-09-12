/**
 * Intent state → display state mapping (UI-002; re-anchored to runtime
 * truth by UI-011).
 *
 * The single place where an authority-reported intent state resolves to
 * exactly one of the six display states (P4). This mapping mirrors
 * spec/product/intent-mapping-records.md record-for-record: every entry
 * here has a nine-question mapping record there, and unmapped authority
 * states do not ship (UX contract Section 8).
 *
 * RE-ANCHORED (UI-011): the authority-side vocabulary is the composed
 * runtime's OWN A01 export — INTENT_STATES (DRAFT, AUTHORIZED, ROUTED,
 * FULFILLING, FULFILLED, FAILED, CANCELLED) — imported from the runtime's
 * leaf module (pure constants). The mock-era fixture members remain in
 * the AuthorityState union for interface compatibility with the frozen
 * verification-harness surfaces; they are retained below with their
 * legacy display resolutions and are never produced by the runtime
 * adapter (their records say so).
 *
 * Runtime-state resolutions (each carries IMR-9..IMR-15 in the records):
 *   DRAFT → WAITING (the authority holds the submitted intent pending its
 *     compliance-gated authorization decision — a qualified, non-terminal
 *     wait; DRAFT's only frozen successor is AUTHORIZED, so no cancel is
 *     authorized in this state)
 *   AUTHORIZED / ROUTED / FULFILLING → IN_PROGRESS (the authority reports
 *     active progression — a present activity report, never a verdict)
 *   FULFILLED → SUCCEEDED (the authority's terminal successful report;
 *     settlement finality is NOT implied — that is A12's report, not A01's)
 *   FAILED → FAILED (terminal, with the A01 reason code vocabulary)
 *   CANCELLED → FAILED (terminal did-not-proceed; the authority's own
 *     reason wording — PAYER_CANCELLED or TERMS_SUPERSEDED — is presented,
 *     and the display record states plainly that a cancelled intent did
 *     not proceed and moved no money)
 */
import type { DisplayState } from '@/components/state';
import {
  AUTHORITY_STATES,
  LEGACY_FIXTURE_STATES,
  type AuthorityState,
} from './intent-port';

export const INTENT_STATE_DISPLAY_MAP: Readonly<Record<AuthorityState, DisplayState>> = {
  // ── the composed runtime's real A01 vocabulary (the iterable set) ──
  DRAFT: 'WAITING',
  AUTHORIZED: 'IN_PROGRESS',
  ROUTED: 'IN_PROGRESS',
  FULFILLING: 'IN_PROGRESS',
  FULFILLED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'FAILED',
  // ── mock-era fixture members (interface-compat; never runtime-produced) ──
  acknowledged: 'SUCCEEDED',
  rejected: 'FAILED',
  unresolved: 'UNKNOWN',
  'held-for-recipient': 'WAITING',
  processing: 'IN_PROGRESS',
  'action-requested': 'ACTION_REQUIRED',
};

/** Boundary conditions (not authority states) and their display resolution. */
export const BOUNDARY_DISPLAY_RESOLUTION: Readonly<{
  submitNotTransported: DisplayState;
  queryNoAnswer: DisplayState;
}> = {
  submitNotTransported: 'UNKNOWN',
  queryNoAnswer: 'UNKNOWN',
};

/** Mapping-record identifiers in spec/product/intent-mapping-records.md. */
export const MAPPING_RECORD_IDS: Readonly<Record<AuthorityState, string>> = {
  DRAFT: 'IMR-9',
  AUTHORIZED: 'IMR-10',
  ROUTED: 'IMR-11',
  FULFILLING: 'IMR-12',
  FULFILLED: 'IMR-13',
  FAILED: 'IMR-14',
  CANCELLED: 'IMR-15',
  acknowledged: 'IMR-1',
  rejected: 'IMR-2',
  unresolved: 'IMR-3',
  'held-for-recipient': 'IMR-4',
  processing: 'IMR-5',
  'action-requested': 'IMR-6',
};

export const BOUNDARY_MAPPING_RECORD_IDS = {
  submitNotTransported: 'IMR-7',
  queryNoAnswer: 'IMR-8',
} as const;

export const MAPPING_RECORDS_DOCUMENT = 'spec/product/intent-mapping-records.md';

/**
 * Exhaustiveness guards: every shippable authority state (the runtime's
 * real vocabulary AND the interface-compat fixture members) is mapped.
 */
const _exhaustive: Record<AuthorityState, true> = {
  ...(Object.fromEntries(AUTHORITY_STATES.map((state) => [state, true as const])) as Record<
    (typeof AUTHORITY_STATES)[number],
    true
  >),
  ...(Object.fromEntries(LEGACY_FIXTURE_STATES.map((state) => [state, true as const])) as Record<
    (typeof LEGACY_FIXTURE_STATES)[number],
    true
  >),
};

export function intentDisplayState(authorityState: AuthorityState): DisplayState {
  return INTENT_STATE_DISPLAY_MAP[authorityState];
}

export function mappingRecordRef(authorityState: AuthorityState): string {
  return `${MAPPING_RECORD_IDS[authorityState]} (${MAPPING_RECORDS_DOCUMENT})`;
}
