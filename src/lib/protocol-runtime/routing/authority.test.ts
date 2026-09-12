/**
 * RTN-006 — Routing Authority: the composed command-surface tests — the
 * authority wired to the REAL RTN-002 A15 log with a stub ReservationAcquisition
 * port (the area-5 dependency inverted; the real-ledger integration is the
 * integration suite).
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 227-259:
 *     the compiler pinning and determinism (227-230), INV-4-2's fixed-hop-
 *     order acquisition (245-247), INV-4-3's compilation key (248-249),
 *     NO_VIABLE_ROUTE + the area-24 demand signal (253-254), the
 *     halt-at-DISPATCHED discipline (255-259).
 *   spec/architecture/v0.1/README.md §3 GC-2 (no blind resume), GC-5 (one
 *   record per consequential operation).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { evidenceRecordId } from '../evidence/record.ts';
import type { IntentTerms, PolicyEvaluationOutcome } from '../policy/types.ts';
import type { CapabilitySnapshot, CapabilitySnapshotEntry } from '../capability/types.ts';
import { RoutingAuthority } from './authority.ts';
import type {
  ReservationAcquisition,
  ReservationAcquisitionRequest,
} from './types.ts';

/**
 * A deterministic stub of the area-5 port: reservations are held in a map
 * keyed by the derived reservation id; every request logs the call order;
 * amounts are checked against a configurable per-resource capacity so the
 * dispatch-unwind path is exercisable.
 */
class StubReservations implements ReservationAcquisition {
  readonly requests: ReservationAcquisitionRequest[] = [];
  readonly released: string[] = [];
  readonly consumedIds: string[] = [];
  private readonly held = new Map<string, ReservationAcquisitionRequest>();
  private readonly capacity: Map<string, number>;
  private readonly failures: Set<string>;

  constructor(options: { capacity?: Record<string, number>; failResource?: string } = {}) {
    this.capacity = new Map(Object.entries(options.capacity ?? {}));
    this.failures = new Set(options.failResource ? [options.failResource] : []);
  }

  async request(request: ReservationAcquisitionRequest) {
    this.requests.push(request);
    const reservationId = deriveProtocolId(
      'reservation',
      request.intentId,
      request.hopId,
      request.resourceId,
    );
    if (this.held.has(reservationId)) {
      return { ok: true as const, reservationId };
    }
    if (this.failures.has(request.resourceId)) {
      return {
        ok: false as const,
        code: 'INSUFFICIENT_AVAILABLE',
        problem: `stub: resource ${request.resourceId} cannot cover the request`,
      };
    }
    this.held.set(reservationId, request);
    return { ok: true as const, reservationId };
  }

  async consume(reservationId: string) {
    if (!this.held.has(reservationId)) {
      if (this.consumedIds.includes(reservationId)) {
        return { ok: true as const, terminal: 'CONSUMED' as const };
      }
      return { ok: false as const, code: 'RESERVATION_NOT_FOUND', problem: 'stub: unknown reservation' };
    }
    this.held.delete(reservationId);
    this.consumedIds.push(reservationId);
    return { ok: true as const, terminal: 'CONSUMED' as const };
  }

  async release(reservationId: string) {
    if (!this.held.has(reservationId)) {
      return { ok: false as const, code: 'RESERVATION_NOT_FOUND', problem: 'stub: unknown reservation' };
    }
    this.held.delete(reservationId);
    this.released.push(reservationId);
    return { ok: true as const, terminal: 'RELEASED' as const };
  }

  stateOf(reservationId: string) {
    return this.held.has(reservationId)
      ? ('HELD' as const)
      : this.consumedIds.includes(reservationId)
        ? ('CONSUMED' as const)
        : this.released.includes(reservationId)
          ? ('RELEASED' as const)
          : undefined;
  }
}

