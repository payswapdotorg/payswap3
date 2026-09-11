/**
 * RTN-003 — Risk/Compliance Authority: the checked subject and its data hash.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   102-103 (the check's subject):
 *     "ComplianceCheck — one evaluation instance tied to a subject
 *      (intent, capability registration, merchant onboarding)."
 *   lines 109-111 (the screening input):
 *     "ScreeningResult — deterministic outcome of matching subject data
 *      against a screening list version (sanctions, blocked parties)."
 *   lines 124-126 (INV-16-1, the hash's role in determinism):
 *     "INV-16-1 (determinism): evaluation is a pure function of
 *      (rule version, screening list version, subject data hash);
 *      identical inputs always produce the identical recorded outcome."
 *   lines 127-128 (INV-16-2, the integer discipline of the hashed facts):
 *     "INV-16-2 (no float risk): all threshold comparisons use integer
 *      Money or integer counts."
 *   line 146 (the hash's role in evidence):
 *     "SCREENING_COMPUTED (list version, subject hash, outcome)."
 *   spec/architecture/v0.1/README.md §3 GC-1, lines 39-43 (integer
 *   arithmetic; "Re-running any computation on identical inputs yields
 *   identical outputs").
 *
 * Design:
 *   - A subject of a compliance check is one of the three named kinds:
 *     an intent (gated at AUTHORIZATION, INV-16-3), a capability
 *     registration (gated at ACTIVATION, INV-16-3), or a merchant
 *     onboarding. The kind is carried on every check so a gate can never
 *     authorize a transition with a check recorded for a different kind of
 *     subject (see gate.ts).
 *   - The subject DATA is the evaluation input: integer Money facts
 *     (kernel Money values — amountMinor integers keyed by currency) and
 *     integer counts. Floats are rejected at construction (INV-16-2: the
 *     threshold comparisons run over these facts and must be integer-only).
 *   - The subject data hash is a deterministic sha256 fingerprint over a
 *     canonical encoding of the subject facts — the exact "subject data
 *     hash" of INV-16-1 and the "subject hash" of SCREENING_COMPUTED. It
 *     identifies the evaluated data in the pure-equality screening match
 *     (see screening.ts) and is recorded on every check and screening
 *     result as proof material.
 *   - Canonical encoding: kind+id plus each fact, sorted (money facts by
 *     currency code-point, count facts by name), length-prefixed, exactly
 *     the kernel's canonicalDerivationInput discipline (unambiguous
 *     ('ab','c') vs ('a','bc')); the hash prefix `sdh.v1.<hex>` makes the
 *     format version detectable in stored values, mirroring the kernel's
 *     derivation prefixes.
 */

import { createHash } from 'node:crypto';
import { canonicalDerivationInput } from '../kernel/identity.ts';

/**
 * Version of the subject-data-hash input format. Bump on any change to the
 * canonical encoding; hashed values carry the version in their prefix so
 * mixed-version values are detectable in storage.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126) — the subject
 * data hash must be a stable, comparable pure derivation ("identical inputs
 * always produce the identical recorded outcome").
 */
export const SUBJECT_DATA_HASH_FORMAT_VERSION = 1;

/**
 * The kind of subject a ComplianceCheck is tied to. Exactly the three the
 * spec names — nothing else is representable.
 *
 * Source: evidence-risk-compliance.md §2 lines 102-103 — "one evaluation
 * instance tied to a subject (intent, capability registration, merchant
 * onboarding)."
 */
export const SUBJECT_KINDS: readonly ['INTENT', 'CAPABILITY_REGISTRATION', 'MERCHANT_ONBOARDING'] =
  Object.freeze(['INTENT', 'CAPABILITY_REGISTRATION', 'MERCHANT_ONBOARDING'] as const);

/**
 * A checked-subject kind. Source: evidence-risk-compliance.md §2 lines
 * 102-103 (quoted in SUBJECT_KINDS).
 */
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * One integer Money fact about a subject: an amount in minor units of a
 * 3-letter currency. (Kernel Money minus the scale: the scale is a property
 * of Money construction; a fact references the currency's integer amount.)
 *
 * Source: INV-16-2 (evidence-risk-compliance.md lines 127-128) — "all
 * threshold comparisons use integer Money or integer counts"; core.md §0
 * lines 11-12 — "Money: signed integer minor units, 3-letter currency
 * code".
 */
export interface SubjectMoneyFact {
  readonly currency: string;
  readonly amountMinor: number;
}

/**
 * One integer count fact about a subject (e.g. a velocity measure).
 *
 * Source: INV-16-2 (evidence-risk-compliance.md lines 127-128) — "integer
 * counts".
 */
export interface SubjectCountFact {
  readonly name: string;
  readonly count: number;
}

/**
 * The data of a checked subject: identity, kind, and the integer facts risk
 * rules compare against. Immutable value object.
 *
 * Source: evidence-risk-compliance.md §2 lines 102-111 (the subject of a
 * check; the subject data matched against a screening list); INV-16-2
 * (integer facts only).
 */
export interface SubjectComplianceData {
  readonly subjectId: string;
  readonly subjectKind: SubjectKind;
  readonly moneyFacts: readonly SubjectMoneyFact[];
  readonly countFacts: readonly SubjectCountFact[];
}

/**
 * A deterministically derived subject data hash: `sdh.v1.<sha256-hex>`.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126 — the "subject
 * data hash" input of the pure evaluation); line 146 (the "subject hash"
 * recorded by SCREENING_COMPUTED).
 */
export type SubjectDataHash = string & { readonly __riskSubjectDataHash: 'subject-data-hash' };

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function fail(message: string): never {
  throw new TypeError(message);
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number') {
    fail(`subject: ${label} must be a number (got ${typeof value})`);
  }
  if (!Number.isInteger(value)) {
    fail(`subject: ${label} must be an integer — floats are forbidden by INV-16-2 (got ${value})`);
  }
  if (!Number.isSafeInteger(value)) {
    fail(`subject: ${label} must be a safe integer (got ${value})`);
  }
}

