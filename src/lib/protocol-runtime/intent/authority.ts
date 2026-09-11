/**
 * RTN-005 — Intent Authority: the composed single-writer command surface for
 * area 1 (A01).
 *
 * Spec sources (binding) — spec/architecture/v0.1/core.md §1 Area 1:
 *   lines 33-37 (PaymentIntent state machine; one-way; retry-as-new-intent):
 *     "Transitions are one-way; a failed or cancelled intent cannot be
 *      restarted. A retry is a new intent linked to the prior intent id."
 *   lines 39-44 (DemandDescriptor immutable at DRAFT; IntentReceipt the
 *     idempotent response object).
 *   lines 48-50 (owning authority):
 *     "Intent Authority (protocol layer, area 1). Sole writer of
 *      PaymentIntent state. Product layers may submit intents; they never
 *      mutate intent state directly."
 *   lines 54-62 (the three invariants this surface enforces):
 *     "INV-1-1 (financial correctness): monetary terms are fixed at
 *      AUTHORIZATION. Any change after authorization requires a new intent;
 *      the old intent moves to CANCELLED with an evidence record.
 *      INV-1-2 (concurrency): state transitions are serialized per intent
 *      id. Concurrent submissions carrying the same idempotency key collapse
 *      to one intent and one receipt.
 *      INV-1-3 (idempotency): re-submission with a recorded idempotency key
 *      returns the recorded receipt; it never creates a second intent or a
 *      second financial effect."
 *   lines 67-70 (failure semantics + recovery).
 *   lines 74-78 (evidence produced — through the REAL A15 log).
 *   lines 84-85 (boundaries — "Depends on area 2 at authorization, area 3 at
 *     routing, and area 16 for compliance gating before AUTHORIZED").
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 (INV-16-3, the gate this authority calls before AUTHORIZED):
 *     "state transitions gated by compliance (intent AUTHORIZATION,
 *      capability ACTIVATION) cannot complete without a terminal APPROVED
 *      record for the subject."
 *
 * Command discipline (the merged rails convention, adapted to this area):
 *   - Every command runs INSIDE the per-intent-id keyed serializer
 *     (INV-1-2); the submit command runs inside the serializer keyed by the
 *     derived intent id (the idempotency key determines the intent id, so
 *     per-intent-id serialization and key collapse are the same lock).
 *   - Every consequential operation submits its GC-5 evidence record FIRST
 *     (awaited) and commits its in-memory state only after the write
 *     succeeds: "an operation is not committed until its record is written.
 *     A failed write fails the operation" (A15 lines 62-64).
 *   - Domain rejections are typed values (IntentSubmissionResult /
 *     IntentTransitionResult), never thrown; input-shape violations throw
 *     TypeError (kernel convention).
 *   - Authorization calls the RTN-003 compliance gate BEFORE the transition:
 *     no AUTHORIZED without a terminal APPROVED record for the intent
 *     subject (INV-16-3). The gate is an injected port (the RTN-003 gate
 *     interface — its verdict type is imported type-only; the composition
 *     root wires risk's evaluateComplianceGate / checkGate).
 *   - INV-1-1 is structural: there is NO command that mutates a descriptor
 *     or any monetary term; the only path to different terms is a new
 *     intent (new key) plus cancelling the old one.
 *
 * State layer (recorded in CONTRACT-REVIEW.md): the authority is an
 * in-process single writer over its own state maps — the RTN-002
 * in-process-object-store precedent — so the full command discipline
 * (serialization, collapse, gate coupling, real-log evidence) is exercised
 * under bun test without node:sqlite (Bun 1.3.14 does not implement it).
 * The domain's durable side is the per-domain persistence module
 * (persistence.ts + migrations/), composed by the deployment root the same
 * way RTN-002's log composes with its store.
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { ComplianceGateVerdict } from '../risk/gate.ts';
import { demandDescriptorHash } from './descriptor.ts';
import type { DemandDescriptor, IntentReceipt, PaymentIntent } from './types.ts';
import type {
  IntentReasonCode,
  IntentState,
  IntentSubmissionResult,
  IntentTransitionResult,
} from './types.ts';
import {
  intentAuthorizedEvidence,
  intentCreatedEvidence,
  intentStateChangedEvidence,
  submitIntentEvidence,
} from './evidence.ts';
import { KeyedSerializer } from './serializer.ts';
import {
  checkIntentReasonCode,
  transitionPaymentIntent,
} from './state-machine.ts';

/**
 * The RTN-003 compliance-gate port the Intent Authority calls before
 * completing AUTHORIZATION: allowed exactly on a terminal APPROVED record
 * for the subject (INV-16-3). The verdict type is RTN-003's own
 * (type-only import — no runtime coupling); the composition root wires
 * risk's evaluateComplianceGate over the recorded checks, or the composed
 * risk authority's checkGate.
 *
 * Source: core.md lines 84-85 ("area 16 for compliance gating before
 * AUTHORIZED"); evidence-risk-compliance.md lines 129-131 (INV-16-3).
 */