function capability(
  capabilityId: string,
  corridor: [string, string, string, string],
  availableMinor: number,
): CapabilitySnapshotEntry {
  const [sourceCurrency, sourceGeography, destinationCurrency, destinationGeography] = corridor;
  return {
    capabilityId,
    railId: 'sepa',
    corridor: { sourceCurrency, sourceGeography, destinationCurrency, destinationGeography },
    state: 'ACTIVE',
    declaredCapacity: money(sourceCurrency, availableMinor, 2),
    reservedTotal: money(sourceCurrency, 0, 2),
    consumedTotal: money(sourceCurrency, 0, 2),
    availableCapacity: money(sourceCurrency, availableMinor, 2),
    costSchedule: money('EUR', 100, 2),
    tier: 'STANDARD',
  };
}

function snapshot(capabilities: readonly CapabilitySnapshotEntry[], sequence = 1): CapabilitySnapshot {
  return {
    snapshotId: deriveProtocolId('capability-snapshot', sequence),
    sequence,
    wallMs: 1_000,
    capabilities,
  };
}

const TERMS: IntentTerms = {
  amount: money('EUR', 200_00, 2),
  sourceCurrency: 'EUR',
  destinationCurrency: 'USD',
  sourceGeography: 'DE',
  destinationGeography: 'US',
  deadlineEpochMs: 60_000,
  allowedRails: ['sepa'],
  costCeiling: money('EUR', 500_00, 2),
};

const EVALUATION: PolicyEvaluationOutcome = {
  satisfiable: true,
  result: {
    rankedRouteRequirements: [],
    constraintEnvelope: { allowedRails: ['sepa'], ordering: 'COST_ASC', fallbackPreference: [] },
    costCeiling: money('EUR', 500_00, 2),
    deadlineEpochMs: 60_000,
  },
};

const CONVERSIONS = [
  {
    fromCurrency: 'EUR',
    toCurrency: 'USD',
    fromAmount: money('EUR', 200_00, 2),
    toAmount: money('USD', 220_00, 2),
  },
];

const TWO_HOP = snapshot([
  capability('cap-a', ['EUR', 'DE', 'EUR', 'FR'], 500_00),
  capability('cap-b', ['EUR', 'FR', 'USD', 'US'], 1_000_00),
]);

function makeAuthority(options: { failResource?: string } = {}) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const stub = new StubReservations({ failResource: options.failResource });
  const authority = new RoutingAuthority({
    evidence: log,
    reservations: stub,
    wallClock: () => wall,
  });
  return {
    log,
    stub,
    authority,
    advance: (ms: number) => {
      wall += ms;
    },
  };
}

const INTENT = 'pid.v1.intent';

describe('RoutingAuthority compile (INV-4-3 + NO_VIABLE_ROUTE)', () => {
  test('compile records the plan and the ROUTE_COMPILED evidence; replay returns the identical plan', async () => {
    const { log, authority } = makeAuthority();
    const first = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replayed).toBe(false);
      expect(first.plan.state).toBe('COMPILED');
      expect(first.plan.compilerVersion).toBe(1);
      expect(first.plan.hops.length).toBe(2);
    }
    const second = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.replayed).toBe(true);
      expect(second.plan).toBe(first.ok ? first.plan : second.plan);
    }
    // Exactly one ROUTE_COMPILED record (GC-5: the replay writes nothing).
    const compiled = log
      .records()
      .filter((record) => record.what.operationType === 'ROUTE_COMPILED');
    expect(compiled.length).toBe(1);
  });

  test('NO_VIABLE_ROUTE emits ROUTE_FAILED and the area-24 demand signal with the emission point recorded', async () => {
    const { log, authority } = makeAuthority();
    const result = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: snapshot([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.terminal) {
      expect(result.reasonCode).toBe('NO_VIABLE_ROUTE');
      expect(result.demandSignal.intentId).toBe(INTENT);
      expect(result.demandSignal.requestedCorridor.sourceCurrency).toBe('EUR');
      expect(result.demandSignal.requestedCorridor.destinationCurrency).toBe('USD');
      expect(result.demandSignal.amount.amountMinor).toBe(200_00);
      // The emission point: the derived id of the ROUTE_FAILED record.
      const failure = log
        .records()
        .find(
          (record) =>
            record.what.operationType === 'ROUTE_FAILED' &&
            record.outcome.reasonCode === 'NO_VIABLE_ROUTE',
        );
      expect(failure).not.toBe(undefined);
      if (failure !== undefined) {
        expect(result.demandSignal.emissionPointRecordId).toBe(evidenceRecordId(failure));
      }
      // Repeated compilation of the same key replays the signal exactly once.
      const again = await authority.compileRoute({
        intentId: INTENT,
        intentTerms: TERMS,
        policyEvaluation: EVALUATION,
        snapshot: snapshot([]),
      });
      expect(again.ok).toBe(false);
      if (!again.ok && again.terminal) {
        expect(again.demandSignal.signalId).toBe(result.demandSignal.signalId);
      }
      expect(authority.demandSignals().length).toBe(1);
      const failures = log
        .records()
        .filter((record) => record.outcome.reasonCode === 'NO_VIABLE_ROUTE');
      expect(failures.length).toBe(1);
    }
  });

  test('the demand signal id is the compilation key (idempotent emission)', async () => {
    const { authority } = makeAuthority();
    const result = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: snapshot([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.terminal) {
      expect(result.demandSignal.signalId).toBe(
        deriveProtocolId('route-demand-signal', INTENT, 1, snapshot([]).snapshotId),
      );
      expect(authority.demandSignal(result.demandSignal.signalId)).toBe(result.demandSignal);
    }
  });
});

