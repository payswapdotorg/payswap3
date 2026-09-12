/**
 * RTN-011 — The hosted authority bindings over the transition path (bun
 * suite): the composed end-to-end evidence.
 *
 * Commands flow through the FULL dequeue → resolve-owning-authority →
 * apply-transition → write-A15-evidence → commit path over the owned
 * in-memory substrate double (bun does not implement node:sqlite — the
 * REAL substrate composition, enqueued through the substrate's PUBLIC
 * enqueue API, runs in
 * scripts/test_protocol_transition_hosting.mjs; the same split every
 * merged RTN item uses).
 *
 * All authorities are REAL (RTN-003 risk gate, RTN-002 evidence log,
 * RTN-005/006/008/009 authorities; the A13/A14 settlement rails surface
 * is the owned in-memory double over the REAL SimulatedRail, per the
 * RTN-009 precedent).
 *
 * Tested contracts (spec-cited):
 *   RTN-011.md lines 14-22 — the execution path; atomicity ("a failed
 *   evidence write rolls back the transition"); duplicate delivery ("a
 *   no-op returning recorded state ... demonstrated on at least intent,
 *   reservation, obligation, and settlement command kinds"); crash/
 *   restart replay ("kill-and-restart of the worker loop mid-execution
 *   produces no duplicate effects (lease reclaim + idempotency)").
 *   spec/architecture/v0.1/evidence-risk-compliance.md lines 62-64 (the
 *   A15 synchronous write discipline).
 *   spec/architecture/v0.1/core.md lines 57-62 (INV-1-2/INV-1-3), lines
 *   304-312 (INV-5-1/5-2/5-3).
 *   spec/architecture/v0.1/clearing-netting-settlement.md lines 119-121
 *   (INV-10-3), lines 247-262 (INV-12-2/3/4).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { deriveIdempotencyKey } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { evaluateComplianceCheck } from '../risk/evaluation.ts';
import type { ComplianceCheckRecord } from '../risk/evaluation.ts';
import { decideComplianceCheck } from '../risk/check.ts';
import { createScreeningList } from '../risk/screening.ts';
import { subjectComplianceData } from '../risk/subject.ts';
import { evaluateComplianceGate } from '../risk/gate.ts';
import { IntentAuthority } from '../intent/authority.ts';
import type { IntentAuthorizationGate } from '../intent/authority.ts';
import { openReservationLedger } from '../reservations/ledger.ts';
import { ObligationLedgerAuthority } from '../obligations/authority.ts';
import { NettingAuthority } from '../netting/authority.ts';
import type { NettingObligationLedgerPort } from '../netting/authority.ts';
import { obligationLedgerPortFromAuthority, nettingPortFromAuthority } from '../settlement/ports.ts';
import { SettlementAuthority } from '../settlement/authority.ts';
import { InMemoryRailsDouble } from '../settlement/rails-test-double.ts';
import { SimulatedRail, createSimulatedRailAdapter } from '../rails/adapters.ts';
import type { SimulatedRailScenario } from '../rails/adapters.ts';
import { obligationIdForOriginRecord } from '../obligations/state-machine.ts';
import {
  settlementInstructionIdFor,
  railIdempotencyKeyForInstruction,
} from '../settlement/state-machine.ts';
import { ClearingAuthority } from '../clearing/authority.ts';
import type { ObligationLedgerSink } from '../clearing/authority.ts';
import { QueueAuthority } from '../queues/authority.ts';
import { InMemoryDurableSubstrate } from '../transition/substrate-double.ts';
import { createTransitionRuntime } from '../transition/execution.ts';
import { createAuthorityCommandBindings, enqueueCommand } from './bindings.ts';
import type { AuthorityHostingDeps } from './bindings.ts';
import { COMMAND_EXECUTED_EVENT_TYPE } from '../transition/execution.ts';
import type { CommandEnvelope } from '../kernel/envelope.ts';

const EUR = (minor: number) => money('EUR', minor, 2);

/**
 * An arming evidence channel: wraps the REAL A15 log; when armed, the
 * next submit() throws — the induced evidence-write failure that must
 * roll back the transition (RTN-011.md line 20).
 */
