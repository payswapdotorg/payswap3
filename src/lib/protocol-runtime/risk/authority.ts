/**
 * RTN-003 — Risk/Compliance Authority: the composed authority service.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16:
 *     lines 117-119 (the owning authority):
 *       "Risk/Compliance Authority (protocol layer, area 16) owns rule
 *        semantics, check lifecycle, and screening evaluation. List
 *        providers and reviewers are inputs; decisions become durable
 *        protocol records here."
 *     lines 91-93 (the area's only power):
 *       "Compliance decisions block or allow progression; they never
 *        themselves move money."
 *     lines 124-134 (INV-16-1 determinism; INV-16-2 integers; INV-16-4
 *     idempotency):
 *       "evaluation is a pure function of (rule version, screening list
 *        version, subject data hash)" / "check ids are keyed by (subject id,
 *        rule set version); re-evaluation returns the recorded result."
 *     lines 129-131 (INV-16-3 gating):
 *       "state transitions gated by compliance (intent AUTHORIZATION,
 *        capability ACTIVATION) cannot complete without a terminal APPROVED
 *        record for the subject."
 *     lines 137-141 (failure semantics):
 *       "a failed list refresh leaves the prior version active and records
 *        the failure — never a silent guess. ... undecided checks block the
 *        gated transition until resolved."
 *     lines 144-147 (evidence produced — the complete named set):
 *       CHECK_DECIDED / SCREENING_COMPUTED / REVIEW_RECORDED.
 *   spec/architecture/v0.1/README.md §3 GC-5 (evidence committed
 *   atomically with the state transition).
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15 lines
 *   62-64 (the synchronous coupling this service honors):
 *     "an operation is not committed until its record is written. A failed
 *      write fails the operation."
 *
 * Design:
 *   - The service composes the pure state machines with the risk-owned
 *     store and the kernel-declared EvidenceSubmission port (the test
 *     double in tests; the real RTN-002 log in RTN-012's integration).
 *   - Decision operations are SUBMIT-THEN-PERSIST: the evidence record is
 *     submitted first; a failed submission throws and nothing is persisted
 *     ("A failed write fails the operation").
 *   - Idempotency: evaluation is keyed by the derived check id
 *     (INV-16-4) — re-evaluation of the same (subject id, rule set
 *     version) returns the recorded check without new records; screening is
 *     keyed by the input triple (INV-16-1) — re-computation returns the
 *     recorded result.
 *   - The gate is a pure read over the store (no evidence: reads are not
 *     consequential operations).
 *   - Rule lifecycle operations persist but emit NO A15 evidence: the A16
 *     "Evidence produced" set names exactly CHECK_DECIDED,
 *     SCREENING_COMPUTED, and REVIEW_RECORDED, and INV-15-1 enumerates
 *     areas 1-14 and 18-24 for consequential state transitions — risk-rule
 *     configuration is none of these. No RULE_* operation type is invented.
 */

import type { EvidenceSubmission } from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime } from '../kernel/time.ts';
import type { ComplianceCheckRecord } from './evaluation.ts';
import { evaluateComplianceCheck } from './evaluation.ts';
import type { ComplianceReviewRecord } from './evaluation.ts';
import {
  decideComplianceCheck,
  recordComplianceReview,
  routeComplianceCheckForReview,
  transitionComplianceCheck,
} from './check.ts';
import type { ComplianceGateVerdict, GatedTransitionKind } from './gate.ts';
import { evaluateComplianceGate } from './gate.ts';
import {
  checkDecidedEvidence,
  reviewRecordedEvidence,
  screeningComputedEvidence,
  submitRiskEvidence,
} from './evidence.ts';
import {
  activateRiskRule,
  authorRiskRule,
  publishRiskRuleVersion,
  retireRiskRule,
  reviseRiskRuleDefinition,
} from './rule.ts';
import type { RiskRuleDefinition, RiskRuleRecord } from './rule.ts';
import {
  computeScreeningResult,
  createScreeningList,
  resolveScreeningResult,
} from './screening.ts';
import type { ScreeningListRecord, ScreeningResultRecord } from './screening.ts';
import {
  findComplianceCheck,
  findLatestScreeningList,
  findRiskRule,
  findRiskRuleDraft,
  findScreeningResult,
  insertComplianceCheck,
  insertRiskRuleDraft,
  insertScreeningList,
  insertScreeningResult,
  listComplianceChecksForSubject,
  listRiskRulesInState,
  nextRiskRuleVersion,
  publishRiskRuleRow,
  recordScreeningListRefreshFailure,
  saveComplianceCheckState,
  saveRiskRuleDraftDefinition,
  saveRiskRuleState,
  saveScreeningResultState,
} from './store.ts';
import type { RiskStoreOptions } from './store.ts';
import { openRiskStore } from './store.ts';
import { deriveSubjectDataHash } from './subject.ts';
import type { SubjectComplianceData } from './subject.ts';

