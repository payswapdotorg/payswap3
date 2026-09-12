/**
 * RTN-006 — Routing × Reservations integration: the Routing Authority
 * wired to the REAL ReservationLedger through the REAL acquisition port,
 * against the REAL RTN-002 A15 log — the composed A04/A05 spine.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 245-247 (INV-4-2):
 *     "a plan is compiled against one capability snapshot id; dispatch
 *      acquires reservations (area 5) in the plan's fixed hop order."
 *   lines 272-273 ("Depends on areas 1-3 for inputs and area 5 for
 *     reservation acquisition during dispatch").
 *   lines 255-259 (the UNKNOWN halt) + §5 Area 5 lines 319-322:
 *     "When a downstream rail operation is UNKNOWN, associated
 *      reservations remain HELD until reconciliation resolves the
 *      operation; they are then consumed or released exactly once (GC-2)."
 *   §5 Area 5 lines 304-312 (INV-5-1/INV-5-2/INV-5-3 through the composed
 *     flow).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { IntentTerms, PolicyEvaluationOutcome } from '../policy/types.ts';
import type { CapabilitySnapshot, CapabilitySnapshotEntry } from '../capability/types.ts';
import { RoutingAuthority } from './authority.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { createReservationAcquisitionPort } from '../reservations/acquisition.ts';
import { availableResource, resourceInvariantHolds } from '../reservations/resource.ts';

const INTENT = 'pid.v1.intent';

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

function composed(options: {
  capADeclared?: number;
  capBDeclared?: number;
} = {}) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({
    evidence: log,
    wallClock: () => wall,
  });
  const routing = new RoutingAuthority({
    evidence: log,
    reservations: createReservationAcquisitionPort(ledger),
    wallClock: () => wall,
  });
  const twoHop = snapshot([
    capability('cap-a', ['EUR', 'DE', 'EUR', 'FR'], 500_00),
    capability('cap-b', ['EUR', 'FR', 'USD', 'US'], 1_000_00),
  ]);
  return {
    log,
    ledger,
    routing,
    twoHop,
    advance: (ms: number) => {
      wall += ms;
    },
    prepare: async () => {
      // The resource owners (areas 6/7/3) declare the resources with their
      // INV-5-1 declared totals.
      await ledger.declareResource('cap-a', money('EUR', options.capADeclared ?? 500_00, 2));
      await ledger.declareResource('cap-b', money('EUR', options.capBDeclared ?? 1_000_00, 2));
      const compiled = await routing.compileRoute({
        intentId: INTENT,
        intentTerms: TERMS,
        policyEvaluation: EVALUATION,
        snapshot: twoHop,
        conversions: CONVERSIONS,
      });
      if (!compiled.ok) {
        throw new Error('compile failed in fixture');
      }
      await routing.validatePlan(compiled.plan.planId);
      return compiled.plan;
    },
  };
}

describe('the composed A04/A05 spine (routing over the real ledger)', () => {
  test('the golden path: dispatch acquires in fixed hop order; completion consumes exactly once', async () => {
    const { ledger, routing, log, prepare } = composed();
    const plan = await prepare();
    const dispatched = await routing.dispatchPlan(plan.planId);
    expect(dispatched.ok).toBe(true);
    if (!dispatched.ok) {
      return;
    }
    // INV-5-2/INV-5-1 through the composed flow: both resources hold the
    // hop amounts, identity intact.
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting).not.toBe(undefined);
      if (accounting !== undefined) {
        expect(accounting.heldTotal.amountMinor).toBe(200_00);
        expect(resourceInvariantHolds(accounting)).toBe(true);
      }
    }
    // The reservation ids on the plan are the derived INV-5-3 ids.
    expect(dispatched.plan.reservationRefs.map((ref) => ref.reservationId)).toEqual(
      plan.hops.map((hop) =>
        deriveProtocolId('reservation', INTENT, hop.hopId, hop.capabilityId),
      ),
    );
    const completed = await routing.completePlan(plan.planId);
    expect(completed.ok).toBe(true);
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting).not.toBe(undefined);
      if (accounting !== undefined) {
        expect(accounting.heldTotal.amountMinor).toBe(0);
        expect(accounting.consumedTotal.amountMinor).toBe(200_00);
        expect(availableResource(accounting).amountMinor).toBe(
          accounting.declaredTotal.amountMinor - 200_00,
        );
        expect(resourceInvariantHolds(accounting)).toBe(true);
      }
    }
    // The evidence spine: A04 and A05 records interleaved in one chain —
    // compile and validate, then the fixed-hop-order acquisitions, the
    // dispatch record, then the consumes and the completion.
    const types = log
      .records()
      .slice(1)
      .map((record) => record.what.operationType);
    expect(types).toEqual([
      'ROUTE_COMPILED',
      'ROUTE_VALIDATED',
      'RESERVATION_HELD',
      'RESERVATION_HELD',
      'ROUTE_DISPATCHED',
      'RESERVATION_CONSUMED',
      'RESERVATION_CONSUMED',
      'ROUTE_COMPLETED',
    ]);
    expect(log.verifyAndRecord(2_000).verdict).toBe('VERIFIED');
  });

  test('an UNKNOWN hop keeps the reservations HELD; resolution completes with exact-once consumption', async () => {
    const { ledger, routing, prepare } = composed();
    const plan = await prepare();
    await routing.dispatchPlan(plan.planId);
    const hop1 = plan.hops[1] as { hopId: string };
    await routing.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    // The holds stay HELD while the rail operation is UNKNOWN.
    for (const resourceId of ['cap-a', 'cap-b']) {
      expect(ledger.resourceAccounting(resourceId)?.heldTotal.amountMinor).toBe(200_00);
    }
    const refused = await routing.completePlan(plan.planId);
    expect(refused.ok).toBe(false);
    await routing.resolveUnknownHop(plan.planId, hop1.hopId, 'CONFIRMED');
    const completed = await routing.completePlan(plan.planId);
    expect(completed.ok).toBe(true);
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting?.heldTotal.amountMinor).toBe(0);
      expect(accounting?.consumedTotal.amountMinor).toBe(200_00);
    }
  });

  test('a FAILED resolution releases the holds exactly once', async () => {
    const { ledger, routing, prepare } = composed();
    const plan = await prepare();
    await routing.dispatchPlan(plan.planId);
    const hop0 = plan.hops[0] as { hopId: string };
    await routing.recordUnknownHop(plan.planId, hop0.hopId, 'railop-0');
    await routing.resolveUnknownHop(plan.planId, hop0.hopId, 'FAILED');
    const failed = await routing.failPlan(plan.planId, 'HOP_FAILED');
    expect(failed.ok).toBe(true);
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting?.heldTotal.amountMinor).toBe(0);
      expect(accounting?.consumedTotal.amountMinor).toBe(0);
      expect(availableResource(accounting as never).amountMinor).toBe(
        accounting?.declaredTotal.amountMinor,
      );
    }
  });

  test('an acquisition failure at hop 1 unwinds hop 0 and abandons the plan', async () => {
    const { ledger, routing, log, prepare } = composed({ capBDeclared: 100_00 });
    const plan = await prepare();
    const dispatched = await routing.dispatchPlan(plan.planId);
    expect(dispatched.ok).toBe(true);
    if (dispatched.ok) {
      expect(dispatched.plan.state).toBe('ABANDONED');
    }
    // The unwind released hop 0's hold: nothing is held anywhere.
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting?.heldTotal.amountMinor).toBe(0);
      expect(accounting?.consumedTotal.amountMinor).toBe(0);
      expect(resourceInvariantHolds(accounting as never)).toBe(true);
    }
    // The hop-1 reservation was recorded as the rejected REQUESTED ->
    // RELEASED resolution (INV-5-2: rejected, never ambiguous).
    const rejectedId = deriveProtocolId(
      'reservation',
      INTENT,
      (plan.hops[1] as { hopId: string }).hopId,
      'cap-b',
    );
    expect(ledger.reservation(rejectedId)?.state).toBe('RELEASED');
    expect(ledger.reservation(rejectedId)?.reasonCode).toBe('INSUFFICIENT_AVAILABLE');
    const abandoned = log
      .records()
      .find((record) => record.what.operationType === 'ROUTE_ABANDONED');
    expect(abandoned).not.toBe(undefined);
    if (abandoned !== undefined) {
      expect(abandoned.outcome.reasonCode).toBe('ACQUISITION_FAILED');
    }
  });

  test('a halted plan whose reservations expired abandons with RESERVATIONS_EXPIRED', async () => {
    const { ledger, routing, prepare } = composed();
    const plan = await prepare();
    await routing.dispatchPlan(plan.planId);
    const hop1 = plan.hops[1] as { hopId: string };
    await routing.recordUnknownHop(plan.planId, hop1.hopId, 'railop-1');
    // Time passes; the deterministic expiry runs (the deadline reached).
    const expired = await ledger.expireDueReservations(protocolTime(50, 60_000));
    expect(expired.length).toBe(2);
    for (const reservation of expired) {
      expect(reservation.state).toBe('EXPIRED');
    }
    // Resolving the UNKNOWN afterwards: the plan can no longer complete
    // (its holds are gone) — it is abandoned with RESERVATIONS_EXPIRED.
    await routing.resolveUnknownHop(plan.planId, hop1.hopId, 'CONFIRMED');
    const blocked = await routing.completePlan(plan.planId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('RESERVATION_NOT_HELD');
    }
    const abandoned = await routing.abandonPlan(plan.planId, 'RESERVATIONS_EXPIRED');
    expect(abandoned.ok).toBe(true);
    for (const resourceId of ['cap-a', 'cap-b']) {
      const accounting = ledger.resourceAccounting(resourceId);
      expect(accounting?.heldTotal.amountMinor).toBe(0);
      // The expired holds returned to available (nothing consumed).
      expect(accounting?.consumedTotal.amountMinor).toBe(0);
      expect(availableResource(accounting as never).amountMinor).toBe(
        accounting?.declaredTotal.amountMinor,
      );
    }
  });

  test('a re-dispatch after a failed ROUTE_DISPATCHED evidence write is idempotent (no double hold)', async () => {
    // The evidence port fails exactly once on ROUTE_DISPATCHED: the
    // command throws after the acquisitions; the re-dispatch replays the
    // recorded HELD reservations (INV-5-3) and completes the transition.
    const log = createEvidenceLog({ wallMs: 1_000 });
    let wall = 5_000;
    let failedOnce = false;
    const routedLog = {
      submit: (record: Parameters<typeof log.submit>[0]) => {
        if (!failedOnce && record.what.operationType === 'ROUTE_DISPATCHED') {
          failedOnce = true;
          throw new Error('dispatch evidence failed');
        }
        log.submit(record);
      },
    };
    const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
    const routing = new RoutingAuthority({
      evidence: routedLog,
      reservations: createReservationAcquisitionPort(ledger),
      wallClock: () => wall,
    });
    await ledger.declareResource('cap-a', money('EUR', 500_00, 2));
    await ledger.declareResource('cap-b', money('EUR', 1_000_00, 2));
    const compiled = await routing.compileRoute({
      intentId: INTENT,
      intentTerms: TERMS,
      policyEvaluation: EVALUATION,
      snapshot: snapshot([
        capability('cap-a', ['EUR', 'DE', 'EUR', 'FR'], 500_00),
        capability('cap-b', ['EUR', 'FR', 'USD', 'US'], 1_000_00),
      ]),
      conversions: CONVERSIONS,
    });
    if (!compiled.ok) {
      throw new Error('compile failed');
    }
    await routing.validatePlan(compiled.plan.planId);
    let threw = false;
    try {
      await routing.dispatchPlan(compiled.plan.planId);
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('dispatch evidence failed');
    }
    expect(threw).toBe(true);
    // The plan is still VALIDATED; the holds exist exactly once.
    expect(routing.plan(compiled.plan.planId)?.state).toBe('VALIDATED');
    expect(ledger.resourceAccounting('cap-a')?.heldTotal.amountMinor).toBe(200_00);
    expect(ledger.resourceAccounting('cap-b')?.heldTotal.amountMinor).toBe(200_00);
    // The re-dispatch acquires idempotently and completes.
    const retried = await routing.dispatchPlan(compiled.plan.planId);
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.plan.state).toBe('DISPATCHED');
    }
    expect(ledger.resourceAccounting('cap-a')?.heldTotal.amountMinor).toBe(200_00);
    expect(ledger.resourceAccounting('cap-b')?.heldTotal.amountMinor).toBe(200_00);
    // The log per resource: one REQUESTED pair per reservation (never
    // duplicated) — the idempotent replay appended nothing.
    expect(ledger.entriesFor('cap-a').length).toBe(3);
    expect(ledger.entriesFor('cap-b').length).toBe(3);
  });
});
