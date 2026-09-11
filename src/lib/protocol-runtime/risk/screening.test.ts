/**
 * RTN-003 — ScreeningResult lifecycle conformance tests.
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   109-113 — "ScreeningResult — deterministic outcome of matching subject
 *   data against a screening list version (sanctions, blocked parties).
 *   States: COMPUTED -> terminal(CLEAR | HIT). HIT creates a MANUAL_REVIEW
 *   ComplianceCheck; auto-decision is forbidden for hits."; INV-16-1
 *   (lines 124-126); the refresh-failure semantics (lines 137-139) are
 *   exercised in the Node evidence harness (store-backed).
 *
 * Evidence produced: every LEGAL transition exercised; every ILLEGAL
 * transition rejected (the full 3x3 pair matrix); pure-match determinism;
 * entry canonicalization; version pinning.
 */
import { describe, expect, test } from 'bun:test';
import {
  SCREENING_RESULT_STATES,
  SCREENING_RESULT_TRANSITIONS,
  canTransitionScreeningResult,
  computeScreeningResult,
  createScreeningList,
  deriveScreeningId,
  isScreeningResultState,
  resolveScreeningResult,
  screenSubjectData,
  screeningListVersionId,
} from './screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from './subject.ts';

const SUBJECT = subjectComplianceData({
  subjectId: 'intent-1',
  subjectKind: 'INTENT',
  moneyFacts: [{ currency: 'USD', amountMinor: 1_000 }],
});
const SUBJECT_HASH = deriveSubjectDataHash(SUBJECT);

function emptyList() {
  return createScreeningList('sanctions', 1, []);
}

function hitList() {
  return createScreeningList('sanctions', 1, [SUBJECT_HASH]);
}

describe('ScreeningResult state machine (conformance: every legal, every illegal)', () => {
  test('the transition table is exactly COMPUTED->CLEAR|HIT, terminals final', () => {
    expect(SCREENING_RESULT_TRANSITIONS.COMPUTED).toEqual(['CLEAR', 'HIT']);
    expect(SCREENING_RESULT_TRANSITIONS.CLEAR).toEqual([]);
    expect(SCREENING_RESULT_TRANSITIONS.HIT).toEqual([]);
  });

  test('every illegal pair is rejected by the predicate (full 3x3 matrix)', () => {
    const legal: string[] = ['COMPUTED>CLEAR', 'COMPUTED>HIT'];
    for (const from of SCREENING_RESULT_STATES) {
      for (const to of SCREENING_RESULT_STATES) {
        expect(canTransitionScreeningResult(from, to)).toBe(legal.includes(`${from}>${to}`));
      }
    }
  });

  test('compute mints the COMPUTED initial state', () => {
    const result = computeScreeningResult(emptyList(), SUBJECT_HASH);
    expect(result.state).toBe('COMPUTED');
    expect(result.listVersionId).toBe('sanctions@v1');
    expect(result.subjectDataHash).toBe(SUBJECT_HASH);
  });

  test('resolve applies the pure match: empty list -> CLEAR terminal', () => {
    const resolved = resolveScreeningResult(computeScreeningResult(emptyList(), SUBJECT_HASH), emptyList());
    expect(resolved.state).toBe('CLEAR');
  });

  test('resolve applies the pure match: listed digest -> HIT terminal with the matched entry', () => {
    const resolved = resolveScreeningResult(computeScreeningResult(hitList(), SUBJECT_HASH), hitList());
    expect(resolved.state).toBe('HIT');
    expect(resolved.matchedEntry).toBe(SUBJECT_HASH);
  });

  test('terminals are terminal: resolving a resolved result is rejected', () => {
    const clear = resolveScreeningResult(computeScreeningResult(emptyList(), SUBJECT_HASH), emptyList());
    expect(() => resolveScreeningResult(clear, emptyList())).toThrow(/terminal/);
    const hit = resolveScreeningResult(computeScreeningResult(hitList(), SUBJECT_HASH), hitList());
    expect(() => resolveScreeningResult(hit, hitList())).toThrow(/terminal/);
  });

  test('resolving requires the exact recorded list version', () => {
    const computed = computeScreeningResult(createScreeningList('sanctions', 2, []), SUBJECT_HASH);
    expect(() => resolveScreeningResult(computed, createScreeningList('sanctions', 3, []))).toThrow(
      /exact recorded list version/,
    );
  });

  test('isScreeningResultState accepts exactly the three states', () => {
    for (const state of SCREENING_RESULT_STATES) {
      expect(isScreeningResultState(state)).toBe(true);
    }
    expect(isScreeningResultState('PENDING')).toBe(false);
    expect(isScreeningResultState(null)).toBe(false);
  });
});

describe('the pure match (deterministic outcome of matching subject data)', () => {
  test('identical inputs always produce the identical outcome', () => {
    for (let round = 0; round < 50; round += 1) {
      const a = screenSubjectData(hitList(), SUBJECT_HASH);
      const b = screenSubjectData(hitList(), SUBJECT_HASH);
      expect(a).toEqual(b);
    }
  });

  test('a hash not in the list is CLEAR; the exact digest is HIT', () => {
    expect(screenSubjectData(emptyList(), SUBJECT_HASH).outcome).toBe('CLEAR');
    expect(screenSubjectData(hitList(), SUBJECT_HASH).outcome).toBe('HIT');
    const otherSubject = subjectComplianceData({
      subjectId: 'intent-2',
      subjectKind: 'INTENT',
      moneyFacts: [{ currency: 'USD', amountMinor: 2_000 }],
    });
    expect(screenSubjectData(hitList(), deriveSubjectDataHash(otherSubject)).outcome).toBe('CLEAR');
  });

  test('the screening id is derived from the exact input triple', () => {
    expect(deriveScreeningId(hitList(), SUBJECT_HASH)).toBe(deriveScreeningId(hitList(), SUBJECT_HASH));
    expect(deriveScreeningId(hitList(), SUBJECT_HASH)).not.toBe(
      deriveScreeningId(createScreeningList('sanctions', 2, [SUBJECT_HASH]), SUBJECT_HASH),
    );
    expect(deriveScreeningId(hitList(), SUBJECT_HASH)).toMatch(/^pid\.v1\.[0-9a-f]{64}$/);
  });
});

describe('screening list construction (versioned configuration data)', () => {
  test('entries are canonicalized: sorted, deduplicated', () => {
    const list = createScreeningList('sanctions', 3, ['sdh.v1.bbb', 'sdh.v1.aaa', 'sdh.v1.bbb']);
    expect(list.entries).toEqual(['sdh.v1.aaa', 'sdh.v1.bbb']);
  });

  test('malformed lists are rejected deterministically', () => {
    expect(() => createScreeningList('', 1, [])).toThrow(/listId/);
    expect(() => createScreeningList('sanctions', 0, [])).toThrow(/integer >= 1/);
    expect(() => createScreeningList('sanctions', 1.5, [])).toThrow(/integer >= 1/);
    expect(() => createScreeningList('sanctions', 1, [''])).toThrow(/non-empty string/);
    expect(() => createScreeningList('sanctions', 1, [42 as never])).toThrow(/non-empty string/);
  });

  test('the list version id is <listId>@v<version>', () => {
    expect(screeningListVersionId(createScreeningList('sanctions', 7, []))).toBe('sanctions@v7');
  });
});