/**
 * Options for creating the authority: the evidence port (the kernel-declared
 * type — the test double here, the RTN-002 log in RTN-012) and the
 * risk-store options (own database + owned migrations).
 *
 * Source: the wave evidence discipline (WAVE README.md line 39); the
 * per-domain persistence convention.
 */
export interface RiskComplianceAuthorityOptions {
  readonly evidence: EvidenceSubmission;
  readonly store?: RiskStoreOptions;
}

function assertWhen(when: unknown): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError('risk authority: when must be a well-formed ProtocolTime');
  }
}

/**
 * The composed Risk and Compliance Authority: rule semantics, check
 * lifecycle, and screening evaluation over the risk-owned store, with every
 * consequential operation's evidence submitted through the port
 * synchronously (submit-then-persist). Its only power is gating and
 * recording — it never creates obligations or rail operations.
 *
 * Source: evidence-risk-compliance.md §2 lines 117-119 (the owning
 * authority), lines 91-93 (the power boundary), lines 144-147 (evidence).
 */
export interface RiskComplianceAuthority {
  /** Close the underlying store connection. */
  close(): void;

  // --- Rule lifecycle (A16 lines 98-100) --------------------------------

  /** Author a new rule version (AUTHORED draft; version unassigned). */
  authorRule(ruleId: string, definition: RiskRuleDefinition, when: ProtocolTime): RiskRuleRecord;

  /** Revise an AUTHORED draft's definition (immutable after publish). */
  reviseRule(ruleId: string, definition: RiskRuleDefinition): RiskRuleRecord;

  /** Publish the AUTHORED draft (AUTHORED -> VERSIONED; version assigned). */
  publishRule(ruleId: string, when: ProtocolTime): RiskRuleRecord;

  /** Activate a VERSIONED rule (VERSIONED -> ACTIVE). */
  activateRule(ruleId: string, version: number, when: ProtocolTime): RiskRuleRecord;

  /** Retire an ACTIVE rule (ACTIVE -> RETIRED; terminal for the version). */
  retireRule(ruleId: string, version: number, when: ProtocolTime): RiskRuleRecord;

  /** The rule versions currently ACTIVE (the live evaluation set). */
  activeRules(): readonly RiskRuleRecord[];

  // --- Screening lists (A16 lines 109-110, 137-139) ---------------------

  /**
   * Register a screening list version. A failed registration (invalid
   * input or a re-registered version) RECORDS the refresh failure and
   * throws — the prior version stays active; never a silent guess.
   */
  registerScreeningList(
    input: { readonly listId: string; readonly version: number; readonly entries: readonly string[] },
    when: ProtocolTime,
  ): ScreeningListRecord;

  /** The latest registered version of a list (what stays active on failure). */
  latestScreeningList(listId: string): ScreeningListRecord | undefined;

  // --- Screening results (A16 lines 109-113, 146) ------------------------

  /**
   * Screen a subject against a list's latest version: COMPUTED, resolved to
   * CLEAR | HIT, persisted, and (on first resolution of the input triple)
   * evidenced with SCREENING_COMPUTED. Idempotent per (list id, list
   * version, subject data hash).
   */
  screenSubject(subject: SubjectComplianceData, listId: string, when: ProtocolTime): Promise<ScreeningResultRecord>;

  // --- Compliance checks (A16 lines 102-107, 145) ------------------------

  /**
   * Evaluate and record a compliance check for a subject under the current
   * ACTIVE rule set and a list's latest version: the pure evaluation, the
   * derived check id, and the EVALUATED-state record. Idempotent per
   * INV-16-4: re-evaluation of the same (subject id, rule set version)
   * returns the recorded check.
   */
  evaluateAndRecordCheck(
    subject: SubjectComplianceData,
    listId: string,
    when: ProtocolTime,
  ): Promise<ComplianceCheckRecord>;

  /**
   * Apply a check's recorded deterministic auto-decision (EVALUATED ->
   * APPROVED | DENIED), emitting CHECK_DECIDED. Rejected — deterministically
   * — for checks whose recorded evaluation is MANDATORY_REVIEW (auto-decision
   * is forbidden for hits) and for already-decided checks.
   */
  decideCheck(checkId: string, when: ProtocolTime): Promise<ComplianceCheckRecord>;

  /**
   * Route a review-required check to MANUAL_REVIEW (the HIT/RULE_REVIEW
   * handling), emitting CHECK_DECIDED with outcome MANUAL_REVIEW.
   */
  routeCheckToReview(checkId: string, when: ProtocolTime): Promise<ComplianceCheckRecord>;