/**
 * Construct subject compliance data. Rejects (deterministically, via
 * TypeError): empty subject id; unknown subject kind; malformed currencies;
 * float or unsafe-integer amounts/counts; duplicate currencies or count
 * names; empty fact names. Money and count facts are stored in canonical
 * ascending order so every derived representation is stable across runs
 * (GC-1).
 *
 * Source: INV-16-2 (integer facts — evidence-risk-compliance.md lines
 * 127-128); GC-1 (README.md §3 lines 39-43).
 */
export function subjectComplianceData(input: {
  readonly subjectId: string;
  readonly subjectKind: SubjectKind;
  readonly moneyFacts?: readonly SubjectMoneyFact[];
  readonly countFacts?: readonly SubjectCountFact[];
}): SubjectComplianceData {
  if (typeof input.subjectId !== 'string' || input.subjectId.length === 0) {
    fail('subject: subjectId must be a non-empty string');
  }
  if (!(SUBJECT_KINDS as readonly string[]).includes(input.subjectKind)) {
    fail(`subject: subjectKind must be one of ${SUBJECT_KINDS.join(', ')} (got ${JSON.stringify(input.subjectKind)})`);
  }
  const moneyFacts = [...(input.moneyFacts ?? [])];
  const seenCurrencies = new Set<string>();
  for (const fact of moneyFacts) {
    if (fact === null || typeof fact !== 'object') {
      fail('subject: each money fact must be an object');
    }
    if (typeof fact.currency !== 'string' || !CURRENCY_CODE_PATTERN.test(fact.currency)) {
      fail(`subject: money fact currency must be exactly 3 uppercase letters (got ${JSON.stringify(fact.currency)})`);
    }
    assertInteger(fact.amountMinor, `money fact amountMinor for ${fact.currency}`);
    if (seenCurrencies.has(fact.currency)) {
      fail(`subject: duplicate money fact for ${fact.currency} (one fact per currency)`);
    }
    seenCurrencies.add(fact.currency);
  }
  moneyFacts.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));

  const countFacts = [...(input.countFacts ?? [])];
  const seenNames = new Set<string>();
  for (const fact of countFacts) {
    if (fact === null || typeof fact !== 'object') {
      fail('subject: each count fact must be an object');
    }
    if (typeof fact.name !== 'string' || fact.name.length === 0) {
      fail(`subject: count fact name must be a non-empty string (got ${JSON.stringify(fact.name)})`);
    }
    assertInteger(fact.count, `count fact ${fact.name}`);
    if (seenNames.has(fact.name)) {
      fail(`subject: duplicate count fact ${fact.name} (one fact per name)`);
    }
    seenNames.add(fact.name);
  }
  countFacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    subjectId: input.subjectId,
    subjectKind: input.subjectKind,
    moneyFacts,
    countFacts,
  };
}

/**
 * The canonical encoding of one subject's data: the exact bytes the hash is
 * taken over. Length-prefixed parts in fixed order (kind, id, then money
 * facts currency-ascending, then count facts name-ascending) — unambiguous
 * and version-stable.
 *
 * Source: INV-16-1 (the subject data hash is a pure-function input — it
 * must be a canonical, comparable encoding).
 */
export function canonicalSubjectData(subject: SubjectComplianceData): string {
  const parts: (string | number)[] = [subject.subjectKind, subject.subjectId];
  for (const fact of subject.moneyFacts) {
    parts.push(fact.currency, fact.amountMinor);
  }
  for (const fact of subject.countFacts) {
    parts.push(fact.name, fact.count);
  }
  return `v${SUBJECT_DATA_HASH_FORMAT_VERSION}|${canonicalDerivationInput(parts)}`;
}

/**
 * Derive the subject data hash: sha256 over the canonical encoding, with the
 * format version in the prefix (`sdh.v1.<hex>`). Identical subject data
 * always yields the identical hash; any data difference yields a different
 * hash. This is the "subject data hash" of INV-16-1 and the "subject hash"
 * of SCREENING_COMPUTED, and the pure-equality match input of screening.
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); line 146;
 * lines 109-111 (screening matches "subject data against a screening list
 * version").
 */
export function deriveSubjectDataHash(subject: SubjectComplianceData): SubjectDataHash {
  const hex = createHash('sha256').update(canonicalSubjectData(subject), 'utf8').digest('hex');
  return `sdh.v${SUBJECT_DATA_HASH_FORMAT_VERSION}.${hex}` as SubjectDataHash;
}

/**
 * Runtime type guard: true iff the value is a subject data hash minted at
 * the current format version.
 *
 * Source: INV-16-1 (version-detectable derivation inputs — same discipline
 * as the kernel's derived-id prefixes).
 */
export function isSubjectDataHash(value: unknown): value is SubjectDataHash {
  return typeof value === 'string' && value.startsWith(`sdh.v${SUBJECT_DATA_HASH_FORMAT_VERSION}.`);
}

/**
 * Runtime type guard: true iff the value is a member of the subject-kind
 * vocabulary.
 *
 * Source: evidence-risk-compliance.md §2 lines 102-103 (the closed subject
 * list).
 */
export function isSubjectKind(value: unknown): value is SubjectKind {
  return typeof value === 'string' && (SUBJECT_KINDS as readonly string[]).includes(value);
}
