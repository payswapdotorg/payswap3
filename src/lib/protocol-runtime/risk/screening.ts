/**
 * RTN-003 — Risk/Compliance Authority: the ScreeningResult lifecycle.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   109-113 (the object, its state machine, and HIT handling):
 *     "ScreeningResult — deterministic outcome of matching subject data
 *      against a screening list version (sanctions, blocked parties).
 *      States: COMPUTED -> terminal(CLEAR | HIT).
 *      HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision is
 *      forbidden for hits."
 *   lines 124-126 (INV-16-1, the input the match is a pure function of):
 *     "INV-16-1 (determinism): evaluation is a pure function of
 *      (rule version, screening list version, subject data hash);
 *      identical inputs always produce the identical recorded outcome."
 *   lines 137-141 (failure semantics — list refreshes are inputs, not
 *   effects):
 *     "Evaluation is internal and deterministic. External list updates
 *      are inputs, not effects; a failed list refresh leaves the prior
 *      version active and records the failure — never a silent guess."
 *   line 146 (the evidence this lifecycle produces):
 *     "SCREENING_COMPUTED (list version, subject hash, outcome)."
 *   lines 151-154 (boundaries):
 *     "It never exports subject data beyond protocol boundaries; list
 *      contents remain configuration data."
 *
 * Design:
 *   - The screening list is VERSIONED configuration data owned inside this
 *     authority's surface: (listId, integer version, entries). Entries are
 *     opaque party digests — exactly the subject-data-hash format — so the
 *     deterministic match is pure equality of the subject data hash against
 *     the version's entries. This is the reading that makes INV-16-1
 *     literal: the outcome is a pure function of (screening list version,
 *     subject data hash) with NO other inputs.
 *   - The lifecycle is materialized exactly: COMPUTED is the initial state
 *     of a computed result; resolving applies the pure match to the terminal
 *     CLEAR or HIT; both terminals are terminal (no transitions out). Every
 *     illegal pair is rejected (conformance tests enumerate ALL pairs).
 *   - A screening id is derived by the kernel identity facility from the
 *     input triple (list id, list version, subject data hash), so identical
 *     inputs always address the identical result — the structural basis of
 *     the store's idempotency (INV-16-1 at the screening level).
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import type { SubjectDataHash } from './subject.ts';

/**
 * The ScreeningResult state machine, verbatim from the spec.
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "States: COMPUTED ->
 * terminal(CLEAR | HIT)."
 */
export const SCREENING_RESULT_STATES: readonly ['COMPUTED', 'CLEAR', 'HIT'] =
  Object.freeze(['COMPUTED', 'CLEAR', 'HIT'] as const);

/**
 * A ScreeningResult state. Source: evidence-risk-compliance.md §2 line 111.
 */
export type ScreeningResultState = (typeof SCREENING_RESULT_STATES)[number];

/**
 * The complete legal-transition table of the ScreeningResult state machine:
 * only COMPUTED -> CLEAR and COMPUTED -> HIT are legal.
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "COMPUTED ->
 * terminal(CLEAR | HIT)."
 */
export const SCREENING_RESULT_TRANSITIONS: Readonly<Record<ScreeningResultState, readonly ScreeningResultState[]>> =
  Object.freeze({
    COMPUTED: Object.freeze(['CLEAR', 'HIT'] as const),
    CLEAR: Object.freeze([] as const),
    HIT: Object.freeze([] as const),
  });

/**
 * One versioned screening list: configuration data owned inside the
 * authority's surface. Entries are party digests in the subject-data-hash
 * format (`sdh.v1.<hex>`); matching is pure equality against the derived
 * subject data hash. Entries are canonicalized at construction (sorted,
 * deduplicated) so every derived representation is stable across runs.
 *
 * Source: evidence-risk-compliance.md §2 lines 109-110 (screening lists —
 * "sanctions, blocked parties"); lines 152-154 (boundary: "list contents
 * remain configuration data" inside the protocol layer).
 */
export interface ScreeningListRecord {
  readonly listId: string;
  readonly version: number;
  readonly entries: readonly string[];
}

/**
 * The screening list version identifier recorded on checks and evidence:
 * `<listId>@v<version>` (e.g. `sanctions@v3`). This is the "screening list
 * version" input of INV-16-1 and part of the "list version" field of
 * SCREENING_COMPUTED.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); line 146 —
 * "SCREENING_COMPUTED (list version, subject hash, outcome)."
 */
export function screeningListVersionId(list: ScreeningListRecord): string {
  return `${list.listId}@v${list.version}`;
}

/**
 * One immutable screening result: the input triple it was computed from and
 * its lifecycle state. `matchedEntry` is present iff the state is HIT (the
 * digest of the matched list entry — proof material).
 *
 * Source: evidence-risk-compliance.md §2 lines 109-113.
 */
export interface ScreeningResultRecord {
  readonly screeningId: string;
  readonly listId: string;
  readonly listVersionId: string;
  readonly listVersion: number;
  readonly subjectDataHash: SubjectDataHash;
  readonly state: ScreeningResultState;
  readonly matchedEntry?: string;
}