  /**
   * Record a reviewed decision on a MANUAL_REVIEW check (MANUAL_REVIEW ->
   * APPROVED | DENIED), attaching the review record and emitting
   * REVIEW_RECORDED (reviewer authority, decision, rationale).
   */
  recordCheckReview(
    checkId: string,
    review: { readonly reviewerAuthority: string; readonly decision: 'APPROVED' | 'DENIED'; readonly rationale: string },
    when: ProtocolTime,
  ): Promise<ComplianceCheckRecord>;

  /** Read a check by id. */
  findCheck(checkId: string): ComplianceCheckRecord | undefined;

  // --- Gate (INV-16-3) ----------------------------------------------------

  /**
   * The gate other authorities call before completing a gated transition
   * (intent AUTHORIZATION, capability ACTIVATION): allowed only on a
   * terminal APPROVED record for the subject. A pure read.
   */
  checkGate(gateKind: GatedTransitionKind, subjectId: string): ComplianceGateVerdict;
}

function ruleNotFound(ruleId: string): TypeError {
  return new TypeError(`risk authority: rule ${ruleId} draft not found`);
}

function checkNotFound(checkId: string): TypeError {
  return new TypeError(`risk authority: compliance check ${checkId} not found`);
}

/**
 * Create the composed Risk and Compliance Authority over the risk-owned
 * store and the EvidenceSubmission port.
 *
 * Source: evidence-risk-compliance.md §2 lines 117-119; the per-domain
 * persistence convention; the wave evidence discipline.
 */
