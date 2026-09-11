/**
 * RTN-005 — Fulfillment Policy Authority: the composed single-writer
 * command surface for area 2 (A02).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §2 Area 2:
 *   lines 97-100 (FulfillmentPolicy — versioned, immutable, attached at
 *   authorization, fixed per intent):
 *     "FulfillmentPolicy — versioned, immutable policy document attached to
 *      an intent at authorization time.
 *      Lifecycle: AUTHORED -> VERSIONED -> ATTACHED. No further state
 *      changes; a policy attached to an intent is fixed for that intent."
 *   lines 102-107 (PolicyEvaluation — the deterministic result and its
 *     machine).
 *   lines 110-111 (owning authority):
 *     "Policy Authority (protocol layer, area 2) owns policy semantics and
 *      versioning. Intent Authority owns the attachment decision."
 *   lines 115-123 (INV-2-1/INV-2-2/INV-2-3):
 *     "INV-2-1 (financial correctness): cost ceilings are Money values;
 *      policy comparisons are integer comparisons. Evaluation is a pure
 *      function of (policy version, intent terms, capability snapshot).
 *      INV-2-2 (concurrency): the capability snapshot id used for
 *      evaluation is recorded; re-evaluation with the same snapshot yields
 *      the same result.
 *      INV-2-3 (idempotency): one policy evaluation id per (intent,
 *      policy version, snapshot id); duplicate requests return the
 *      recorded evaluation."
 *   lines 127-130 (failure semantics — POLICY_UNSATISFIABLE routes the
 *     intent to FAILED; recovery is a new policy version on a new intent).
 *   lines 134-135 (evidence produced — through the REAL A15 log).
 *   lines 139-142 (boundaries — policies never create reservations,
 *   obligations, or rail operations; "Depends on area 3 for the capability
 *   snapshot format" — the snapshot arrives as a VALUE, no dependency on
 *   the capability authority).
 *
 * Command discipline:
 *   - author (AUTHORED) and publish (VERSIONED) persist policy
 *     configuration and emit NO evidence — A02's named set is exactly
 *     {POLICY_ATTACHED, POLICY_EVALUATED} (the RTN-003 rule-lifecycle
 *     precedent: an area's named evidence set is exhaustive; no RULE_* or
 *     POLICY_AUTHORED type exists in the spec, none is invented).
 *   - attach (VERSIONED -> ATTACHED) emits POLICY_ATTACHED; the attachment
 *     is 1:1 — a policy attaches to exactly one intent, and an intent
 *     carries at most one attached policy ("a policy attached to an intent
 *     is fixed for that intent").
 *   - evaluate runs the PURE function (evaluation.ts), records the
 *     evaluation with the derived id (INV-2-3: one evaluation per (intent,
 *     policy version, snapshot id) — duplicate requests return the
 *     recorded evaluation), records the snapshot id (INV-2-2), and emits
 *     POLICY_EVALUATED (both outcomes — the satisfiable result and the
 *     POLICY_UNSATISFIABLE failure).
 *   - consume (EVALUATED -> CONSUMED) persists the machine's terminal for
 *     the routing compiler (area 4) and emits NO evidence (not in the named
 *     set — recorded in CONTRACT-REVIEW.md).
 *   - Every consequential operation submits its GC-5 evidence record FIRST
 *     (awaited) and commits state only after the write succeeds ("A failed
 *     write fails the operation", A15 lines 62-64).
 *   - Domain rejections are typed values, never thrown; input-shape
 *     violations throw TypeError (kernel convention).
 *
 * State layer (recorded in CONTRACT-REVIEW.md): in-process single writer —
 * the RTN-002 in-process-object-store precedent. The durable side is
 * persistence.ts + migrations/.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import {
  evaluateFulfillmentPolicy,
  fulfillmentPolicyDefinition,
  policyEvaluationResultHash,
} from './evaluation.ts';
import {
  policyAttachedEvidence,
  policyEvaluatedEvidence,
  submitPolicyEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import { transitionFulfillmentPolicy, transitionPolicyEvaluation } from './state-machine.ts';
import type {
  FulfillmentPolicyDefinition,
  FulfillmentPolicyRecord,
  IntentTerms,
  PolicyCommandResult,
  PolicyEvaluationRecord,
} from './types.ts';
import type { CapabilitySnapshot } from '../capability/types.ts';

/**
 * Constructor dependencies for the Policy Authority.
 *
 * Source: the wave evidence discipline (the REAL RTN-002 log through the
 * kernel port); the rails wallClock-injection convention.
 */
