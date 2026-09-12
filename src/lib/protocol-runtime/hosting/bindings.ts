/**
 * RTN-011 — Authority hosting: the concrete command bindings.
 *
 * The authority hosting pattern on the DEP-003 substrate, exactly at the
 * documented integration point (src/lib/durable/index.ts lines 14-18):
 *
 *   "Hard boundary: the substrate executes jobs via REGISTERED HANDLERS
 *    only. register(kind, handler) is the single integration point; ...
 *    Future protocol authorities plug in via register() and own their own
 *    evidence via recordEvent(type, data, owner)."
 *
 * Each binding is one hosted authority command: the command kind (maps
 * 1:1 onto durable_jobs.kind — the kernel envelope contract), the owning
 * authority (the envelope's authority target), the owner identity for
 * the authority-owned observation rows, and the execute() body that
 * drives the OWNING AUTHORITY'S OWN command surface — never a second
 * implementation of protocol semantics. The transition runtime
 * (transition/execution.ts) wraps these bindings into the dequeue →
 * resolve → apply → A15-evidence → commit path; THIS module never
 * mutates authoritative state itself.
 *
 * Command bodies are JSON-representable records (they round-trip through
 * durable_jobs.payload); kernel Money values revive through the kernel's
 * money() guard (GC-1 — the integer-minor-units discipline holds on the
 * revived read path, exactly like the per-domain persistence read
 * bridges).
 *
 * The per-domain durable write-through (the "commit state" step over the
 * per-domain stores — the merged persistence convention) is injected as
 * OPTIONAL persist hooks: bun suites construct bindings without them
 * (bun does not implement node:sqlite — the repository's documented
 * split); the plain-Node harness and the server runtime inject them via
 * hosting/durable-binding.ts. Every hook implementation is idempotent
 * (read-diff-write over the merged bridges) so at-least-once redelivery
 * of a command re-persists the same rows without duplication.
 *
 * Spec sources (binding):
 *   src/lib/durable/index.ts lines 14-18 (the integration point quoted
 *   above); spec/durable/execution.md §13 (the integration guide).
 *   spec/deployment/topology.md line 188 ("mutated only by
 *   transition-runtime through protocol-owned transitions — no other
 *   layer may mutate it directly") — the bindings call the authorities'
 *   own command surfaces; no protocol semantics are re-implemented here.
 *   spec/architecture/v0.1/evidence-risk-compliance.md lines 62-64 (the
 *   A15 synchronous coupling every merged authority already implements
 *   internally: "an operation is not committed until its record is
 *   written. A failed write fails the operation").
 *   rtn-plan-rulings.md delta 5 (production admission remains exclusively
 *   RTN-010's gateway; this module exposes enqueueCommand for the test
 *   harnesses' own enqueueing through the substrate's PUBLIC enqueue
 *   API — never a second admission path for production).
 */

import { money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { commandEnvelopeToEnqueueInput } from '../kernel/envelope.ts';
import type {
  CommandEnvelope,
  CommandKind,
  ProtocolAuthorityId,
} from '../kernel/envelope.ts';
import type { EnqueueOptions, EnqueueResult } from '../../durable/queue.ts';
import type { AuthorityCommandBinding, AuthorityCommandOutcome } from '../transition/execution.ts';
import type { TransitionSubstrate } from '../transition/substrate-port.ts';
import type { IntentAuthority } from '../intent/authority.ts';
import { demandDescriptor } from '../intent/descriptor.ts';
import type { DemandDescriptor, IntentReceipt, IntentReasonCode, PaymentIntent } from '../intent/types.ts';
import type { ReservationLedger } from '../reservations/ledger.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  ReservationRequestResult,
  ReservationTerminalCommandResult,
  ResourceDeclarationResult,
} from '../reservations/types.ts';
import type { ObligationLedgerAuthority } from '../obligations/authority.ts';
import type { SettlementAuthority, AttemptOutcomeMirror } from '../settlement/authority.ts';
import { railIdempotencyKeyForInstruction } from '../settlement/state-machine.ts';
import type { ClearingAuthority } from '../clearing/authority.ts';
import type { NettingAuthority } from '../netting/authority.ts';
import type { QueueAuthority } from '../queues/authority.ts';
import type { RailAdapterConnection, RailReportEnvelope } from '../rails/adapters.ts';
import type { SubmitRailOperationOutcome as RailsSubmitOutcome } from '../rails/authority.ts';
import type {
  ExternalStatementRecord,
  RailAdapterRecord,
  RailOperationRecord,
  RailsCommandResult,
  ReconciliationCycleRecord,
  ReconciliationSourceRecord,
} from '../rails/types.ts';
import type { CycleMatchingOutcome } from '../rails/reconciliation.ts';

// ---------------------------------------------------------------------------
// Body-revival helpers (kernel guards on the revived read path — GC-1)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`command body: ${field} must be a record`);
  }
  return value;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`command body: ${field} must be a non-empty string`);
  }
  return value;
}

function expectOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectString(value, field);
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`command body: ${field} must be a finite number`);
  }
  return value;
}

/** Revive a JSON Money record through the kernel guard (GC-1). */
function expectMoney(value: unknown, field: string): Money {
  const record = expectRecord(value, field);
  return money(
    expectString(record.currency, `${field}.currency`),
    expectNumber(record.amountMinor, `${field}.amountMinor`),
    expectNumber(record.scale, `${field}.scale`),
  );
}

function expectProtocolTime(value: unknown, field: string): ProtocolTime {
  const record = expectRecord(value, field);
  return protocolTime(
    expectNumber(record.sequence, `${field}.sequence`),
    expectNumber(record.wallMs, `${field}.wallMs`),
  );
}

// ---------------------------------------------------------------------------
// Persist hooks (the durable write-through — injected, idempotent)
// ---------------------------------------------------------------------------

/**
 * The intent-domain durable write-through: persist the resulting intent
 * (create-or-state row) and, on submission, the idempotency receipt.
 * Implementation is idempotent (the merged bridges are ON CONFLICT DO
 * NOTHING / state UPDATEs), so redelivery re-persists without duplicating.
 *
 * Source: RTN-011.md line 14 ("commit state atomically" — the durable
 * write-through AFTER the A15 record lands); the merged persistence
 * convention (README "Persistence convention": per-domain stores with
 * per-domain migrations on the DEP-003 db layer).
 */