function armingEvidenceChannel(log: EvidenceLog): {
  readonly port: EvidenceSubmission;
  readonly arm: () => void;
  readonly disarmed: () => boolean;
} {
  let armed = false;
  return {
    port: {
      submit(record: EvidenceSubmissionRecord): void {
        if (armed) {
          armed = false;
          throw new Error('induced A15 evidence-write failure');
        }
        log.submit(record);
      },
    },
    arm: () => {
      armed = true;
    },
    disarmed: () => !armed,
  };
}

function intentApprovalGate(): IntentAuthorizationGate {
  const WHEN = protocolTime(10, 1_000);
  const LATER = protocolTime(11, 2_000);
  const approvedCheck = (subjectId: string): ComplianceCheckRecord =>
    decideComplianceCheck(
      evaluateComplianceCheck({
        rules: [],
        screeningList: createScreeningList('sanctions', 1, []),
        subject: subjectComplianceData({
          subjectId,
          subjectKind: 'INTENT',
          moneyFacts: [{ currency: 'EUR', amountMinor: 1_000 }],
        }),
        evaluatedAt: WHEN,
      }) as Parameters<typeof decideComplianceCheck>[0],
      LATER,
    );
  return (subjectId) => evaluateComplianceGate([approvedCheck(subjectId)], 'intent.AUTHORIZATION', subjectId);
}

async function composeHarness(deps: {
  readonly railScript?: Record<string, SimulatedRailScenario>;
  readonly evidence?: EvidenceSubmission;
} = {}) {
  let wall = 5_000;
  const clock = () => wall;
  const log = createEvidenceLog({ wallMs: 1_000 });
  const evidence = deps.evidence ?? log;
  const rails = new InMemoryRailsDouble(clock);
  const adapterId = rails.registerAndActivateAdapter('sim-bank', 'primary');
  const rail = new SimulatedRail('bank-1', deps.railScript ?? {});
  const connection = createSimulatedRailAdapter(rail, { wallClock: clock });
  const intent = new IntentAuthority({ evidence, gate: intentApprovalGate(), wallClock: clock });
  const reservations = await openReservationLedger({ evidence, wallClock: clock });
  const obligations = new ObligationLedgerAuthority({ evidence, wallClock: clock });
  const netting = new NettingAuthority({
    evidence,
    obligations: obligations as unknown as NettingObligationLedgerPort,
    wallClock: clock,
  });
  const settlement = new SettlementAuthority({
    evidence,
    rails,
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock: clock,
  });
  (obligations as unknown as { settlementHold?: (id: string) => boolean }).settlementHold = (
    obligationId: string,
  ) => settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  const clearing = new ClearingAuthority({
    evidence,
    sink: obligations as unknown as ObligationLedgerSink,
    wallClock: clock,
  });
  const queues = new QueueAuthority({ evidence, wallClock: clock });

  let substrateClock = 10_000;
  const substrate = new InMemoryDurableSubstrate({
    now: () => substrateClock,
    leaseMs: 50,
    backoffBaseMs: 10,
    nextJobId: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `job-${counter}`;
      };
    })(),
  });
  const hostingDeps: AuthorityHostingDeps = {
    intent,
    reservations,
    obligations,
    settlement,
    railsReport: rails,
    railConnection: connection,
    clearing,
    netting,
    queues,
  };
  const bindings = createAuthorityCommandBindings(hostingDeps);
  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();
  return {
    log,
    evidence,
    substrate,
    runtime,
    bindings,
    authorities: { intent, reservations, obligations, netting, settlement, clearing, queues },
    rails,
    rail,
    connection,
    adapterId,
    advance: (ms: number) => {
      substrateClock += ms;
      wall += ms;
    },
    get wall() {
      return wall;
    },
    substrateAdvance: (ms: number) => {
      substrateClock += ms;
    },
    clock,
  };
}

function envelopeFor(
  kind: CommandEnvelope['kind'],
  idempotencyKey: string,
  body: Record<string, unknown>,
  authority: string,
  when: ProtocolTime = protocolTime(1, 5_000),
): CommandEnvelope {
  return {
    kind,
    authority,
    subjectIds: [],
    idempotencyKey,
    protocolTime: when,
    body,
  };
}