describe('RoutingAuthority validate / dispatch / complete (INV-4-2)', () => {
  test('the golden path: validate -> dispatch -> complete with fixed-hop-order acquisition', async () => {
    const { log, stub, authority } = makeAuthority();
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const validated = await authority.validatePlan(compiled.plan.planId);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.plan.state).toBe('VALIDATED');
    const dispatched = await authority.dispatchPlan(compiled.plan.planId);
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) {
      return;
    }
    expect(dispatched.plan.state).toBe('DISPATCHED');
    // INV-4-2: the acquisitions happened strictly in the plan's fixed hop order.
    expect(
      stub.requests.map((request) => request.hopId),
    ).toEqual(dispatched.plan.hops.map((hop) => hop.hopId));
    expect(dispatched.plan.reservationRefs.length).toBe(2);
    const completed = await authority.completePlan(compiled.plan.planId);
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.plan.state).toBe('COMPLETED');
    }
    // The consumes ran in fixed hop order too.
    expect(stub.consumedIds.length).toBe(2);
    // Evidence: one record per consequential operation, in order.
    const types = log
      .records()
      .slice(1)
      .map((record) => record.what.operationType);
    expect(types).toEqual([
      'ROUTE_COMPILED',
      'ROUTE_VALIDATED',
      'ROUTE_DISPATCHED',
      'ROUTE_COMPLETED',
    ]);
  });

  test('a re-dispatch of a dispatched plan is refused (GC-2, never blindly)', async () => {
    const { authority } = makeAuthority();
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      return;
    }
    await authority.validatePlan(compiled.plan.planId);
    await authority.dispatchPlan(compiled.plan.planId);
    const again = await authority.dispatchPlan(compiled.plan.planId);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  test('an acquisition failure unwinds in reverse hop order and abandons the plan', async () => {
    const { log, stub, authority } = makeAuthority({ failResource: 'cap-b' });
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      return;
    }
    await authority.validatePlan(compiled.plan.planId);
    const dispatched = await authority.dispatchPlan(compiled.plan.planId);
    expect(dispatched.ok).toBe(true);
    if (dispatched.ok) {
      expect(dispatched.plan.state).toBe('ABANDONED');
    }
    // The unwind released hop 0's hold (the only acquired one).
    expect(stub.released.length).toBe(1);
    const abandoned = log
      .records()
      .find((record) => record.what.operationType === 'ROUTE_ABANDONED');
    expect(abandoned).not.toBe(undefined);
    if (abandoned !== undefined) {
      expect(abandoned.outcome.reasonCode).toBe('ACQUISITION_FAILED');
    }
  });

  test('failPlan releases the still-held reservations and records ROUTE_FAILED with the reason', async () => {
    const { log, stub, authority } = makeAuthority();
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      return;
    }
    await authority.validatePlan(compiled.plan.planId);
    await authority.dispatchPlan(compiled.plan.planId);
    const failed = await authority.failPlan(compiled.plan.planId, 'HOP_FAILED', {
      affectedHopIds: [compiled.plan.hops[1]?.hopId as string],
    });
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.plan.state).toBe('FAILED');
    }
    expect(stub.released.length).toBe(2);
    const failure = log
      .records()
      .find((record) => record.what.operationType === 'ROUTE_FAILED');
    expect(failure).not.toBe(undefined);
    if (failure !== undefined) {
      expect(failure.outcome.reasonCode).toBe('HOP_FAILED');
      expect(failure.what.subjectIds).toContain(compiled.plan.hops[1]?.hopId as string);
    }
  });

  test('abandonPlan from COMPILED records ROUTE_ABANDONED with the reason code', async () => {
    const { log, authority } = makeAuthority();
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      return;
    }
    const abandoned = await authority.abandonPlan(compiled.plan.planId, 'SUPERSEDED');
    expect(abandoned.ok).toBe(true);
    if (abandoned.ok) {
      expect(abandoned.plan.state).toBe('ABANDONED');
    }
    const record = log
      .records()
      .find((entry) => entry.what.operationType === 'ROUTE_ABANDONED');
    expect(record).not.toBe(undefined);
    if (record !== undefined) {
      expect(record.outcome.reasonCode).toBe('SUPERSEDED');
    }
  });

  test('terminal transitions require a reason code (typed rejection otherwise)', async () => {
    const { authority } = makeAuthority();
    const compiled = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      return;
    }
    await authority.validatePlan(compiled.plan.planId);
    await authority.dispatchPlan(compiled.plan.planId);
    let threw = false;
    try {
      await authority.failPlan(compiled.plan.planId, undefined as never);
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('reason code');
    }
    expect(threw).toBe(true);
  });
});