export type IntentPersistHook = (intent: PaymentIntent, receipt?: IntentReceipt) => void;

/**
 * The reservations-domain durable write-through over the ledger's current
 * committed snapshot (entries + reservations + resource accountings).
 * The merged persistLedgerSnapshot bridge is idempotent.
 *
 * Source: RTN-011.md line 14; the merged persistence convention; the
 * reservations crash-recovery composition (readLedgerEntries feeds
 * openReservationLedger's initialEntries — restart rehydration).
 */
export type ReservationsPersistHook = (ledger: ReservationLedger) => void;

/**
 * The obligations-domain durable write-through over the append-only
 * ledger (INSERT-only for entries not yet persisted).
 *
 * Source: RTN-011.md line 14; the merged persistence convention
 * (obligation_ledger_entries is INSERT-only — INV-10-1).
 */
export type ObligationsPersistHook = (authority: ObligationLedgerAuthority) => void;

/**
 * The settlement-domain durable write-through over the authority's state
 * store (instructions, attempts, finalities; INSERT for new rows, state
 * UPDATEs for changed rows).
 *
 * Source: RTN-011.md line 14; the merged persistence convention.
 */
export type SettlementPersistHook = (authority: SettlementAuthority) => void;

/**
 * The clearing-domain durable write-through for the touched batch. The
 * batchLabel is an insert-only column (the open/tick command — which
 * carries the label — always precedes the same batch's later commands).
 *
 * Source: RTN-011.md line 14; the merged persistence convention.
 */
export type ClearingPersistHook = (
  authority: ClearingAuthority,
  batchId: string,
  batchLabel?: string,
) => void;

/**
 * The netting-domain durable write-through for the touched set and its
 * net obligations. The label is an insert-only column (the open/tick
 * command carries it).
 *
 * Source: RTN-011.md line 14; the merged persistence convention.
 */
export type NettingPersistHook = (
  authority: NettingAuthority,
  nettingSetId: string,
  label?: string,
) => void;

/**
 * The queues-domain durable write-through for the touched queue and its
 * resident items.
 *
 * Source: RTN-011.md line 14; the merged persistence convention.
 */
export type QueuesPersistHook = (authority: QueueAuthority, queueId: string) => void;

/** The injected per-domain durable write-through hooks (all optional). */
export interface AuthorityPersistHooks {
  readonly intent?: IntentPersistHook;
  readonly reservations?: ReservationsPersistHook;
  readonly obligations?: ObligationsPersistHook;
  readonly settlement?: SettlementPersistHook;
  readonly clearing?: ClearingPersistHook;
  readonly netting?: NettingPersistHook;
  readonly queues?: QueuesPersistHook;
}

// ---------------------------------------------------------------------------
// Hosted rails / reconciliation surfaces (injected; real in Node, doubles in bun)
// ---------------------------------------------------------------------------

/**
 * The hosted A13 Rail Adapter Authority command surface (the real
 * RailAdapterAuthority in the Node harness; the bun suites host the
 * settlement rails double instead). THIS surface — never the adapter
 * interface — is what advances RailAdapter/RailOperation state: "no code
 * path in the adapter interface creates or mutates RailAdapter/
 * RailOperation state" (rtn-plan-rulings.md Q1, delta 1).
 *
 * Source: rtn-plan-rulings.md Q1 ruling, delta 1; rails/authority.ts
 * (the A13 command surface).
 */
export interface HostedRailsAdapterSurface {
  registerAdapter(input: {
    readonly railFamily: string;
    readonly name: string;
  }): RailsCommandResult<RailAdapterRecord>;
  activateAdapter(adapterId: string): RailsCommandResult<RailAdapterRecord>;
  authorizeOperation(input: {
    readonly instructionId: string;
    readonly adapterId: string;
    readonly payload: unknown;
  }): RailsCommandResult<RailOperationRecord>;
  submitRailOperation(
    operationId: string,
    connection: RailAdapterConnection,
  ): RailsCommandResult<RailsSubmitOutcome>;
}

/**
 * The hosted A14 Reconciliation Authority cycle surface (the recurring
 * reconciliation-cycle tick commands drive exactly these).
 *
 * Source: rails/reconciliation.ts (the A14 cycle command surface);
 * RTN-011.md line 18 ("reconciliation cycles" among the recurring ticks).
 */
export interface HostedReconciliationCycleSurface {
  registerSource(input: {
    readonly kind: string;
    readonly description: string;
  }): RailsCommandResult<ReconciliationSourceRecord>;
  openCycle(input: {
    readonly windowStartWallMs: number;
    readonly windowEndWallMs: number;
    readonly sourceIds: readonly string[];
    readonly ruleVersion?: number;
  }): RailsCommandResult<ReconciliationCycleRecord>;
  collectStatements(
    cycleId: string,
    statements: readonly ExternalStatementRecord[],
  ): RailsCommandResult<ReconciliationCycleRecord>;
  runMatching(cycleId: string): RailsCommandResult<CycleMatchingOutcome>;
  closeCycle(cycleId: string): RailsCommandResult<ReconciliationCycleRecord>;
}

// ---------------------------------------------------------------------------
// The hosting composition
// ---------------------------------------------------------------------------

/**
 * The hosted authorities and their injected execution dependencies. Every
 * member is optional: the hosting surface is composed from whichever
 * authorities the runtime hosts (the bun suites host the bun-loadable
 * in-process authorities; the Node harness hosts all of them including
 * the SQLite-authoritative rails authorities).
 *
 * Source: RTN-011.md lines 10-26 (the hosting pattern); the merged
 * authorities' constructor surfaces.
 */