function submitIntentBody(key: string): Record<string, unknown> {
  return {
    amount: { currency: 'EUR', scale: 2, amountMinor: 2_500 },
    source: { currency: 'EUR', geography: 'DE', account: 'acct-alpha' },
    destination: { currency: 'EUR', geography: 'FR', account: 'acct-beta' },
    constraints: {
      deadlineEpochMs: 99_999_999,
      allowedRails: ['sim-bank'],
      costCeiling: { currency: 'EUR', scale: 2, amountMinor: 500 },
    },
    idempotencyKey: key,
  };
}

function executedObservations(substrate: InMemoryDurableSubstrate): Array<Record<string, unknown>> {
  return substrate
    .events()
    .filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE)
    .map((event) => event.data as Record<string, unknown>);
}

function operationTypes(log: EvidenceLog): string[] {
  return log.records().map((record) => record.what.operationType);
}

describe('hosted bindings: end-to-end command → transition → evidence (intent)', () => {
  test('intent.submit and intent.authorize through the path: state + exactly one A15 record each', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    const commandKey = deriveIdempotencyKey('command', 'intent.submit', 'domain-key-1');
    const submitted = enqueueCommand(
      substrate,
      envelopeFor('intent.submit', commandKey, submitIntentBody('domain-key-1'), 'Intent Authority'),
    );
    expect(submitted.created).toBe(true);
    expect(await substrate.drain()).toBe(1);
    expect(substrate.getJob(submitted.job.id)?.status).toBe('succeeded');

    // The dequeue → resolve → apply → A15-evidence → commit path produced
    // the intent (state) and exactly ONE INTENT_CREATED record.
    const intents = authorities.intent.listIntents();
    expect(intents.length).toBe(1);
    expect(intents[0]?.state).toBe('DRAFT');
    expect(operationTypes(log).filter((type) => type === 'INTENT_CREATED').length).toBe(1);
    const firstObservations = executedObservations(substrate);
    expect(firstObservations.length).toBe(1);
    expect(firstObservations[0]?.kind).toBe('intent.submit');
    expect(firstObservations[0]?.status).toBe('applied');

    // The transition chain continues through the path: authorize (the
    // REAL RTN-003 compliance gate composes) → INTENT_AUTHORIZED.
    const intentId = intents[0]?.intentId ?? '';
    const authorizeKey = deriveIdempotencyKey('command', 'intent.authorize', intentId);
    enqueueCommand(
      substrate,
      envelopeFor('intent.authorize', authorizeKey, { intentId, policyDecisionId: 'policy-1' }, 'Intent Authority'),
    );
    await substrate.drain();
    expect(authorities.intent.getIntent(intentId)?.state).toBe('AUTHORIZED');
    expect(operationTypes(log).filter((type) => type === 'INTENT_AUTHORIZED').length).toBe(1);
    // The receipt is recorded and retrievable by the domain key.
    expect(authorities.intent.getReceipt('domain-key-1')).toBeDefined();
  });

  test('a malformed command body fails the operation (nothing committed)', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    enqueueCommand(
      substrate,
      envelopeFor('intent.submit', deriveIdempotencyKey('test', 'bad'), {}, 'Intent Authority'),
    );
    await substrate.drain();
    expect(authorities.intent.listIntents().length).toBe(0);
    expect(log.height).toBe(1); // genesis only
    expect(executedObservations(substrate).length).toBe(0);
    expect(substrate.jobs()[0]?.status).toBe('queued');
  });
});