export interface PolicyAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * The Policy Authority: sole writer of policy and evaluation state.
 * Commands: author, publish, attach (1:1, fixed per intent), evaluate (the
 * pure INV-2-1 function, idempotent per (intent, policy version, snapshot
 * id)), consume.
 *
 * Source: core.md lines 110-111 (owning authority); lines 97-107 (the
 * objects); INV-2-1/2-2/2-3 (lines 115-123).
 */
export class PolicyAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly policies = new Map<string, FulfillmentPolicyRecord>();
  private readonly attachedByIntent = new Map<string, string>();
  private readonly evaluations = new Map<string, PolicyEvaluationRecord>();
  private sequence = 0;

  constructor(deps: PolicyAuthorityDeps) {
    if (deps.evidence === null || typeof deps.evidence !== 'object' || typeof deps.evidence.submit !== 'function') {
      throw new TypeError('policy authority: deps.evidence must be an EvidenceSubmission port');
    }
    this.evidence = deps.evidence;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.sequence, this.wallClock());
    this.sequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Policy lifecycle (AUTHORED -> VERSIONED -> ATTACHED)
  // -------------------------------------------------------------------------

  /**
   * Author a policy: the AUTHORED draft with its definition (version
   * unassigned — version 0, assigned at publish). No evidence (the named
   * set is exhaustive; the RTN-003 rule-lifecycle precedent).
   *
   * Source: core.md lines 98-99 ("AUTHORED"); lines 134-135 (the named
   * set).
   */
  async authorPolicy(
    policyId: string,
    definition: FulfillmentPolicyDefinition,
  ): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> {
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new TypeError('policy authority: policyId must be a non-empty string');
    }
    const canonical = fulfillmentPolicyDefinition(definition);
    return this.serializer.run(`policy:${policyId}`, async (): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> => {
      if (this.policies.has(policyId)) {
        return {
          ok: false,
          code: 'ILLEGAL_TRANSITION',
          problem: `policy authority: policy ${policyId} is already recorded (one draft per policy identity; recovery is a new policy id)`,
        };
      }
      const when = this.nextTime();
      const record: FulfillmentPolicyRecord = deepFreeze({
        policyId,
        version: 0,
        state: 'AUTHORED',
        definition: canonical,
        createdAt: when,
        stateChangedAt: when,
      });
      this.policies.set(policyId, record);
      return { ok: true, record };
    });
  }

  /**
   * Publish the AUTHORED draft: AUTHORED -> VERSIONED, assigning the next
   * integer version. The definition is immutable from here on (revise is
   * not representable post-publish — the published record is the version).
   * No evidence (the named set is exhaustive).
   *
   * Source: core.md lines 98-99 ("AUTHORED -> VERSIONED ... versioned,
   * immutable policy document").
   */
  async publishPolicyVersion(
    policyId: string,
  ): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> {
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new TypeError('policy authority: policyId must be a non-empty string');
    }
    return this.serializer.run(`policy:${policyId}`, async (): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> => {
      const current = this.policies.get(policyId);
      if (current === undefined) {
        return notFound(policyId);
      }
      if (current.state !== 'AUTHORED') {
        return illegalPolicy(current, 'VERSIONED');
      }
      const version = this.nextVersion(policyId);
      const when = this.nextTime();
      const published: FulfillmentPolicyRecord = deepFreeze({
        ...current,
        version,
        state: 'VERSIONED',
        stateChangedAt: when,
      });
      this.policies.set(`${policyId}@v${version}`, published);
      this.policies.set(policyId, published);
      return { ok: true, record: published };
    });
  }

  private nextVersion(policyId: string): number {
    let max = 0;
    for (const key of this.policies.keys()) {
      if (key === policyId || key.startsWith(`${policyId}@v`)) {
        const record = this.policies.get(key) as FulfillmentPolicyRecord;
        if (record.version > max) {
          max = record.version;
        }
      }
    }
    return max + 1;
  }

  /**
   * Attach a VERSIONED policy to an intent: VERSIONED -> ATTACHED, fixed
   * for that intent (terminal — no further state changes). Emits
   * POLICY_ATTACHED (policy version, snapshot id). The attachment is 1:1
   * both ways: a policy attaches to exactly one intent, and an intent
   * carries at most one attached policy.
   *
   * Source: core.md lines 98-100 ("attached to an intent at authorization
   * time ... fixed for that intent"); line 134 (evidence).
   */
  async attachPolicy(input: {
    readonly policyId: string;
    readonly version: number;
    readonly intentId: string;
    readonly snapshotId: string;
  }): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> {
    const { policyId, version, intentId, snapshotId } = input;
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new TypeError('policy authority: policyId must be a non-empty string');
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new TypeError('policy authority: version must be a positive integer (assigned at publish)');
    }
    if (typeof intentId !== 'string' || intentId.length === 0) {
      throw new TypeError('policy authority: intentId must be a non-empty string');
    }
    if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
      throw new TypeError('policy authority: snapshotId must be a non-empty string (POLICY_ATTACHED records it)');
    }
    const versionKey = `${policyId}@v${version}`;
    return this.serializer.run(`policy:${policyId}`, async (): Promise<PolicyCommandResult<FulfillmentPolicyRecord>> => {
      const current = this.policies.get(versionKey);
      if (current === undefined) {
        return notFound(`${policyId}@v${version}`);
      }
      if (current.state === 'ATTACHED') {
        return {
          ok: false,
          code: 'ALREADY_ATTACHED',
          problem: `policy authority: policy ${versionKey} is already attached to intent ${current.attachedIntentId} and is fixed for that intent (core.md lines 99-100)`,
        };
      }
      if (current.state !== 'VERSIONED') {
        return illegalPolicy(current, 'ATTACHED');
      }
      const attachedIntent = this.attachedByIntent.get(intentId);
      if (attachedIntent !== undefined) {
        return {
          ok: false,
          code: 'INTENT_ALREADY_HAS_POLICY',
          problem: `policy authority: intent ${intentId} already has policy ${attachedIntent} attached (a policy attached to an intent is fixed for that intent)`,
        };
      }
      const when = this.nextTime();
      const transition = transitionFulfillmentPolicy(current, 'ATTACHED', when, { intentId, snapshotId });
      if (!transition.ok) {
        return transition;
      }
      await submitPolicyEvidence(this.evidence, policyAttachedEvidence(transition.record, when));
      this.policies.set(versionKey, transition.record);
      this.attachedByIntent.set(intentId, versionKey);
      return { ok: true, record: transition.record };
    });
  }

  // -------------------------------------------------------------------------
  // Evaluation (the pure INV-2-1 function, recorded and idempotent)
  // -------------------------------------------------------------------------

  /**
   * Evaluate a policy version against an intent's terms and a capability
   * snapshot: the PURE function runs, the evaluation is recorded with its
   * derived id (INV-2-3 — one evaluation id per (intent, policy version,
   * snapshot id); duplicate requests return the recorded evaluation, with
   * no second record), the snapshot id is recorded on it (INV-2-2), and
   * POLICY_EVALUATED is emitted (the satisfiable result or the
   * reason-coded POLICY_UNSATISFIABLE failure — the failure that routes
   * the intent to FAILED, core.md lines 127-128).
   *
   * The snapshot arrives as a VALUE (no capability-authority dependency —
   * "Depends on area 3 for the capability snapshot format" is a format
   * dependency, satisfied by the type).
   *
   * Source: core.md lines 102-107, 115-123, 127-128, 135.
   */
  async evaluatePolicy(input: {
    readonly policyId: string;
    readonly version: number;
    readonly intentId: string;
    readonly intentTerms: IntentTerms;
    readonly snapshot: CapabilitySnapshot;
  }): Promise<PolicyCommandResult<PolicyEvaluationRecord>> {
    const { policyId, version, intentId, intentTerms, snapshot } = input;
    if (typeof policyId !== 'string' || policyId.length === 0) {
      throw new TypeError('policy authority: policyId must be a non-empty string');
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new TypeError('policy authority: version must be a positive integer');
    }
    if (typeof intentId !== 'string' || intentId.length === 0) {
      throw new TypeError('policy authority: intentId must be a non-empty string');
    }
    if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.snapshotId !== 'string') {
      throw new TypeError('policy authority: snapshot must be a CapabilitySnapshot (the A03 format, core.md lines 141-142)');
    }
    const evaluationId = deriveProtocolId(
      'policy-evaluation',
      intentId,
      policyId,
      version,
      snapshot.snapshotId,
    );
    return this.serializer.run(`evaluation:${evaluationId}`, async (): Promise<PolicyCommandResult<PolicyEvaluationRecord>> => {
      // INV-2-3: duplicate requests return the recorded evaluation.
      const recorded = this.evaluations.get(evaluationId);
      if (recorded !== undefined) {
        return { ok: true, record: recorded };
      }
      const versionKey = `${policyId}@v${version}`;
      const policy = this.policies.get(versionKey);
      if (policy === undefined) {
        return evaluationNotFound(policyId, version, intentId);
      }
      if (policy.state === 'ATTACHED' && policy.attachedIntentId !== intentId) {
        return {
          ok: false,
          code: 'ALREADY_ATTACHED',
          problem: `policy authority: policy ${versionKey} is attached to intent ${policy.attachedIntentId} and is fixed for that intent (core.md lines 99-100)`,
        };
      }
      const outcome = evaluateFulfillmentPolicy({
        policyId,
        policyVersion: version,
        definition: policy.definition,
        intentTerms,
        snapshot,
      });
      const when = this.nextTime();
      const resultHash = policyEvaluationResultHash(outcome);
      const record: PolicyEvaluationRecord = deepFreeze({
        evaluationId,
        intentId,
        policyId,
        policyVersion: version,
        snapshotId: snapshot.snapshotId,
        state: 'EVALUATED',
        outcome,
        resultHash,
        evaluatedAt: when,
        stateChangedAt: when,
      });
      await submitPolicyEvidence(this.evidence, policyEvaluatedEvidence(record, when));
      this.evaluations.set(evaluationId, record);
      return { ok: true, record };
    });
  }

  /**
   * Consume an evaluation: EVALUATED -> CONSUMED (the machine's terminal —
   * the routing compiler's consumption). Persists the transition; emits NO
   * evidence (A02's named set is exactly {POLICY_ATTACHED,
   * POLICY_EVALUATED}; recorded in CONTRACT-REVIEW.md).
   *
   * Source: core.md lines 104-105 ("EVALUATED -> CONSUMED"); lines 134-135
   * (the named set).
   */
  async consumeEvaluation(
    evaluationId: string,
  ): Promise<PolicyCommandResult<PolicyEvaluationRecord>> {
    if (typeof evaluationId !== 'string' || evaluationId.length === 0) {
      throw new TypeError('policy authority: evaluationId must be a non-empty string');
    }
    const existing = this.evaluations.get(evaluationId);
    if (existing === undefined) {
      return {
        ok: false,
        code: 'EVALUATION_NOT_FOUND',
        problem: `policy authority: evaluation ${evaluationId} is not recorded`,
      };
    }
    return this.serializer.run(`evaluation:${evaluationId}`, async (): Promise<PolicyCommandResult<PolicyEvaluationRecord>> => {
      const when = this.nextTime();
      const transition = transitionPolicyEvaluation(existing, 'CONSUMED', when);
      if (!transition.ok) {
        return transition;
      }
      this.evaluations.set(evaluationId, transition.record);
      return { ok: true, record: transition.record };
    });
  }

  // -------------------------------------------------------------------------
  // Reads (pure, no evidence)
  // -------------------------------------------------------------------------

  /** The recorded policy version (`policyId@v<version>`) or draft (`policyId`), if any. */
  getPolicy(policyIdOrVersionKey: string): FulfillmentPolicyRecord | undefined {
    return this.policies.get(policyIdOrVersionKey);
  }

  /** The policy attached to an intent, if any (the 1:1 attachment map). */
  getAttachedPolicy(intentId: string): FulfillmentPolicyRecord | undefined {
    const versionKey = this.attachedByIntent.get(intentId);
    return versionKey === undefined ? undefined : this.policies.get(versionKey);
  }

  /** The recorded evaluation by id, if any (INV-2-3's lookup). */
  getEvaluation(evaluationId: string): PolicyEvaluationRecord | undefined {
    return this.evaluations.get(evaluationId);
  }

  /** All recorded evaluations, in creation (insertion) order. */
  listEvaluations(): readonly PolicyEvaluationRecord[] {
    return [...this.evaluations.values()];
  }
}

function notFound(policyKey: string): PolicyCommandResult<FulfillmentPolicyRecord> {
  return {
    ok: false,
    code: 'POLICY_NOT_FOUND',
    problem: `policy authority: policy ${policyKey} is not recorded`,
  };
}

function illegalPolicy(
  current: FulfillmentPolicyRecord,
  target: FulfillmentPolicyRecord['state'],
): PolicyCommandResult<FulfillmentPolicyRecord> {
  return {
    ok: false,
    code: 'ILLEGAL_TRANSITION',
    problem: `policy authority: illegal lifecycle transition ${current.state} -> ${target} on policy ${current.policyId}@v${current.version} (core.md A02 lines 98-100)`,
  };
}

function evaluationNotFound(
  policyId: string,
  version: number,
  intentId: string,
): PolicyCommandResult<PolicyEvaluationRecord> {
  return {
    ok: false,
    code: 'POLICY_NOT_FOUND',
    problem: `policy authority: policy ${policyId}@v${version} is not recorded (needed to evaluate intent ${intentId})`,
  };
}