export interface AuthorityHostingDeps {
  readonly intent?: IntentAuthority;
  readonly reservations?: ReservationLedger;
  readonly obligations?: ObligationLedgerAuthority;
  readonly settlement?: SettlementAuthority;
  /** The rails report-recording surface for the report-driven confirmed path. */
  readonly railsReport?: SettlementRailsReportSurface;
  /** The adapter connection for rail-touching commands (submit / report fetch). */
  readonly railConnection?: RailAdapterConnection;
  /** The real A13 authority surface (Node harness / server runtime). */
  readonly rails?: HostedRailsAdapterSurface;
  /** The real A14 cycle surface (Node harness / server runtime). */
  readonly reconciliation?: HostedReconciliationCycleSurface;
  readonly clearing?: ClearingAuthority;
  readonly netting?: NettingAuthority;
  readonly queues?: QueueAuthority;
  /** The injected durable write-through hooks (Node harness / server runtime). */
  readonly persist?: AuthorityPersistHooks;
}

/**
 * The rails report-recording surface used by the report-driven confirmed
 * settlement path: record one RailResultReport (an external report is
 * evidence, recorded through the A13 authority's command surface — never
 * through the adapter interface).
 *
 * Source: spec/architecture/v0.1/rails-adapters-reconciliation.md Area 13
 * ("Adapters translate protocol-authorized instructions into external
 * actions and report external results back ... without ever owning
 * protocol financial state"); rails/authority.ts recordReport.
 */
export interface SettlementRailsReportSurface {
  recordReport(
    operationId: string,
    report: RailReportEnvelope,
  ): RailsCommandResult<unknown>;
}

function requireConnection(connection: RailAdapterConnection | undefined): RailAdapterConnection {
  if (!connection) {
    throw new TypeError(
      'hosting: this command requires a rail adapter connection (transmission is the adapter interface — the hosting must inject it)',
    );
  }
  return connection;
}

/**
 * The hosted authority command bindings: one binding per command kind,
 * each driving the OWNING authority's own command surface (A15 evidence
 * first inside the authority, then the injected durable write-through).
 *
 * Source: RTN-011.md lines 14-16 (the execution path + INV-x-3
 * idempotency the authorities provide); src/lib/durable/index.ts lines
 * 14-18 (register() hosting).
 */