/**
 * The pure match of subject data against a screening list version: HIT iff
 * the subject data hash equals a list entry, with the matched entry digest;
 * CLEAR otherwise. Deterministic — a pure function of the exact inputs
 * INV-16-1 names.
 *
 * Source: evidence-risk-compliance.md §2 lines 109-111 — "deterministic
 * outcome of matching subject data against a screening list version";
 * INV-16-1 (lines 124-126).
 */
export function screenSubjectData(
  list: ScreeningListRecord,
  subjectDataHash: SubjectDataHash,
): { readonly outcome: 'CLEAR' | 'HIT'; readonly matchedEntry?: string } {
  const index = list.entries.indexOf(subjectDataHash);
  return index === -1
    ? { outcome: 'CLEAR' }
    : { outcome: 'HIT', matchedEntry: list.entries[index] };
}

function fail(message: string): never {
  throw new TypeError(message);
}

/**
 * Runtime type guard: true iff the value is a ScreeningResultState.
 *
 * Source: evidence-risk-compliance.md §2 line 111.
 */
export function isScreeningResultState(value: unknown): value is ScreeningResultState {
  return typeof value === 'string' && (SCREENING_RESULT_STATES as readonly string[]).includes(value);
}

/**
 * The transition predicate of the ScreeningResult state machine.
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "COMPUTED ->
 * terminal(CLEAR | HIT)."
 */
export function canTransitionScreeningResult(from: ScreeningResultState, to: ScreeningResultState): boolean {
  return SCREENING_RESULT_TRANSITIONS[from].includes(to);
}

/**
 * Construct a screening list version (validating and canonicalizing the
 * entries). Rejects: empty list id; non-integer or < 1 versions; entries
 * that are not non-empty strings. The entries are stored sorted and
 * deduplicated (set semantics, stable order).
 *
 * Source: evidence-risk-compliance.md §2 lines 109-110 (the versioned list
 * input); lines 152-154 (list contents are configuration data).
 */
export function createScreeningList(
  listId: string,
  version: number,
  entries: readonly string[],
): ScreeningListRecord {
  if (typeof listId !== 'string' || listId.length === 0) {
    fail('screening: listId must be a non-empty string');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail(`screening: list version must be an integer >= 1 (got ${version})`);
  }
  if (!Array.isArray(entries)) {
    fail('screening: entries must be an array');
  }
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail(`screening: every entry must be a non-empty string (got ${JSON.stringify(entry)})`);
    }
  }
  const canonical = [...new Set(entries)].sort();
  return { listId, version, entries: canonical };
}

/**
 * Compute a screening result: the initial COMPUTED state, recording the input
 * triple. The terminal outcome is NOT yet applied — resolving (below) is a
 * separate step of the lifecycle.
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "States: COMPUTED ->
 * terminal(CLEAR | HIT)." (COMPUTED is the initial state.)
 */
export function computeScreeningResult(
  list: ScreeningListRecord,
  subjectDataHash: SubjectDataHash,
): ScreeningResultRecord {
  return {
    screeningId: deriveScreeningId(list, subjectDataHash),
    listId: list.listId,
    listVersionId: screeningListVersionId(list),
    listVersion: list.version,
    subjectDataHash,
    state: 'COMPUTED',
  };
}

/**
 * Resolve a COMPUTED screening result to its terminal state by applying the
 * pure match (screenSubjectData). Rejects any already-terminal result (the
 * terminals have no outgoing transitions).
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "COMPUTED ->
 * terminal(CLEAR | HIT)"; INV-16-1 (the terminal is fully determined by the
 * recorded input triple).
 */
export function resolveScreeningResult(
  result: ScreeningResultRecord,
  list: ScreeningListRecord,
): ScreeningResultRecord {
  if (result.state !== 'COMPUTED') {
    throw new TypeError(
      `screening: illegal ScreeningResult transition ${result.state} -> terminal (both CLEAR and HIT are terminal)`,
    );
  }
  if (list.listId !== result.listId || list.version !== result.listVersion) {
    throw new TypeError(
      `screening: resolving requires the exact recorded list version (got ${screeningListVersionId(list)}, recorded ${result.listVersionId})`,
    );
  }
  const match = screenSubjectData(list, result.subjectDataHash);
  return match.outcome === 'HIT'
    ? { ...result, state: 'HIT', matchedEntry: match.matchedEntry }
    : { ...result, state: 'CLEAR' };
}

/**
 * The screening id: derived by the kernel identity facility from the exact
 * input triple (list id, list version, subject data hash). Identical inputs
 * always address the identical screening result — the structural basis of
 * screening idempotency (INV-16-1: identical inputs, identical recorded
 * outcome).
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126).
 */
export function deriveScreeningId(list: ScreeningListRecord, subjectDataHash: SubjectDataHash): string {
  return deriveProtocolId('screening-result', list.listId, list.version, subjectDataHash);
}