export interface IntentAuthorizationGate {
  (subjectId: string): ComplianceGateVerdict;
}

/**
 * Constructor dependencies for the Intent Authority.
 *
 * Source: the wave evidence discipline (evidence through the kernel port —
 * here the REAL RTN-002 log); core.md lines 84-85 (the gate dependency);
 * the rails wallClock-injection convention for deterministic tests.
 */
export interface IntentAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The RTN-003 compliance gate (INV-16-3) called before AUTHORIZED. */
  readonly gate: IntentAuthorizationGate;
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
 * The Intent Authority: sole writer of PaymentIntent state. Commands:
 * submit (idempotent, INV-1-2/1-3), authorize (compliance-gated), route,
 * start fulfilling, fulfill, fail (reason-coded), cancel (reason-coded).
 * Every state mutation is serialized per intent id and evidenced to the real
 * A15 log before commit.
 *
 * Source: core.md lines 48-50 (sole writer), lines 54-62 (INV-1-1/1-2/1-3),
 * lines 67-70 (failure/recovery), lines 74-78 (evidence).
 */
export class IntentAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly gate: IntentAuthorizationGate;
  private readonly wallClock: () => number;
  private readonly serializer = new KeyedSerializer();
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly intentIdsByKey = new Map<string, string>();
  private readonly receiptsByKey = new Map<string, IntentReceipt>();
  private sequence = 0;

  constructor(deps: IntentAuthorityDeps) {
    if (deps.evidence === null || typeof deps.evidence !== 'object' || typeof deps.evidence.submit !== 'function') {
      throw new TypeError('intent authority: deps.evidence must be an EvidenceSubmission port');
    }
    if (typeof deps.gate !== 'function') {
      throw new TypeError('intent authority: deps.gate must be the RTN-003 compliance gate function');
    }
    this.evidence = deps.evidence;
    this.gate = deps.gate;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private nextTime(): ProtocolTime {
    const when = protocolTime(this.sequence, this.wallClock());
    this.sequence += 1;
    return when;
  }

  // -------------------------------------------------------------------------
  // Submission (INV-1-2 / INV-1-3)
  // -------------------------------------------------------------------------

  /**
   * Submit a demand: creates the intent in DRAFT with the immutable
   * descriptor attached, records the receipt under the descriptor's
   * idempotency key, and writes INTENT_CREATED to the real log.
   *
   * Idempotency (INV-1-2/INV-1-3): the command is serialized under the
   * derived intent id; a recorded idempotency key returns the RECORDED
   * receipt (replayed: true) — never a second intent, never a second
   * evidence record. A prior-intent reference (retry linkage — "A retry is
   * a new intent linked to the prior intent id", core.md line 37) must name
   * a recorded intent.
   *
   * Source: core.md lines 39-44, 57-62, 74-75.
   */
  async submitIntent(
    descriptor: DemandDescriptor,
    options: { readonly priorIntentId?: string } = {},
  ): Promise<IntentSubmissionResult> {
    if (descriptor === null || typeof descriptor !== 'object' || typeof descriptor.idempotencyKey !== 'string') {
      throw new TypeError('intent authority: submitIntent requires a minted DemandDescriptor (see demandDescriptor())');
    }
    if (options.priorIntentId !== undefined && (typeof options.priorIntentId !== 'string' || options.priorIntentId.length === 0)) {
      throw new TypeError('intent authority: priorIntentId must be a non-empty string when present');
    }
    const intentId = deriveProtocolId('intent', descriptor.idempotencyKey);
    return this.serializer.run(`intent:${intentId}`, async (): Promise<IntentSubmissionResult> => {
      const recorded = this.receiptsByKey.get(descriptor.idempotencyKey);
      if (recorded !== undefined) {
        const intent = this.intents.get(intentId);
        if (intent === undefined) {
          throw new TypeError(
            `intent authority: recorded key ${descriptor.idempotencyKey} has no recorded intent (internal consistency)`,
          );
        }
        // INV-1-3: the recorded receipt, verbatim — no second intent, no
        // second financial effect.
        return { ok: true, replayed: true, intent, receipt: recorded };
      }
      if (
        options.priorIntentId !== undefined &&
        !this.intents.has(options.priorIntentId)
      ) {
        return {
          ok: false,
          code: 'PRIOR_INTENT_NOT_FOUND',
          problem: `intent authority: prior intent ${options.priorIntentId} is not recorded (a retry must link a recorded prior intent id — core.md line 37)`,
        };
      }
      const when = this.nextTime();
      const intent: PaymentIntent = deepFreeze({
        intentId,
        idempotencyKey: descriptor.idempotencyKey,
        state: 'DRAFT',
        descriptor,
        descriptorHash: demandDescriptorHash(descriptor),
        ...(options.priorIntentId === undefined ? {} : { priorIntentId: options.priorIntentId }),
        createdAt: when,
        stateChangedAt: when,
      });
      // Submit-then-commit (A15 lines 62-64): a failed write fails the
      // operation and nothing is recorded.
      await submitIntentEvidence(this.evidence, intentCreatedEvidence(intent, when));
      this.intents.set(intentId, intent);
      this.intentIdsByKey.set(descriptor.idempotencyKey, intentId);
      const receipt: IntentReceipt = deepFreeze({
        intentId,
        state: 'DRAFT',
        outcome: 'DRAFT',
        recordedAt: when,
      });
      this.receiptsByKey.set(descriptor.idempotencyKey, receipt);
      return { ok: true, replayed: false, intent, receipt };
    });
  }

  // -------------------------------------------------------------------------
  // Authorization (compliance-gated) and the later transitions
  // -------------------------------------------------------------------------

  /**
   * Authorize the intent: DRAFT -> AUTHORIZED, with the policy decision id
   * recorded (INTENT_AUTHORIZED "proof: policy decision id" — the area-2
   * dependency at authorization, core.md lines 84-85 and line 76).
   *
   * INV-16-3: the RTN-003 gate is called FIRST, inside the per-intent
   * serialization; a non-allowed verdict (no check, undecided, or DENIED)
   * blocks the transition with the typed COMPLIANCE_BLOCKED rejection and
   * no state change and no evidence. No AUTHORIZED transition is
   * representable without a terminal APPROVED record for the subject.
   *
   * Source: core.md lines 54-56 (INV-1-1 — terms fixed from AUTHORIZATION
   * on), line 76 (evidence); evidence-risk-compliance.md lines 129-131
   * (INV-16-3) and lines 140-141 (undecided checks block).
   */
  async authorizeIntent(
    intentId: string,
    policyDecisionId: string,
  ): Promise<IntentTransitionResult> {
    if (typeof intentId !== 'string' || intentId.length === 0) {
      throw new TypeError('intent authority: intentId must be a non-empty string');
    }
    if (typeof policyDecisionId !== 'string' || policyDecisionId.length === 0) {
      throw new TypeError('intent authority: policyDecisionId must be a non-empty string (the area-2 decision, core.md line 76)');
    }
    return this.serializer.run(`intent:${intentId}`, async (): Promise<IntentTransitionResult> => {
      const current = this.intents.get(intentId);
      if (current === undefined) {
        return notFound(intentId);
      }
      if (current.state !== 'DRAFT') {
        return illegal(current, 'AUTHORIZED');
      }
      const verdict = this.gate(intentId);
      if (!verdict.allowed) {
        return {
          ok: false,
          code: 'COMPLIANCE_BLOCKED',
          problem: `intent authority: authorization of ${intentId} blocked by compliance (INV-16-3 — ${verdict.blockedBy}${verdict.checkId === undefined ? '' : `, check ${verdict.checkId}`}); a terminal APPROVED record for the subject is required`,
        };
      }
      const when = this.nextTime();
      const transition = transitionPaymentIntent(current, 'AUTHORIZED', when, { policyDecisionId });
      if (!transition.ok) {
        return transition;
      }
      await submitIntentEvidence(
        this.evidence,
        intentAuthorizedEvidence(transition.intent, policyDecisionId, when),
      );
      this.intents.set(intentId, transition.intent);
      return { ok: true, intent: transition.intent };
    });
  }

  /**
   * Route the intent: AUTHORIZED -> ROUTED (the routing authority's success
   * lands here; its failure uses failIntent). Emits INTENT_STATE_CHANGED.
   *
   * Source: core.md lines 34-35 (the chain), line 77 (evidence).
   */
  async routeIntent(
    intentId: string,
    reasonCode?: IntentReasonCode,
  ): Promise<IntentTransitionResult> {
    return this.simpleTransition(intentId, 'ROUTED', { reasonCode });
  }

  /**
   * Start fulfillment: ROUTED -> FULFILLING. Emits INTENT_STATE_CHANGED.
   *
   * Source: core.md lines 34-35 (the chain), line 77 (evidence).
   */
  async startFulfillingIntent(
    intentId: string,
    reasonCode?: IntentReasonCode,
  ): Promise<IntentTransitionResult> {
    return this.simpleTransition(intentId, 'FULFILLING', { reasonCode });
  }

  /**
   * Fulfill the intent: FULFILLING -> FULFILLED (terminal). Emits
   * INTENT_STATE_CHANGED.
   *
   * Source: core.md lines 34-36 (terminal), line 77 (evidence).
   */
  async fulfillIntent(
    intentId: string,
    reasonCode?: IntentReasonCode,
  ): Promise<IntentTransitionResult> {
    return this.simpleTransition(intentId, 'FULFILLED', { reasonCode });
  }

  /**
   * Fail the intent: AUTHORIZED | ROUTED | FULFILLING -> FAILED (terminal)
   * with a REQUIRED machine-readable reason code and an optional link to
   * the failing evidence record ("If routing or fulfillment later fails,
   * the intent moves to FAILED with a machine readable reason code and a
   * link to the failing evidence record"). A failed intent cannot be
   * restarted; recovery is a new intent referencing this one (submitIntent
   * with priorIntentId).
   *
   * Source: core.md lines 36-37, 67-70.
   */
  async failIntent(
    intentId: string,
    reasonCode: IntentReasonCode,
    failingRecordId?: string,
  ): Promise<IntentTransitionResult> {
    return this.simpleTransition(intentId, 'FAILED', { reasonCode, failingRecordId });
  }

  /**
   * Cancel the intent: AUTHORIZED | ROUTED | FULFILLING -> CANCELLED
   * (terminal) with a REQUIRED reason code. This is the INV-1-1 change
   * path's second half: a change after authorization creates a NEW intent
   * and moves the OLD intent to CANCELLED with this evidence record.
   *
   * Source: core.md lines 54-56 (INV-1-1), 35-36 (terminal), 77 (evidence).
   */
  async cancelIntent(
    intentId: string,
    reasonCode: IntentReasonCode,
  ): Promise<IntentTransitionResult> {
    return this.simpleTransition(intentId, 'CANCELLED', { reasonCode });
  }

  private async simpleTransition(
    intentId: string,
    target: IntentState,
    options: {
      readonly reasonCode?: IntentReasonCode;
      readonly failingRecordId?: string;
    },
  ): Promise<IntentTransitionResult> {
    if (typeof intentId !== 'string' || intentId.length === 0) {
      throw new TypeError('intent authority: intentId must be a non-empty string');
    }
    const reasonCheck = checkIntentReasonCode(target, options.reasonCode);
    if (!reasonCheck.ok) {
      throw new TypeError(`intent authority: ${reasonCheck.problem}`);
    }
    return this.serializer.run(`intent:${intentId}`, async (): Promise<IntentTransitionResult> => {
      const current = this.intents.get(intentId);
      if (current === undefined) {
        return notFound(intentId);
      }
      const when = this.nextTime();
      const transition = transitionPaymentIntent(current, target, when);
      if (!transition.ok) {
        return transition;
      }
      await submitIntentEvidence(
        this.evidence,
        intentStateChangedEvidence(transition.intent, when, {
          ...(options.reasonCode === undefined ? {} : { reasonCode: options.reasonCode }),
          ...(options.failingRecordId === undefined ? {} : { failingRecordId: options.failingRecordId }),
        }),
      );
      this.intents.set(intentId, transition.intent);
      return { ok: true, intent: transition.intent };
    });
  }

  // -------------------------------------------------------------------------
  // Reads (pure, no evidence — reads are not consequential operations)
  // -------------------------------------------------------------------------

  /** The recorded intent by id, if any. Source: core.md lines 48-50 (sole writer of the state callers read). */
  getIntent(intentId: string): PaymentIntent | undefined {
    return this.intents.get(intentId);
  }

  /** The recorded intent whose descriptor carried the idempotency key, if any (INV-1-3's lookup). */
  findIntentByIdempotencyKey(idempotencyKey: string): PaymentIntent | undefined {
    const intentId = this.intentIdsByKey.get(idempotencyKey);
    return intentId === undefined ? undefined : this.intents.get(intentId);
  }

  /** The recorded receipt for an idempotency key, if any (INV-1-3). */
  getReceipt(idempotencyKey: string): IntentReceipt | undefined {
    return this.receiptsByKey.get(idempotencyKey);
  }

  /** All recorded intents, in creation (insertion) order. */
  listIntents(): readonly PaymentIntent[] {
    return [...this.intents.values()];
  }
}

function notFound(intentId: string): IntentTransitionResult {
  return {
    ok: false,
    code: 'INTENT_NOT_FOUND',
    problem: `intent authority: intent ${intentId} is not recorded`,
  };
}

function illegal(current: PaymentIntent, target: IntentState): IntentTransitionResult {
  return {
    ok: false,
    code: 'ILLEGAL_TRANSITION',
    problem: `intent authority: illegal one-way transition ${current.state} -> ${target} on intent ${current.intentId} (core.md A01 lines 34-37)`,
  };
}
