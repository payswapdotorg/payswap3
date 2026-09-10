/**
 * Intent state → display state mapping (UI-002).
 *
 * The single place where an authority-reported intent state resolves to
 * exactly one of the six display states (P4). This mapping mirrors
 * spec/product/intent-mapping-records.md record-for-record: every entry
 * here has a nine-question mapping record there, and unmapped authority
 * states do not ship (UX contract Section 8). The authority-side fixture
 * vocabulary is defined in intent-port.ts; when the protocol runtime
 * arrives with the Intent Authority's real vocabulary, this table — and
 * its records — are re-anchored to it.
 */
import type { DisplayState } from '@/components/state';
import { AUTHORITY_STATES, type AuthorityState } from './intent-port';

export const INTENT_STATE_DISPLAY_MAP: Readonly<Record<AuthorityState, DisplayState>> = {
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

/** Exhaustiveness guard: every shippable authority state is mapped. */
const _exhaustive: Record<AuthorityState, true> = Object.fromEntries(
  AUTHORITY_STATES.map((state) => [state, true as const])
) as Record<AuthorityState, true>;

export function intentDisplayState(authorityState: AuthorityState): DisplayState {
  return INTENT_STATE_DISPLAY_MAP[authorityState];
}

export function mappingRecordRef(authorityState: AuthorityState): string {
  return `${MAPPING_RECORD_IDS[authorityState]} (${MAPPING_RECORDS_DOCUMENT})`;
}