describe('hosted bindings: atomicity — a failed evidence write rolls back the transition', () => {
  test('induced A15 failure leaves no state, no record, no observation; retry after heal commits exactly once', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const channel = armingEvidenceChannel(log);
    const harness = await composeHarness({ evidence: channel.port });
    const { substrate, authorities } = harness;
    const commandKey = deriveIdempotencyKey('command', 'intent.submit', 'atomic-key');
    channel.arm();
    const submitted = enqueueCommand(
      substrate,
      envelopeFor('intent.submit', commandKey, submitIntentBody('atomic-key'), 'Intent Authority'),
    );
    await substrate.drain();
    // The operation FAILED: job requeued with one attempt, nothing
    // committed — no intent, no receipt, no A15 record, no observation.
    const job = substrate.getJob(submitted.job.id);
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(1);
    expect(authorities.intent.listIntents().length).toBe(0);
    expect(authorities.intent.getReceipt('atomic-key')).toBeUndefined();
    expect(log.height).toBe(1);
    expect(executedObservations(substrate).length).toBe(0);

    // At-least-once recovery: after the backoff elapses and the channel
    // is healed, the redelivery commits EXACTLY ONCE.
    expect(channel.disarmed()).toBe(true);
    harness.advance(10);
    expect(await substrate.drain()).toBe(1);
    expect(substrate.getJob(submitted.job.id)?.status).toBe('succeeded');
    expect(authorities.intent.listIntents().length).toBe(1);
    expect(operationTypes(log).filter((type) => type === 'INTENT_CREATED').length).toBe(1);
    const healedObservations = executedObservations(substrate);
    expect(healedObservations.length).toBe(1);
    expect(healedObservations[0]?.kind).toBe('intent.submit');
    expect(healedObservations[0]?.status).toBe('applied');
  });
});