describe('RoutingAuthority UNKNOWN-hop halt discipline (core.md lines 255-259, GC-2)', () => {
  async function dispatched() {
    const context = makeAuthority();
    const compiled = await context.authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      throw new Error('compile failed');
    }
    await context.authority.validatePlan(compiled.plan.planId);
    await context.authority.dispatchPlan(compiled.plan.planId);
    return { ...context, plan: compiled.plan };
  }

  test('a hop UNKNOWN halts the plan at DISPATCHED; reservations stay HELD', async () => {
    const { authority, stub, plan } = await dispatched();
    const hop1 = plan.hops[1] as { hopId: string };
    const halted = await authority.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    expect(halted.ok).toBe(true);
    if (halted.ok) {
      expect(halted.plan.state).toBe('DISPATCHED');
      expect(halted.plan.unknownHops.length).toBe(1);
    }
    // The holds stay HELD (nothing released).
    expect(stub.released.length).toBe(0);
    expect(stub.consumedIds.length).toBe(0);
    // Idempotent halt recording.
    const again = await authority.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.plan.unknownHops.length).toBe(1);
    }
    // A different rail operation for the same hop is refused.
    const conflict = await authority.recordUnknownHop(plan.planId, hop1.hopId, 'railop-2');
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe('HOP_ALREADY_HALTED');
    }
  });

  test('no terminal transition while a halt is unresolved; resolution unblocks completion', async () => {
    const { authority, stub, plan } = await dispatched();
    const hop1 = plan.hops[1] as { hopId: string };
    await authority.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    const refused = await authority.completePlan(plan.planId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('UNRESOLVED_UNKNOWN_HOP');
    }
    const refusedFail = await authority.failPlan(plan.planId, 'HOP_FAILED');
    expect(refusedFail.ok).toBe(false);
    const resolved = await authority.resolveUnknownHop(plan.planId, hop1.hopId, 'CONFIRMED');
    expect(resolved.ok).toBe(true);
    const completed = await authority.completePlan(plan.planId);
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.plan.state).toBe('COMPLETED');
    }
    expect(stub.consumedIds.length).toBe(2);
  });

  test('a FAILED resolution drives failPlan and releases the holds exactly once', async () => {
    const { authority, stub, plan } = await dispatched();
    const hop0 = plan.hops[0] as { hopId: string };
    await authority.recordUnknownHop(plan.planId, hop0.hopId, 'railop-0');
    await authority.resolveUnknownHop(plan.planId, hop0.hopId, 'FAILED');
    const failed = await authority.failPlan(plan.planId, 'HOP_FAILED');
    expect(failed.ok).toBe(true);
    expect(stub.released.length).toBe(2);
    expect(stub.consumedIds.length).toBe(0);
  });

  test('resolving a halt that does not exist is the typed NO_UNKNOWN_HOP rejection', async () => {
    const { authority, plan } = await dispatched();
    const result = await authority.resolveUnknownHop(plan.planId, 'pid.v1.nohop', 'CONFIRMED');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_UNKNOWN_HOP');
    }
  });

  test('a halted plan abandoned after its reservations expired (RESERVATIONS_EXPIRED)', async () => {
    const { authority, stub, plan } = await dispatched();
    const hop1 = plan.hops[1] as { hopId: string };
    await authority.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    // The reconciliation resolves the UNKNOWN, but the holds expired in the
    // meantime — the plan is abandoned with RESERVATIONS_EXPIRED.
    await authority.resolveUnknownHop(plan.planId, hop1.hopId, 'CONFIRMED');
    const abandoned = await authority.abandonPlan(plan.planId, 'RESERVATIONS_EXPIRED');
    expect(abandoned.ok).toBe(true);
    if (abandoned.ok) {
      expect(abandoned.plan.state).toBe('ABANDONED');
    }
    expect(stub.released.length).toBe(2);
  });
});