export function createAuthorityCommandBindings(deps: AuthorityHostingDeps): AuthorityCommandBinding[] {
  const bindings: AuthorityCommandBinding[] = [];
  const persist = deps.persist ?? {};

  // -- Intent Authority (A01) -------------------------------------------------

  if (deps.intent) {
    const intent = deps.intent;
    bindings.push({
      kind: 'intent.submit',
      authority: 'Intent Authority',
      owner: 'Intent Authority',
      async execute(envelope): Promise<AuthorityCommandOutcome> {
        const body = expectRecord(envelope.body, 'intent.submit body');
        const constraintsRecord = expectRecord(body.constraints, 'body.constraints');
        const descriptor: DemandDescriptor = demandDescriptor({
          amount: expectMoney(body.amount, 'body.amount'),
          source: expectRecord(
            body.source,
            'body.source',
          ) as Parameters<typeof demandDescriptor>[0]['source'],
          destination: expectRecord(
            body.destination,
            'body.destination',
          ) as Parameters<typeof demandDescriptor>[0]['destination'],
          constraints: {
            deadlineEpochMs: expectNumber(
              constraintsRecord.deadlineEpochMs,
              'body.constraints.deadlineEpochMs',
            ),
            allowedRails: Array.isArray(constraintsRecord.allowedRails)
              ? (constraintsRecord.allowedRails as readonly string[])
              : [],
            costCeiling: expectMoney(
              constraintsRecord.costCeiling,
              'body.constraints.costCeiling',
            ),
          },
          idempotencyKey: expectString(body.idempotencyKey, 'body.idempotencyKey'),
        });
        const priorIntentId = expectOptionalString(body.priorIntentId, 'body.priorIntentId');
        const result = await intent.submitIntent(descriptor, priorIntentId ? { priorIntentId } : {});
        if (!result.ok) {
          return { status: 'rejected', code: result.code };
        }
        persist.intent?.(result.intent, result.receipt);
        return {
          status: result.replayed ? 'replayed' : 'applied',
          summary: { intentId: result.intent.intentId, state: result.intent.state },
        };
      },
    });
    const transitionBinding = (
      kind: CommandKind,
      apply: (body: Record<string, unknown>) => Promise<AuthorityCommandOutcome & { intent?: PaymentIntent }>,
    ): AuthorityCommandBinding => ({
      kind,
      authority: 'Intent Authority',
      owner: 'Intent Authority',
      async execute(envelope) {
        const body = expectRecord(envelope.body, `${kind} body`);
        const outcome = await apply(body);
        if (outcome.intent) {
          persist.intent?.(outcome.intent);
        }
        return { status: outcome.status, code: outcome.code, summary: outcome.summary };
      },
    });
    const intentTransition = async (
      result: { ok: true; intent: PaymentIntent } | { ok: false; code: string; problem: string },
    ): Promise<AuthorityCommandOutcome & { intent?: PaymentIntent }> =>
      result.ok
        ? { status: 'applied', intent: result.intent, summary: { intentId: result.intent.intentId, state: result.intent.state } }
        : { status: 'rejected', code: result.code };
    const optionalReason = (value: unknown, field: string): IntentReasonCode | undefined =>
      value === undefined || value === null ? undefined : (expectString(value, field) as IntentReasonCode);
    bindings.push(
      transitionBinding('intent.authorize', async (body) =>
        intentTransition(
          await intent.authorizeIntent(
            expectString(body.intentId, 'body.intentId'),
            expectString(body.policyDecisionId, 'body.policyDecisionId'),
          ),
        ),
      ),
      transitionBinding('intent.route', async (body) =>
        intentTransition(
          await intent.routeIntent(expectString(body.intentId, 'body.intentId'), optionalReason(body.reasonCode, 'body.reasonCode')),
        ),
      ),
      transitionBinding('intent.fulfill.start', async (body) =>
        intentTransition(
          await intent.startFulfillingIntent(
            expectString(body.intentId, 'body.intentId'),
            optionalReason(body.reasonCode, 'body.reasonCode'),
          ),
        ),
      ),
      transitionBinding('intent.fulfill.complete', async (body) =>
        intentTransition(
          await intent.fulfillIntent(
            expectString(body.intentId, 'body.intentId'),
            optionalReason(body.reasonCode, 'body.reasonCode'),
          ),
        ),
      ),
      transitionBinding('intent.fail', async (body) =>
        intentTransition(
          await intent.failIntent(
            expectString(body.intentId, 'body.intentId'),
            expectString(body.reasonCode, 'body.reasonCode') as IntentReasonCode,
            expectOptionalString(body.failingRecordId, 'body.failingRecordId'),
          ),
        ),
      ),
      transitionBinding('intent.cancel', async (body) =>
        intentTransition(
          await intent.cancelIntent(
            expectString(body.intentId, 'body.intentId'),
            expectString(body.reasonCode, 'body.reasonCode') as IntentReasonCode,
          ),
        ),
      ),
    );
  }

  // -- Reservation Authority (A05) ---------------------------------------------

  if (deps.reservations) {
    const ledger = deps.reservations;
    type ReservationsResult =
      | ResourceDeclarationResult
      | ReservationRequestResult
      | ReservationTerminalCommandResult;
    const reservationOutcome = (result: ReservationsResult): AuthorityCommandOutcome => {
      if (!result.ok) {
        return { status: 'rejected', code: result.code };
      }
      const reservation = (result as { reservation?: { reservationId: string; state: string } }).reservation;
      return {
        status: result.replayed ? 'replayed' : 'applied',
        summary: reservation
          ? { reservationId: reservation.reservationId, state: reservation.state }
          : {},
      };
    };
    bindings.push(
      {
        kind: 'reservation.resource.declare',
        authority: 'Reservation Authority',
        owner: 'Reservation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reservation.resource.declare body');
          const result = await ledger.declareResource(
            expectString(body.resourceId, 'body.resourceId'),
            expectMoney(body.declaredTotal, 'body.declaredTotal'),
          );
          persist.reservations?.(ledger);
          return reservationOutcome(result);
        },
      },
      {
        kind: 'reservation.request',
        authority: 'Reservation Authority',
        owner: 'Reservation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reservation.request body');
          const result = await ledger.requestReservation({
            intentId: expectString(body.intentId, 'body.intentId'),
            hopId: expectString(body.hopId, 'body.hopId'),
            resourceId: expectString(body.resourceId, 'body.resourceId'),
            amount: expectMoney(body.amount, 'body.amount'),
            deadlineEpochMs: expectNumber(body.deadlineEpochMs, 'body.deadlineEpochMs'),
          });
          persist.reservations?.(ledger);
          return reservationOutcome(result);
        },
      },
      {
        kind: 'reservation.consume',
        authority: 'Reservation Authority',
        owner: 'Reservation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reservation.consume body');
          const result = await ledger.consumeReservation(expectString(body.reservationId, 'body.reservationId'));
          persist.reservations?.(ledger);
          return reservationOutcome(result);
        },
      },
      {
        kind: 'reservation.release',
        authority: 'Reservation Authority',
        owner: 'Reservation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reservation.release body');
          const result = await ledger.releaseReservation(expectString(body.reservationId, 'body.reservationId'));
          persist.reservations?.(ledger);
          return reservationOutcome(result);
        },
      },
      {
        kind: 'reservation.expire',
        authority: 'Reservation Authority',
        owner: 'Reservation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reservation.expire body');
          const at = body.at === undefined ? undefined : expectProtocolTime(body.at, 'body.at');
          const expired = await ledger.expireDueReservations(at);
          persist.reservations?.(ledger);
          return { status: 'applied', summary: { expired: expired.length } };
        },
      },
    );
  }

  // -- Obligation Authority (A10) -----------------------------------------------

  if (deps.obligations) {
    const obligations = deps.obligations;
    const obligationOutcome = (ok: boolean, code: string | undefined, summary: Record<string, unknown>): AuthorityCommandOutcome => {
      if (!ok) {
        return { status: 'rejected', code };
      }
      persist.obligations?.(obligations);
      return { status: 'applied', summary };
    };
    bindings.push(
      {
        kind: 'obligation.clearing.commit',
        authority: 'Obligation Authority',
        owner: 'Obligation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'obligation.clearing.commit body');
          const result = await obligations.applyClearingCommand({
            batchId: expectString(body.batchId, 'body.batchId'),
            recordId: expectString(body.recordId, 'body.recordId'),
            originActivityId: expectString(body.originActivityId, 'body.originActivityId'),
            originKind: expectString(body.originKind, 'body.originKind') as 'ROUTE_PLAN_HOP' | 'INTENT' | 'RECONCILIATION_ADJUSTMENT',
            debtorParticipantId: expectString(body.debtorParticipantId, 'body.debtorParticipantId'),
            creditorParticipantId: expectString(body.creditorParticipantId, 'body.creditorParticipantId'),
            amount: expectMoney(body.amount, 'body.amount'),
            reason: expectString(body.reason, 'body.reason'),
            ...(body.correctionOf === undefined ? {} : { correctionOf: expectString(body.correctionOf, 'body.correctionOf') }),
          });
          // INV-10-3: duplicate instructions are no-ops — a duplicate
          // delivery returns the recorded obligation id, never a second
          // ledger entry or evidence record.
          if (result.duplicate) {
            return { status: 'replayed', summary: { obligationId: result.obligationId } };
          }
          return obligationOutcome(true, undefined, { obligationId: result.obligationId });
        },
      },
      {
        kind: 'obligation.dispute.open',
        authority: 'Obligation Authority',
        owner: 'Obligation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'obligation.dispute.open body');
          const result = await obligations.openDispute({
            kind: 'DISPUTE_OPEN',
            obligationId: expectString(body.obligationId, 'body.obligationId'),
            disputeId: expectString(body.disputeId, 'body.disputeId'),
          });
          return result.ok
            ? obligationOutcome(true, undefined, { obligationId: result.value.obligationId, state: result.value.state })
            : { status: 'rejected', code: result.code };
        },
      },
      {
        kind: 'obligation.risk.writeoff',
        authority: 'Obligation Authority',
        owner: 'Obligation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'obligation.risk.writeoff body');
          const result = await obligations.applyRiskWriteOff({
            kind: 'RISK_WRITE_OFF',
            obligationId: expectString(body.obligationId, 'body.obligationId'),
            riskAuthorityReference: expectString(body.riskAuthorityReference, 'body.riskAuthorityReference'),
          });
          return result.ok
            ? obligationOutcome(true, undefined, { obligationId: result.value.obligationId, state: result.value.state })
            : { status: 'rejected', code: result.code };
        },
      },
      {
        kind: 'obligation.settlement.instruction',
        authority: 'Obligation Authority',
        owner: 'Obligation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'obligation.settlement.instruction body');
          const result = await obligations.applySettlementInstruction({
            kind: 'SETTLEMENT_INSTRUCTION',
            obligationId: expectString(body.obligationId, 'body.obligationId'),
            settlementInstructionId: expectString(body.settlementInstructionId, 'body.settlementInstructionId'),
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          // applied === false is the typed no-op of a redelivered
          // instruction (the obligation is already SETTLEMENT_PENDING).
          return result.value.applied
            ? obligationOutcome(true, undefined, { obligationId: result.value.obligation.obligationId, state: result.value.obligation.state })
            : { status: 'replayed', summary: { obligationId: result.value.obligation.obligationId } };
        },
      },
      {
        kind: 'obligation.settlement.finality',
        authority: 'Obligation Authority',
        owner: 'Obligation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'obligation.settlement.finality body');
          const result = await obligations.applySettlementFinality({
            kind: 'SETTLEMENT_FINALITY',
            obligationId: expectString(body.obligationId, 'body.obligationId'),
            finalityRecordId: expectString(body.finalityRecordId, 'body.finalityRecordId'),
          });
          return result.ok
            ? obligationOutcome(true, undefined, { obligationId: result.value.obligationId, state: result.value.state })
            : { status: 'rejected', code: result.code };
        },
      },
    );
  }

  // -- Settlement and Finality Authority (A12) -----------------------------------

  if (deps.settlement) {
    const settlement = deps.settlement;
    const settlementOutcome = (
      result: { ok: true; value: unknown } | { ok: false; code: string },
      summarize: (value: never) => Record<string, unknown>,
    ): AuthorityCommandOutcome => {
      if (!result.ok) {
        return { status: 'rejected', code: result.code };
      }
      persist.settlement?.(settlement);
      return { status: 'applied', summary: summarize(result.value as never) };
    };
    bindings.push(
      {
        kind: 'settlement.instruction.create',
        authority: 'Settlement and Finality Authority',
        owner: 'Settlement and Finality Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'settlement.instruction.create body');
          const subject = expectRecord(body.subject, 'body.subject');
          const kind = expectString(subject.kind, 'body.subject.kind');
          const result = await settlement.createSettlementInstruction({
            subject:
              kind === 'OBLIGATION'
                ? { kind: 'OBLIGATION', obligationId: expectString(subject.obligationId, 'body.subject.obligationId') }
                : { kind: 'NET_POSITION', netObligationId: expectString(subject.netObligationId, 'body.subject.netObligationId') },
            beneficiary: expectString(body.beneficiary, 'body.beneficiary'),
            ...(body.memo === undefined ? {} : { memo: expectOptionalString(body.memo, 'body.memo') }),
          });
          return settlementOutcome(result, (value: { instructionId: string; state: string; amount: Money }) => ({
            instructionId: value.instructionId,
            state: value.state,
            amountMinor: value.amount.amountMinor,
          }));
        },
      },
      {
        kind: 'settlement.attempt.authorize',
        authority: 'Settlement and Finality Authority',
        owner: 'Settlement and Finality Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'settlement.attempt.authorize body');
          const result = await settlement.authorizeAttempt(
            expectString(body.instructionId, 'body.instructionId'),
            expectString(body.adapterId, 'body.adapterId'),
          );
          return settlementOutcome(result, (value: { attemptId: string; state: string }) => ({
            attemptId: value.attemptId,
            state: value.state,
          }));
        },
      },
      {
        kind: 'settlement.attempt.submit',
        authority: 'Settlement and Finality Authority',
        owner: 'Settlement and Finality Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'settlement.attempt.submit body');
          const result = await settlement.submitAttempt(
            expectString(body.instructionId, 'body.instructionId'),
            requireConnection(deps.railConnection),
          );
          return settlementOutcome(result, (value: AttemptOutcomeMirror) => ({
            attemptState: value.attempt.state,
            operationState: value.operation.status,
          }));
        },
      },
      {
        kind: 'settlement.report.apply',
        authority: 'Settlement and Finality Authority',
        owner: 'Settlement and Finality Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'settlement.report.apply body');
          const instructionId = expectString(body.instructionId, 'body.instructionId');
          const attempt = settlement.attemptForInstruction(instructionId);
          if (!attempt) {
            throw new Error(`settlement.report.apply: no attempt for instruction ${instructionId}`);
          }
          const railsReport = deps.railsReport;
          if (!railsReport) {
            throw new TypeError('settlement.report.apply: the hosting must inject the rails report surface');
          }
          // The deterministic rail key derivation (INV-12-3/INV-13-3):
          // the report is fetched for the SAME key the submission used.
          const reportKey = railIdempotencyKeyForInstruction(instructionId);
          const report = requireConnection(deps.railConnection).fetchReport(reportKey);
          const recorded = railsReport.recordReport(attempt.operationId, report);
          if (!recorded.ok) {
            return { status: 'rejected', code: 'RAIL_REPORT_REJECTED' };
          }
          const result = await settlement.applyRailOutcome(instructionId);
          return settlementOutcome(result, (value: AttemptOutcomeMirror) => ({
            attemptState: value.attempt.state,
            operationState: value.operation.status,
          }));
        },
      },
      {
        kind: 'settlement.declare.finality',
        authority: 'Settlement and Finality Authority',
        owner: 'Settlement and Finality Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'settlement.declare.finality body');
          const result = await settlement.declareFinality(expectString(body.instructionId, 'body.instructionId'));
          return settlementOutcome(result, (value: { finalityRecordId: string; state: string }) => ({
            finalityRecordId: value.finalityRecordId,
            state: value.state,
          }));
        },
      },
    );
  }

  // -- Rail Adapter Authority (A13) — the real surface is Node-only ---------------

  if (deps.rails) {
    const rails = deps.rails;
    const railsOutcome = (
      result: RailsCommandResult<unknown>,
      summarize: (value: never) => Record<string, unknown>,
    ): AuthorityCommandOutcome =>
      result.ok
        ? { status: 'applied', summary: summarize(result.value as never) }
        : { status: 'rejected', code: result.reasonCode };
    bindings.push(
      {
        // The envelope authority targets the registry's owning authority
        // for area 13 ('Rail Authority' — protocol-registry.json); the
        // hosted surface drives the A13 modules' own command surface.
        kind: 'rails.adapter.register',
        authority: 'Rail Authority',
        owner: 'Rail Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'rails.adapter.register body');
          const result = rails.registerAdapter({
            railFamily: expectString(body.railFamily, 'body.railFamily'),
            name: expectString(body.name, 'body.name'),
          });
          return railsOutcome(result, (value: RailAdapterRecord) => ({ adapterId: value.adapterId, status: value.status }));
        },
      },
      {
        kind: 'rails.adapter.activate',
        authority: 'Rail Authority',
        owner: 'Rail Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'rails.adapter.activate body');
          const result = rails.activateAdapter(expectString(body.adapterId, 'body.adapterId'));
          return railsOutcome(result, (value: RailAdapterRecord) => ({ adapterId: value.adapterId, status: value.status }));
        },
      },
      {
        kind: 'rails.operation.authorize',
        authority: 'Rail Authority',
        owner: 'Rail Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'rails.operation.authorize body');
          const result = rails.authorizeOperation({
            instructionId: expectString(body.instructionId, 'body.instructionId'),
            adapterId: expectString(body.adapterId, 'body.adapterId'),
            payload: body.payload === undefined ? null : body.payload,
          });
          return railsOutcome(result, (value: RailOperationRecord) => ({ operationId: value.operationId, status: value.status }));
        },
      },
      {
        kind: 'rails.operation.submit',
        authority: 'Rail Authority',
        owner: 'Rail Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'rails.operation.submit body');
          const result = rails.submitRailOperation(
            expectString(body.operationId, 'body.operationId'),
            requireConnection(deps.railConnection),
          );
          return railsOutcome(result, (value: RailsSubmitOutcome) => ({
            operationId: value.operation.operationId,
            status: value.operation.status,
          }));
        },
      },
    );
  }

  // -- Clearing Authority (A09) ----------------------------------------------------

  if (deps.clearing) {
    const clearing = deps.clearing;
    bindings.push(
      {
        kind: 'clearing.batch.open',
        authority: 'Clearing Authority',
        owner: 'Clearing Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'clearing.batch.open body');
          const batchLabel = expectString(body.batchLabel, 'body.batchLabel');
          const result = await clearing.openBatch({ batchLabel });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.clearing?.(clearing, result.value.batchId, batchLabel);
          return { status: 'applied', summary: { batchId: result.value.batchId, state: result.value.state } };
        },
      },
      {
        kind: 'clearing.batch.stage',
        authority: 'Clearing Authority',
        owner: 'Clearing Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'clearing.batch.stage body');
          const result = await clearing.stageBatch(expectString(body.batchId, 'body.batchId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.clearing?.(clearing, result.value.batchId);
          return { status: 'applied', summary: { batchId: result.value.batchId, state: result.value.state } };
        },
      },
      {
        kind: 'clearing.batch.commit',
        authority: 'Clearing Authority',
        owner: 'Clearing Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'clearing.batch.commit body');
          const result = await clearing.commitBatch(expectString(body.batchId, 'body.batchId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.clearing?.(clearing, result.value.batch.batchId);
          // commitBatch reports the INV-9-3 replay flag directly.
          return {
            status: result.value.replayed ? 'replayed' : 'applied',
            summary: { batchId: result.value.batch.batchId, state: result.value.batch.state },
          };
        },
      },
      {
        kind: 'clearing.batch.finalize',
        authority: 'Clearing Authority',
        owner: 'Clearing Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'clearing.batch.finalize body');
          const result = await clearing.finalizeBatch(expectString(body.batchId, 'body.batchId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.clearing?.(clearing, result.value.batchId);
          return { status: 'applied', summary: { batchId: result.value.batchId, state: result.value.state } };
        },
      },
      {
        // The recurring clearing-batch tick command (emitted by the
        // scheduler wiring): opens — idempotently by window label — the
        // window's clearing batch. A re-delivered tick finds the label
        // used and completes as the typed duplicate rejection (no second
        // effect); a re-EMITTED tick is deduplicated at enqueue by the
        // scheduler's per-tick idempotency key.
        kind: 'clearing.batch.tick',
        authority: 'Clearing Authority',
        owner: 'Clearing Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'clearing.batch.tick body');
          const batchLabel = expectString(body.batchLabel, 'body.batchLabel');
          const result = await clearing.openBatch({ batchLabel });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.clearing?.(clearing, result.value.batchId, batchLabel);
          return { status: 'applied', summary: { batchId: result.value.batchId, state: result.value.state } };
        },
      },
    );
  }

  // -- Netting Authority (A11) -------------------------------------------------------

  if (deps.netting) {
    const netting = deps.netting;
    bindings.push(
      {
        kind: 'netting.set.open',
        authority: 'Netting Authority',
        owner: 'Netting Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'netting.set.open body');
          const scope = expectRecord(body.scope, 'body.scope');
          const label = expectString(body.label, 'body.label');
          const result = await netting.openNettingSet({
            label,
            scope: {
              kind: expectString(scope.kind, 'body.scope.kind') as 'BILATERAL' | 'MULTILATERAL',
              participants: Array.isArray(scope.participants)
                ? (scope.participants as readonly string[])
                : [],
            },
            inputObligationIds: Array.isArray(body.inputObligationIds)
              ? (body.inputObligationIds as readonly string[])
              : [],
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.netting?.(netting, result.value.nettingSetId, label);
          return { status: 'applied', summary: { nettingSetId: result.value.nettingSetId, state: result.value.state } };
        },
      },
      {
        kind: 'netting.set.compute',
        authority: 'Netting Authority',
        owner: 'Netting Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'netting.set.compute body');
          const result = await netting.computeNettingSet(expectString(body.nettingSetId, 'body.nettingSetId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.netting?.(netting, result.value.nettingSetId);
          return { status: 'applied', summary: { nettingSetId: result.value.nettingSetId, state: result.value.state } };
        },
      },
      {
        kind: 'netting.set.commit',
        authority: 'Netting Authority',
        owner: 'Netting Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'netting.set.commit body');
          const result = await netting.commitNettingSet(expectString(body.nettingSetId, 'body.nettingSetId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.netting?.(netting, result.value.set.nettingSetId);
          // INV-11-3: re-commit of a committed set id is a no-op.
          return {
            status: result.value.noop ? 'replayed' : 'applied',
            summary: { nettingSetId: result.value.set.nettingSetId, state: result.value.set.state },
          };
        },
      },
      {
        // The recurring netting-cycle tick command: opens the window's
        // netting set over the configured input obligation ids.
        kind: 'netting.set.tick',
        authority: 'Netting Authority',
        owner: 'Netting Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'netting.set.tick body');
          const scope = expectRecord(body.scope, 'body.scope');
          const label = expectString(body.label, 'body.label');
          const result = await netting.openNettingSet({
            label,
            scope: {
              kind: expectString(scope.kind, 'body.scope.kind') as 'BILATERAL' | 'MULTILATERAL',
              participants: Array.isArray(scope.participants)
                ? (scope.participants as readonly string[])
                : [],
            },
            inputObligationIds: Array.isArray(body.inputObligationIds)
              ? (body.inputObligationIds as readonly string[])
              : [],
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.netting?.(netting, result.value.nettingSetId, label);
          return { status: 'applied', summary: { nettingSetId: result.value.nettingSetId, state: result.value.state } };
        },
      },
    );
  }

  // -- Queue Authority (A08) -----------------------------------------------------------

  if (deps.queues) {
    const queues = deps.queues;
    bindings.push(
      {
        kind: 'queues.queue.create',
        authority: 'Queue Authority',
        owner: 'Queue Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'queues.queue.create body');
          const policyRecord = expectRecord(body.policy, 'body.policy');
          const releaseConditionsRecord = expectRecord(
            policyRecord.releaseConditions ?? {},
            'body.policy.releaseConditions',
          );
          const result = await queues.createQueue({
            queueId: expectString(body.queueId, 'body.queueId'),
            policy: {
              orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
              maxWaitEpochMs: expectNumber(policyRecord.maxWaitEpochMs, 'body.policy.maxWaitEpochMs'),
              releaseConditions: {
                ...(releaseConditionsRecord.requiredCapabilityTier === undefined
                  ? {}
                  : {
                      requiredCapabilityTier: expectString(
                        releaseConditionsRecord.requiredCapabilityTier,
                        'body.policy.releaseConditions.requiredCapabilityTier',
                      ),
                    }),
                ...(releaseConditionsRecord.minLiquidityAvailable === undefined
                  ? {}
                  : {
                      minLiquidityAvailable: expectMoney(
                        releaseConditionsRecord.minLiquidityAvailable,
                        'body.policy.releaseConditions.minLiquidityAvailable',
                      ),
                    }),
                ...(releaseConditionsRecord.minCreditRemaining === undefined
                  ? {}
                  : {
                      minCreditRemaining: expectMoney(
                        releaseConditionsRecord.minCreditRemaining,
                        'body.policy.releaseConditions.minCreditRemaining',
                      ),
                    }),
              },
            },
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.queues?.(queues, expectString(body.queueId, 'body.queueId'));
          // INV-8 idempotency: identical re-creation replays the recorded queue.
          return {
            status: result.replayed ? 'replayed' : 'applied',
            summary: { queueId: result.record.queueId, state: result.record.state },
          };
        },
      },
      {
        kind: 'queues.eligibility.evaluate',
        authority: 'Queue Authority',
        owner: 'Queue Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'queues.eligibility.evaluate body');
          const snapshot = expectRecord(body.snapshot, 'body.snapshot');
          const result = await queues.evaluateEligibility({
            queueId: expectString(body.queueId, 'body.queueId'),
            snapshot: {
              liquidity: Array.isArray(snapshot.liquidity) ? (snapshot.liquidity as never) : [],
              capability: Array.isArray(snapshot.capability) ? (snapshot.capability as never) : [],
              credit: Array.isArray(snapshot.credit) ? (snapshot.credit as never) : [],
              at: expectProtocolTime(snapshot.at, 'body.snapshot.at'),
            },
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.queues?.(queues, expectString(body.queueId, 'body.queueId'));
          return { status: 'applied', summary: { released: result.record.length } };
        },
      },
      {
        kind: 'queues.items.expire',
        authority: 'Queue Authority',
        owner: 'Queue Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'queues.items.expire body');
          const at = body.at === undefined ? undefined : expectProtocolTime(body.at, 'body.at');
          const result = await queues.expireDueItems({
            queueId: expectString(body.queueId, 'body.queueId'),
            ...(at === undefined ? {} : { at }),
          });
          if (!result.ok) {
            return { status: 'rejected', code: result.code };
          }
          persist.queues?.(queues, expectString(body.queueId, 'body.queueId'));
          return { status: 'applied', summary: { expired: result.record.length } };
        },
      },
      {
        // The recurring queue-eligibility scan tick command: evaluates
        // the snapshot-driven eligibility release over a queue (A08's
        // evaluation never probes rails — the snapshot is carried by the
        // command, per the scheduler boundary: timing only).
        kind: 'queues.eligibility.tick',
        authority: 'Queue Authority',
        owner: 'Queue Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'queues.eligibility.tick body');
          const scans = Array.isArray(body.scans) ? (body.scans as readonly unknown[]) : [];
          let released = 0;
          for (const scan of scans) {
            const record = expectRecord(scan, 'body.scans[]');
            const snapshot = expectRecord(record.snapshot, 'body.scans[].snapshot');
            const result = await queues.evaluateEligibility({
              queueId: expectString(record.queueId, 'body.scans[].queueId'),
              snapshot: {
                liquidity: Array.isArray(snapshot.liquidity) ? (snapshot.liquidity as never) : [],
                capability: Array.isArray(snapshot.capability) ? (snapshot.capability as never) : [],
                credit: Array.isArray(snapshot.credit) ? (snapshot.credit as never) : [],
                at: expectProtocolTime(snapshot.at, 'body.scans[].snapshot.at'),
              },
            });
            if (!result.ok) {
              return { status: 'rejected', code: result.code };
            }
            released += result.record.length;
            persist.queues?.(queues, expectString(record.queueId, 'body.scans[].queueId'));
          }
          return { status: 'applied', summary: { released } };
        },
      },
    );
  }

  // -- Reconciliation Authority (A14) — the real cycle surface is Node-only -------------

  if (deps.reconciliation) {
    const reconciliation = deps.reconciliation;
    const cycleOutcome = (
      result: RailsCommandResult<unknown>,
      summarize: (value: never) => Record<string, unknown>,
    ): AuthorityCommandOutcome =>
      result.ok
        ? { status: 'applied', summary: summarize(result.value as never) }
        : { status: 'rejected', code: result.reasonCode };
    bindings.push(
      {
        kind: 'reconciliation.source.register',
        authority: 'Reconciliation Authority',
        owner: 'Reconciliation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reconciliation.source.register body');
          const result = reconciliation.registerSource({
            kind: expectString(body.kind, 'body.kind'),
            description: expectString(body.description, 'body.description'),
          });
          return cycleOutcome(result, (value: ReconciliationSourceRecord) => ({ sourceId: value.sourceId }));
        },
      },
      {
        // The recurring reconciliation-cycle tick command: opens the
        // window's reconciliation cycle (deterministic cycle identity per
        // window — the cycle id derives from (windowStart, windowEnd,
        // ruleVersion)).
        kind: 'reconciliation.cycle.tick',
        authority: 'Reconciliation Authority',
        owner: 'Reconciliation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reconciliation.cycle.tick body');
          const result = reconciliation.openCycle({
            windowStartWallMs: expectNumber(body.windowStartWallMs, 'body.windowStartWallMs'),
            windowEndWallMs: expectNumber(body.windowEndWallMs, 'body.windowEndWallMs'),
            sourceIds: Array.isArray(body.sourceIds) ? (body.sourceIds as readonly string[]) : [],
            ...(body.ruleVersion === undefined ? {} : { ruleVersion: expectNumber(body.ruleVersion, 'body.ruleVersion') }),
          });
          return cycleOutcome(result, (value: ReconciliationCycleRecord) => ({
            cycleId: value.cycleId,
            status: value.status,
          }));
        },
      },
      {
        kind: 'reconciliation.cycle.collect',
        authority: 'Reconciliation Authority',
        owner: 'Reconciliation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reconciliation.cycle.collect body');
          const statements = Array.isArray(body.statements)
            ? (body.statements as readonly ExternalStatementRecord[])
            : [];
          const result = reconciliation.collectStatements(expectString(body.cycleId, 'body.cycleId'), statements);
          return cycleOutcome(result, (value: ReconciliationCycleRecord) => ({ cycleId: value.cycleId, status: value.status }));
        },
      },
      {
        kind: 'reconciliation.cycle.match',
        authority: 'Reconciliation Authority',
        owner: 'Reconciliation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reconciliation.cycle.match body');
          const result = reconciliation.runMatching(expectString(body.cycleId, 'body.cycleId'));
          if (!result.ok) {
            return { status: 'rejected', code: result.reasonCode };
          }
          return {
            status: 'applied',
            summary: {
              cycleId: result.value.cycle.cycleId,
              matched: result.value.match.matched.length,
            },
          };
        },
      },
      {
        kind: 'reconciliation.cycle.close',
        authority: 'Reconciliation Authority',
        owner: 'Reconciliation Authority',
        async execute(envelope) {
          const body = expectRecord(envelope.body, 'reconciliation.cycle.close body');
          const result = reconciliation.closeCycle(expectString(body.cycleId, 'body.cycleId'));
          return cycleOutcome(result, (value: ReconciliationCycleRecord) => ({ cycleId: value.cycleId, status: value.status }));
        },
      },
    );
  }

  // Duplicate-kind guard: one binding per command kind, enforced here so
  // the transition runtime's constructor invariant can never be tripped
  // by a composition error.
  const seen = new Set<CommandKind>();
  for (const binding of bindings) {
    if (seen.has(binding.kind)) {
      throw new TypeError(`createAuthorityCommandBindings: duplicate binding for kind ${binding.kind}`);
    }
    seen.add(binding.kind);
  }
  return bindings;
}

/**
 * Enqueue one command through the substrate's PUBLIC enqueue API — the
 * kernel envelope's 1:1 mapping onto the DEP-003 enqueue contract
 * (commandEnvelopeToEnqueueInput). This is the TEST-HARNESS admission
 * path (rtn-plan-rulings.md delta 5: production admission remains
 * exclusively RTN-010's gateway); the scheduler wiring uses the
 * substrate's scheduleRecurring (which enqueues through the same public
 * queue).
 *
 * Source: rtn-plan-rulings.md delta 5; kernel envelope.ts
 * (commandEnvelopeToEnqueueInput — "Map a validated command envelope 1:1
 * onto the DEP-003 enqueue contract"); spec/durable/execution.md §6.
 */
export function enqueueCommand(
  substrate: TransitionSubstrate,
  envelope: CommandEnvelope,
  options?: Omit<EnqueueOptions, 'idempotencyKey'>,
): EnqueueResult {
  const input = commandEnvelopeToEnqueueInput(envelope);
  return substrate.enqueue(input.kind, input.payload, {
    ...options,
    idempotencyKey: input.idempotencyKey,
  });
}