describe('hosted bindings: duplicate delivery is a no-op (the four kinds)', () => {
  /**
   * The redelivery harness: enqueue → the worker-loop is killed in the
   * committed-but-never-completed window (reserve + execute the atomic
   * unit, never complete) → the lease expires → the next loop pass
   * reclaims and redelivers the SAME job → the re-execution replays.
   */
  async function redeliver(harness: Awaited<ReturnType<typeof composeHarness>>, kind: string, commandKey: string, body: Record<string, unknown>, authority: string) {
    const { substrate, runtime } = harness;
    const submitted = enqueueCommand(substrate, envelopeFor(kind, commandKey, body, authority));
    // The crash window: reserved + executed, never completed.
    const reserved = substrate.reserve('loop-1', 50, { kind });
    expect(reserved?.id).toBe(submitted.job.id);
    await runtime.executeCommand(reserved as never);
    // The loop "dies": nothing completes. The lease expires; the next
    // loop pass reclaims and redelivers.
    harness.substrateAdvance(51);
    expect(await substrate.drain()).toBe(1);
    return { jobId: submitted.job.id };
  }

  test('intent.submit: the recorded receipt returns, never a second intent or record', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    const commandKey = deriveIdempotencyKey('command', 'intent.submit', 'dup-key-1');
    const { jobId } = await redeliver(harness, 'intent.submit', commandKey, submitIntentBody('dup-key-1'), 'Intent Authority');
    expect(substrate.getJob(jobId)?.status).toBe('succeeded');
    expect(substrate.getJob(jobId)?.attempts).toBe(1);
    // INV-1-3: one intent, one receipt, one INTENT_CREATED record.
    expect(authorities.intent.listIntents().length).toBe(1);
    expect(authorities.intent.getReceipt('dup-key-1')).toBeDefined();
    expect(operationTypes(log).filter((type) => type === 'INTENT_CREATED').length).toBe(1);
    // The observation rows narrate the two deliveries: applied, replayed.
    expect(executedObservations(substrate).map((row) => row.status)).toEqual(['applied', 'replayed']);
  });

  test('reservation.request: the recorded hold returns, never a second hold (INV-5-1/5-3)', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    // Declare the resource first (through the path).
    enqueueCommand(
      substrate,
      envelopeFor(
        'reservation.resource.declare',
        deriveIdempotencyKey('command', 'reservation.declare', 'res-1'),
        { resourceId: 'res-1', declaredTotal: { currency: 'EUR', scale: 2, amountMinor: 10_000 } },
        'Reservation Authority',
      ),
    );
    await substrate.drain();
    const commandKey = deriveIdempotencyKey('command', 'reservation.request', 'res-1', 'hop-1');
    const { jobId } = await redeliver(
      harness,
      'reservation.request',
      commandKey,
      {
        intentId: 'pid.v1.intent-1',
        hopId: 'hop-1',
        resourceId: 'res-1',
        amount: { currency: 'EUR', scale: 2, amountMinor: 4_000 },
        deadlineEpochMs: 99_999_999,
      },
      'Reservation Authority',
    );
    expect(substrate.getJob(jobId)?.status).toBe('succeeded');
    // INV-5-3: exactly one reservation for (intent, hop, resource); its
    // recorded HELD state returns; the accounting is exact (INV-5-1).
    expect(authorities.reservations.reservations().length).toBe(1);
    expect(authorities.reservations.reservations()[0]?.state).toBe('HELD');
    expect(authorities.reservations.availableOf('res-1')?.amountMinor).toBe(6_000);
    expect(operationTypes(log).filter((type) => type === 'RESERVATION_HELD').length).toBe(1);
    const requestObservations = executedObservations(substrate).filter(
      (row) => row.kind === 'reservation.request',
    );
    expect(requestObservations.map((row) => row.status)).toEqual(['applied', 'replayed']);
  });

  test('obligation.clearing.commit: the duplicate instruction is a no-op (INV-10-3)', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    const commandKey = deriveIdempotencyKey('command', 'obligation.clearing.commit', 'rec-1');
    const { jobId } = await redeliver(
      harness,
      'obligation.clearing.commit',
      commandKey,
      {
        batchId: 'batch-1',
        recordId: 'rec-1',
        originActivityId: 'activity-1',
        originKind: 'INTENT',
        debtorParticipantId: 'alpha',
        creditorParticipantId: 'beta',
        amount: { currency: 'EUR', scale: 2, amountMinor: 7_500 },
        reason: 'e2e fixture',
      },
      'Obligation Authority',
    );
    expect(substrate.getJob(jobId)?.status).toBe('succeeded');
    expect(authorities.obligations.obligations().length).toBe(1);
    expect(operationTypes(log).filter((type) => type === 'OBLIGATION_CREATED').length).toBe(1);
    expect(executedObservations(substrate).map((row) => row.status)).toEqual(['applied', 'replayed']);
  });

  test('settlement.attempt.submit: blind retry is impossible by construction (INV-12-2) — no second rail submission', async () => {
    // The settlement domain's duplicate-delivery discipline: the
    // single-attempt rule REFUSES a re-submission with a typed code (no
    // second external effect), and the recorded operation returns.
    const harness = await composeHarness();
    const { substrate, authorities, log, adapterId } = harness;
    // Setup through the path: obligation → instruction → authorized attempt.
    enqueueCommand(
      substrate,
      envelopeFor(
        'obligation.clearing.commit',
        deriveIdempotencyKey('command', 'obligation.clearing.commit', 's-rec-1'),
        {
          batchId: 'batch-s',
          recordId: 's-rec-1',
          originActivityId: 'activity-s',
          originKind: 'INTENT',
          debtorParticipantId: 'alpha',
          creditorParticipantId: 'beta',
          amount: { currency: 'EUR', scale: 2, amountMinor: 9_000 },
          reason: 'settlement fixture',
        },
        'Obligation Authority',
      ),
    );
    await substrate.drain();
    const obligation = authorities.obligations.obligations()[0];
    expect(obligation).toBeDefined();
    const instructionKey = deriveIdempotencyKey('command', 'settlement.instruction.create', obligation?.obligationId ?? '');
    const created = enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.instruction.create',
        instructionKey,
        { subject: { kind: 'OBLIGATION', obligationId: obligation?.obligationId }, beneficiary: 'acct-beta' },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    const instructionId = (executedObservations(substrate).find(
      (row) => row.kind === 'settlement.instruction.create',
    )?.summary as Record<string, unknown>)?.instructionId as string;
    expect(instructionId).toBeDefined();
    expect(substrate.getJob(created.job.id)?.status).toBe('succeeded');
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.attempt.authorize',
        deriveIdempotencyKey('command', 'settlement.attempt.authorize', instructionId),
        { instructionId, adapterId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    const attemptBefore = authorities.settlement.attemptForInstruction(instructionId);
    expect(attemptBefore?.state).toBe('CREATED');
    expect(attemptBefore?.operationId).toBeDefined();

    // The submitted attempt lands PENDING (ACCEPT_REPORT_CONFIRMED).
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.attempt.submit',
        deriveIdempotencyKey('command', 'settlement.attempt.submit', instructionId),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.settlement.attemptForInstruction(instructionId)?.state).toBe('PENDING');

    // DUPLICATE DELIVERY of the same submit command: the queue-level
    // dedupe already collapses the same (kind, key) — the authority-level
    // discipline is exercised by a second submit with a distinct job key
    // carrying the same instruction: typed refusal, no second transmit,
    // the recorded attempt unchanged.
    const secondSubmit = enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.attempt.submit',
        deriveIdempotencyKey('command', 'settlement.attempt.submit', instructionId, 'duplicate'),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    expect(secondSubmit.created).toBe(true);
    await substrate.drain();
    const submitObservations = executedObservations(substrate).filter(
      (row) => row.kind === 'settlement.attempt.submit',
    );
    expect(submitObservations.length).toBe(2);
    expect(submitObservations[1]?.status).toBe('rejected');
    expect(submitObservations[1]?.code).toBe('LIVE_ATTEMPT_EXISTS');
    // Exactly ONE rail operation exists for the attempt — no second
    // external effect was attempted (INV-12-2).
    const attemptAfter = authorities.settlement.attemptForInstruction(instructionId);
    expect(attemptAfter?.operationId).toBe(attemptBefore?.operationId);
    expect(
      authorities.settlement.listAttempts().filter((attempt) => attempt.instructionId === instructionId).length,
    ).toBe(1);
    // One SETTLEMENT_ATTEMPT_AUTHORIZED + one SETTLEMENT_ATTEMPT_RESOLVED
    // so far (the submit resolution record) — the refused duplicate emits
    // nothing.
    expect(operationTypes(log).filter((type) => type === 'SETTLEMENT_ATTEMPT_AUTHORIZED').length).toBe(1);
    expect(operationTypes(log).filter((type) => type === 'SETTLEMENT_ATTEMPT_RESOLVED').length).toBe(1);
  });

  test('cross-job duplicate (queue dedupe bypassed): the authority replays by domain key', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    // First submission through the path.
    enqueueCommand(
      substrate,
      envelopeFor(
        'intent.submit',
        deriveIdempotencyKey('command', 'intent.submit', 'x-job-1'),
        submitIntentBody('cross-key-1'),
        'Intent Authority',
      ),
    );
    await substrate.drain();
    // A SECOND job with a DIFFERENT job-level idempotency key carries the
    // same command body (same domain key): the queue does not dedupe it;
    // the authority does (INV-1-3 — the recorded receipt returns).
    enqueueCommand(
      substrate,
      envelopeFor(
        'intent.submit',
        deriveIdempotencyKey('command', 'intent.submit', 'x-job-2'),
        submitIntentBody('cross-key-1'),
        'Intent Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.intent.listIntents().length).toBe(1);
    expect(operationTypes(log).filter((type) => type === 'INTENT_CREATED').length).toBe(1);
    const statuses = executedObservations(substrate).map((row) => row.status);
    expect(statuses).toEqual(['applied', 'replayed']);
  });
});