export function createRiskComplianceAuthority(
  options: RiskComplianceAuthorityOptions,
): RiskComplianceAuthority {
  const db = openRiskStore(options.store ?? {});
  const evidence = options.evidence;

  return {
    close() {
      db.close();
    },

    authorRule(ruleId, definition, when) {
      assertWhen(when);
      const draft = authorRiskRule(ruleId, definition);
      insertRiskRuleDraft(db, draft, when);
      return draft;
    },

    reviseRule(ruleId, definition) {
      const draft = findRiskRuleDraft(db, ruleId);
      if (draft === undefined) {
        throw ruleNotFound(ruleId);
      }
      const result = reviseRiskRuleDefinition(draft, definition);
      if (!result.ok) {
        throw new TypeError(`risk authority: ${result.problem}`);
      }
      saveRiskRuleDraftDefinition(db, ruleId, result.rule.definition);
      return result.rule;
    },

    publishRule(ruleId, when) {
      assertWhen(when);
      const draft = findRiskRuleDraft(db, ruleId);
      if (draft === undefined) {
        throw ruleNotFound(ruleId);
      }
      const version = nextRiskRuleVersion(db, ruleId);
      const result = publishRiskRuleVersion(draft, version);
      if (!result.ok) {
        throw new TypeError(`risk authority: ${result.problem}`);
      }
      publishRiskRuleRow(db, ruleId, result.rule, when);
      return result.rule;
    },

    activateRule(ruleId, version, when) {
      assertWhen(when);
      const rule = findRiskRule(db, ruleId, version);
      if (rule === undefined) {
        throw new TypeError(`risk authority: rule ${ruleId} v${version} not found`);
      }
      const result = activateRiskRule(rule);
      if (!result.ok) {
        throw new TypeError(`risk authority: ${result.problem}`);
      }
      saveRiskRuleState(db, result.rule, when);
      return result.rule;
    },

    retireRule(ruleId, version, when) {
      assertWhen(when);
      const rule = findRiskRule(db, ruleId, version);
      if (rule === undefined) {
        throw new TypeError(`risk authority: rule ${ruleId} v${version} not found`);
      }
      const result = retireRiskRule(rule);
      if (!result.ok) {
        throw new TypeError(`risk authority: ${result.problem}`);
      }
      saveRiskRuleState(db, result.rule, when);
      return result.rule;
    },

    activeRules() {
      return listRiskRulesInState(db, 'ACTIVE');
    },

    registerScreeningList(input, when) {
      assertWhen(when);
      let list: ScreeningListRecord;
      try {
        list = createScreeningList(input.listId, input.version, input.entries);
      } catch (error) {
        // A failed refresh: record the failure, prior version stays active,
        // never a silent guess (A16 lines 137-139).
        recordScreeningListRefreshFailure(
          db,
          { listId: input.listId, reason: error instanceof Error ? error.message : String(error) },
          when,
        );
        throw error;
      }
      try {
        insertScreeningList(db, list, when);
      } catch (error) {
        recordScreeningListRefreshFailure(
          db,
          { listId: input.listId, reason: error instanceof Error ? error.message : String(error) },
          when,
        );
        throw error;
      }
      return list;
    },

    latestScreeningList(listId) {
      return findLatestScreeningList(db, listId);
    },

    async screenSubject(subject, listId, when) {
      assertWhen(when);
      const list = findLatestScreeningList(db, listId);
      if (list === undefined) {
        throw new TypeError(`risk authority: screening list ${listId} has no registered version`);
      }
      const subjectDataHash = deriveSubjectDataHash(subject);
      const existing = findScreeningResult(db, list.listId, list.version, subjectDataHash) as
        | ScreeningResultRecord
        | undefined;
      if (existing !== undefined && existing.state !== 'COMPUTED') {
        return existing; // idempotent: the recorded outcome of the input triple
      }
      const computed = existing ?? computeScreeningResult(list, subjectDataHash);
      if (existing === undefined) {
        insertScreeningResult(db, computed, when);
      }
      const resolved = resolveScreeningResult(computed, list);
      // Submit-then-persist: a failed write fails the operation.
      await submitRiskEvidence(evidence, screeningComputedEvidence(resolved, subject.subjectId, when));
      saveScreeningResultState(db, resolved, when);
      return resolved;
    },

    async evaluateAndRecordCheck(subject, listId, when) {
      assertWhen(when);
      const rules = listRiskRulesInState(db, 'ACTIVE');
      const list = findLatestScreeningList(db, listId);
      if (list === undefined) {
        throw new TypeError(`risk authority: screening list ${listId} has no registered version`);
      }
      const evaluated = evaluateComplianceCheck({ rules, screeningList: list, subject, evaluatedAt: when });
      // INV-16-4: check ids keyed by (subject id, rule set version);
      // re-evaluation returns the recorded result.
      const existing = findComplianceCheck(db, evaluated.checkId);
      if (existing !== undefined) {
        return existing;
      }
      // The evaluation's screening computation is itself a screening of the
      // input triple: record it (idempotently) and evidence it on first
      // resolution.
      const subjectDataHash = deriveSubjectDataHash(subject);
      const existingScreening = findScreeningResult(db, list.listId, list.version, subjectDataHash) as
        | ScreeningResultRecord
        | undefined;
      if (existingScreening === undefined || existingScreening.state === 'COMPUTED') {
        const computed = existingScreening ?? computeScreeningResult(list, subjectDataHash);
        if (existingScreening === undefined) {
          insertScreeningResult(db, computed, when);
        }
        const resolved = resolveScreeningResult(computed, list);
        await submitRiskEvidence(evidence, screeningComputedEvidence(resolved, subject.subjectId, when));
        saveScreeningResultState(db, resolved, when);
      }
      insertComplianceCheck(db, evaluated);
      return evaluated;
    },

    async decideCheck(checkId, when) {
      assertWhen(when);
      const check = findComplianceCheck(db, checkId);
      if (check === undefined) {
        throw checkNotFound(checkId);
      }
      if (check.evaluation.outcome === 'MANDATORY_REVIEW') {
        throw new TypeError(
          `risk authority: auto-decision is forbidden for check ${checkId} — the recorded evaluation is MANDATORY_REVIEW (reason ${check.evaluation.reasonCode}); route it to MANUAL_REVIEW`,
        );
      }
      const decided = decideComplianceCheck(
        { ...check, __checkFlavor: 'AUTO' } as Parameters<typeof decideComplianceCheck>[0],
        when,
      );
      await submitRiskEvidence(evidence, checkDecidedEvidence(decided, when));
      saveComplianceCheckState(db, decided);
      return decided;
    },

    async routeCheckToReview(checkId, when) {
      assertWhen(when);
      const check = findComplianceCheck(db, checkId);
      if (check === undefined) {
        throw checkNotFound(checkId);
      }
      const routed = routeComplianceCheckForReview(
        { ...check, __checkFlavor: 'REVIEW' } as Parameters<typeof routeComplianceCheckForReview>[0],
        when,
      );
      await submitRiskEvidence(evidence, checkDecidedEvidence(routed, when));
      saveComplianceCheckState(db, routed);
      return routed;
    },

    async recordCheckReview(checkId, review, when) {
      assertWhen(when);
      const check = findComplianceCheck(db, checkId);
      if (check === undefined) {
        throw checkNotFound(checkId);
      }
      const reviewed = recordComplianceReview(
        check,
        { ...review, reviewedAt: when } as Omit<ComplianceReviewRecord, 'reviewedAt'>,
        when,
      );
      await submitRiskEvidence(evidence, reviewRecordedEvidence(reviewed, when));
      saveComplianceCheckState(db, reviewed);
      return reviewed;
    },

    findCheck(checkId) {
      return findComplianceCheck(db, checkId);
    },

    checkGate(gateKind, subjectId) {
      return evaluateComplianceGate(listComplianceChecksForSubject(db, subjectId), gateKind, subjectId);
    },
  };
}