describe('RoutingAuthority concurrent compilation collapse (INV-4-3)', () => {
  test('concurrent compilations of one key collapse to one plan and one ROUTE_COMPILED record', async () => {
    const { log, authority } = makeAuthority();
    const [first, second] = await Promise.all([
      authority.compileRoute({
        intentId: INTENT,
        intentTerms: TERMS,
        policyEvaluation: EVALUATION,
        snapshot: TWO_HOP,
        conversions: CONVERSIONS,
      }),
      authority.compileRoute({
        intentId: INTENT,
        intentTerms: TERMS,
        policyEvaluation: EVALUATION,
        snapshot: TWO_HOP,
        conversions: CONVERSIONS,
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.plan).toBe(second.plan);
      expect(first.replayed || second.replayed).toBe(true);
    }
    const compiled = log
      .records()
      .filter((record) => record.what.operationType === 'ROUTE_COMPILED');
    expect(compiled.length).toBe(1);
    expect(authority.plans().length).toBe(1);
  });

  test('the same intent against a different snapshot compiles a second plan', async () => {
    const { authority } = makeAuthority();
    const first = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: TWO_HOP,
      conversions: CONVERSIONS,
    });
    const second = await authority.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: snapshot(
        [
          capability('cap-a', ['EUR', 'DE', 'EUR', 'FR'], 500_00),
          capability('cap-b', ['EUR', 'FR', 'USD', 'US'], 1_000_00),
        ],
        2,
      ),
      conversions: CONVERSIONS,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(authority.plansForIntent(INTENT).length).toBe(2);
  });
});

describe('RoutingAuthority input discipline', () => {
  test('malformed command inputs are TypeError failures', async () => {
    const { authority } = makeAuthority();
    let threw = false;
    try {
      await authority.compileRoute({
        intentId: '',
        intentTerms: TERMS,
        policyEvaluation: EVALUATION,
        snapshot: TWO_HOP,
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('intentId');
    }
    expect(threw).toBe(true);
    const missing = await authority.validatePlan('pid.v1.missing');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('PLAN_NOT_FOUND');
    }
  });
});