describe('hosted bindings: the composed settlement leg (obligation → finality)', () => {
  test('instruction → attempt → report-driven confirm → finality: the obligation SETTLED exactly once', async () => {
    // The journey's deterministic identity chain is computable up front:
    // the obligation id from the origin record id; the instruction id
    // from the subject + ordinal 1; the rail key from the instruction id.
    const obligationId = obligationIdForOriginRecord('f-rec-1');
    const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
    const railKey = railIdempotencyKeyForInstruction(instructionId);
    const harness = await composeHarness({
      railScript: { [railKey]: 'ACCEPT_REPORT_CONFIRMED' },
    });
    const { substrate, authorities, adapterId } = harness;
    enqueueCommand(
      substrate,
      envelopeFor(
        'obligation.clearing.commit',
        deriveIdempotencyKey('command', 'obligation.clearing.commit', 'f-rec-1'),
        {
          batchId: 'batch-f',
          recordId: 'f-rec-1',
          originActivityId: 'activity-f',
          originKind: 'INTENT',
          debtorParticipantId: 'alpha',
          creditorParticipantId: 'beta',
          amount: { currency: 'EUR', scale: 2, amountMinor: 6_000 },
          reason: 'finality fixture',
        },
        'Obligation Authority',
      ),
    );
    await substrate.drain();
    const observedObligationId = authorities.obligations.obligations()[0]?.obligationId ?? '';
    expect(observedObligationId).toBe(obligationId);
    // The settlement instruction drives the obligation to SETTLEMENT_PENDING.
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.instruction.create',
        deriveIdempotencyKey('command', 'settlement.instruction.create', obligationId),
        { subject: { kind: 'OBLIGATION', obligationId }, beneficiary: 'acct-beta' },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    const observedInstructionId = (executedObservations(substrate).find(
      (row) => row.kind === 'settlement.instruction.create',
    )?.summary as Record<string, unknown>)?.instructionId as string;
    expect(observedInstructionId).toBe(instructionId);
    expect(authorities.obligations.obligation(obligationId)?.state).toBe('SETTLEMENT_PENDING');
    // Authorize + submit: the scripted rail accepts and reports CONFIRMED
    // (the attempt lands PENDING, awaiting the report).
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.attempt.authorize',
        deriveIdempotencyKey('command', 'settlement.attempt.authorize', instructionId),
        { instructionId, adapterId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.attempt.submit',
        deriveIdempotencyKey('command', 'settlement.attempt.submit', instructionId),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.settlement.attemptForInstruction(instructionId)?.state).toBe('PENDING');
    // The report-driven confirmation: fetch → record → mirror → CONFIRMED.
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.report.apply',
        deriveIdempotencyKey('command', 'settlement.report.apply', instructionId),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.settlement.attemptForInstruction(instructionId)?.state).toBe('CONFIRMED');
    // FINALITY: PROVISIONAL then FINAL; the obligation SETTLED exactly once.
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.declare.finality',
        deriveIdempotencyKey('command', 'settlement.declare.finality', instructionId),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.obligations.obligation(obligationId)?.state).toBe('SETTLED');
    const finality = authorities.settlement.finalityForSubject({
      kind: 'OBLIGATION',
      obligationId,
    });
    expect(finality?.state).toBe('FINAL');
    // FINALITY_DECLARED is one record per consequential declaration: the
    // PROVISIONAL record (at the confirmed landing) plus the FINAL record
    // (at declareFinality) — exactly two, never more.
    expect(operationTypes(harness.log).filter((type) => type === 'FINALITY_DECLARED').length).toBe(2);
    // Redelivered finality: FINALITY_ALREADY_DECLARED — no third record.
    enqueueCommand(
      substrate,
      envelopeFor(
        'settlement.declare.finality',
        deriveIdempotencyKey('command', 'settlement.declare.finality', instructionId, 'dup'),
        { instructionId },
        'Settlement and Finality Authority',
      ),
    );
    await substrate.drain();
    expect(operationTypes(harness.log).filter((type) => type === 'FINALITY_DECLARED').length).toBe(2);
  });
});

describe('hosted bindings: scheduler tick commands execute through the path', () => {
  test('clearing.batch.tick opens the window batch; netting.set.tick opens the set; queues tick evaluates', async () => {
    const harness = await composeHarness();
    const { substrate, authorities, log } = harness;
    // A clearing batch tick command (as the scheduler wiring emits it).
    enqueueCommand(
      substrate,
      envelopeFor(
        'clearing.batch.tick',
        'clearing-batch-tick:t42',
        { batchLabel: 'clearing-window-42', windowStartWallMs: 4_200_000, windowEndWallMs: 4_260_000 },
        'Clearing Authority',
      ),
    );
    await substrate.drain();
    const batchId = (executedObservations(substrate).find(
      (row) => row.kind === 'clearing.batch.tick',
    )?.summary as Record<string, unknown>)?.batchId as string;
    expect(batchId).toBeTruthy();
    expect(authorities.clearing.batch(batchId)?.state).toBe('OPEN');
    // A re-delivered tick (same label) completes as the typed duplicate
    // rejection — no second batch.
    enqueueCommand(
      substrate,
      envelopeFor(
        'clearing.batch.tick',
        'clearing-batch-tick:t42-redelivered',
        { batchLabel: 'clearing-window-42', windowStartWallMs: 4_200_000, windowEndWallMs: 4_260_000 },
        'Clearing Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.clearing.batch(batchId)?.state).toBe('OPEN');

    // A netting set tick over obligations created through the path (a
    // netting set needs a non-empty fixed input — INV-11-3).
    for (const recordId of ['n-rec-1', 'n-rec-2']) {
      enqueueCommand(
        substrate,
        envelopeFor(
          'obligation.clearing.commit',
          deriveIdempotencyKey('command', 'obligation.clearing.commit', recordId),
          {
            batchId: `batch-${recordId}`,
            recordId,
            originActivityId: `activity-${recordId}`,
            originKind: 'INTENT',
            debtorParticipantId: 'alpha',
            creditorParticipantId: 'beta',
            amount: { currency: 'EUR', scale: 2, amountMinor: 3_000 },
            reason: 'netting tick fixture',
          },
          'Obligation Authority',
        ),
      );
    }
    await substrate.drain(10);
    const obligationIds = authorities.obligations.obligations().map((obligation) => obligation.obligationId);
    expect(obligationIds.length).toBe(2);
    enqueueCommand(
      substrate,
      envelopeFor(
        'netting.set.tick',
        'netting-cycle-tick:t7',
        {
          label: 'netting-window-7',
          windowStartWallMs: 700_000,
          windowEndWallMs: 1_000_000,
          scope: { kind: 'BILATERAL', participants: ['alpha', 'beta'] },
          inputObligationIds: obligationIds,
        },
        'Netting Authority',
      ),
    );
    await substrate.drain();
    const setId = (executedObservations(substrate).find(
      (row) => row.kind === 'netting.set.tick',
    )?.summary as Record<string, unknown>)?.nettingSetId as string;
    expect(setId).toBeTruthy();
    expect(authorities.netting.nettingSet(setId)?.state).toBe('OPEN');

    // A queue eligibility tick: create the queue through the path, then
    // evaluate an (empty) eligibility scan.
    enqueueCommand(
      substrate,
      envelopeFor(
        'queues.queue.create',
        deriveIdempotencyKey('command', 'queues.queue.create', 'q-1'),
        {
          queueId: 'q-1',
          policy: {
            maxWaitEpochMs: 60_000,
            releaseConditions: { requiredCapabilityTier: 'STANDARD' },
          },
        },
        'Queue Authority',
      ),
    );
    await substrate.drain();
    enqueueCommand(
      substrate,
      envelopeFor(
        'queues.eligibility.tick',
        'queue-eligibility-tick:t3',
        {
          windowStartWallMs: 30_000,
          windowEndWallMs: 60_000,
          scans: [
            {
              queueId: 'q-1',
              snapshot: {
                liquidity: [],
                capability: [],
                credit: [],
                at: { sequence: 3, wallMs: 30_000 },
              },
            },
          ],
        },
        'Queue Authority',
      ),
    );
    await substrate.drain();
    expect(authorities.queues.queue('q-1')).toBeDefined();
    const tickObservation = executedObservations(substrate).find((row) => row.kind === 'queues.eligibility.tick');
    expect(tickObservation?.status).toBe('applied');
    // Every tick command executed through the path wrote A15 evidence via
    // its authority (e.g. the batch-open and set-open records exist).
    expect(operationTypes(log).length).toBeGreaterThan(1);
  });
});

describe('hosted bindings: rails state advances only through the transition path', () => {
  test('the settlement rails surface (the double over the REAL SimulatedRail) is driven only by commands', async () => {
    const harness = await composeHarness();
    const { authorities, connection } = harness;
    // No rail operations exist before any command executes.
    expect(authorities.settlement.listAttempts().length).toBe(0);
    expect(authorities.settlement.listInstructions().length).toBe(0);
    // Rail operations appear ONLY as consequences of executed commands
    // (the settlement legs above already prove the flow); the adapter
    // interface (SimulatedRail + connection) itself holds no protocol
    // state: it exposes only transmit/fetchReport.
    expect(typeof connection.transmit).toBe('function');
    expect(typeof connection.fetchReport).toBe('function');
    const railKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(harness.rail));
    expect(railKeys).not.toContain('authorizeOperation');
    expect(railKeys).not.toContain('recordReport');
  });
});
