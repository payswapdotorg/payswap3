/**
 * RTN-006 — Routing Authority: A04 evidence emission tests against the
 * REAL RTN-002 A15 log.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/core.md §4 Area 4 lines 263-265 (the named
 *   evidence set and its slot contracts):
 *     "ROUTE_COMPILED (compiler version, snapshot id, plan hash).
 *      ROUTE_VALIDATED, ROUTE_DISPATCHED, ROUTE_COMPLETED, ROUTE_FAILED,
 *      ROUTE_ABANDONED (with reason codes and affected hop ids)."
 *   lines 253-254 (NO_VIABLE_ROUTE's ROUTE_FAILED record).
 *   spec/architecture/v0.1/README.md §3 GC-5 (one record per consequential
 *   operation).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { evidenceRecordId } from '../evidence/record.ts';
import { ROUTE_COMPILER_VERSION, compileRoutePlan, routePlanHash } from './compiler.ts';
import {
  ROUTE_EVIDENCE_VOCABULARY,
  ROUTING_AUTHORITY_ID,
  routeAbandonedEvidence,
  routeCompiledEvidence,
  routeCompletedEvidence,
  routeDispatchedEvidence,
  routeFailedEvidence,
  routeNoViableRouteEvidence,
  routeValidatedEvidence,
  submitRoutingEvidence,
} from './evidence.ts';
import type { RoutePlan } from './types.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

function plan(state: RoutePlan['state'], overrides: Partial<RoutePlan> = {}): RoutePlan {
  return {
    planId: 'pid.v1.plan',
    intentId: 'pid.v1.intent',
    compilerVersion: ROUTE_COMPILER_VERSION,
    snapshotId: 'pid.v1.snapshot',
    state,
    hops: [
      {
        hopId: 'pid.v1.hop0',
        position: 0,
        capabilityId: 'cap-a',
        railId: 'sepa',
        corridor: {
          sourceCurrency: 'EUR',
          sourceGeography: 'DE',
          destinationCurrency: 'EUR',
          destinationGeography: 'DE',
        },
        amount: money('EUR', 200_00, 2),
        settlementSemantics: 'HOP_SETTLEMENT:EUR->EUR@DE',
      },
    ],
    valueLedger: {
      sourceAmount: money('EUR', 200_00, 2),
      deliveredAmount: money('EUR', 200_00, 2),
      conversions: [],
      fees: [{ hopId: 'pid.v1.hop0', fee: money('EUR', 100, 2) }],
    },
    deadlineEpochMs: 60_000,
    reservationRefs: [{ hopId: 'pid.v1.hop0', reservationId: 'pid.v1.res0' }],
    unknownHops: [],
    createdAt: WHEN,
    stateChangedAt: WHEN,
    ...overrides,
  };
}

describe('A04 evidence records through the real A15 log (core.md lines 263-265)', () => {
  test('ROUTE_COMPILED carries the compiler version, snapshot id, and plan hash', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const compiled = compileRoutePlan({
      intentId: 'pid.v1.intent',
      intentTerms: {
        amount: money('EUR', 200_00, 2),
        sourceCurrency: 'EUR',
        destinationCurrency: 'EUR',
        sourceGeography: 'DE',
        destinationGeography: 'DE',
        deadlineEpochMs: 60_000,
        allowedRails: ['sepa'],
        costCeiling: money('EUR', 500_00, 2),
      },
      policyEvaluation: {
        satisfiable: true,
        result: {
          rankedRouteRequirements: [],
          constraintEnvelope: { allowedRails: ['sepa'], ordering: 'COST_ASC', fallbackPreference: [] },
          costCeiling: money('EUR', 500_00, 2),
          deadlineEpochMs: 60_000,
        },
      },
      snapshot: {
        snapshotId: 'pid.v1.snapshot',
        capabilities: [
          {
            capabilityId: 'cap-a',
            railId: 'sepa',
            corridor: {
              sourceCurrency: 'EUR',
              sourceGeography: 'DE',
              destinationCurrency: 'EUR',
              destinationGeography: 'DE',
            },
            state: 'ACTIVE',
            declaredCapacity: money('EUR', 500_00, 2),
            reservedTotal: money('EUR', 0, 2),
            consumedTotal: money('EUR', 0, 2),
            availableCapacity: money('EUR', 500_00, 2),
            costSchedule: money('EUR', 100, 2),
            tier: 'STANDARD',
          },
        ],
      },
    });
    expect(compiled.compiled).toBe(true);
    if (!compiled.compiled) {
      return;
    }
    await submitRoutingEvidence(log, routeCompiledEvidence(compiled.content, WHEN));
    const record = log.recordAt(1);
    expect(record).not.toBe(undefined);
    if (record !== undefined) {
      expect(record.what.operationType).toBe('ROUTE_COMPILED');
      expect(record.what.subjectIds).toContain('pid.v1.snapshot');
      expect(record.what.subjectIds).toContain(compiled.content.planId);
      expect(record.authority).toBe(ROUTING_AUTHORITY_ID);
      expect(record.outcome.result).toBe('COMPILED');
      expect(record.proof.sequenceNumbers).toEqual([ROUTE_COMPILER_VERSION]);
      expect(record.proof.hashes).toEqual([routePlanHash(compiled.content)]);
    }
  });

  test('each transition record requires the plan in the matching state (TypeError otherwise)', () => {
    expect(() => routeValidatedEvidence(plan('COMPILED'), WHEN)).toThrow(/VALIDATED/);
    expect(() => routeDispatchedEvidence(plan('VALIDATED'), WHEN)).toThrow(/DISPATCHED/);
    expect(() => routeCompletedEvidence(plan('DISPATCHED'), WHEN)).toThrow(/COMPLETED/);
    expect(() => routeFailedEvidence({ plan: plan('DISPATCHED'), when: WHEN, reasonCode: 'HOP_FAILED' })).toThrow(/FAILED/);
    expect(() => routeAbandonedEvidence({ plan: plan('COMPILED'), when: WHEN, reasonCode: 'SUPERSEDED' })).toThrow(/ABANDONED/);
  });

  test('ROUTE_DISPATCHED links the acquired reservations as prior records', () => {
    const record = routeDispatchedEvidence(plan('DISPATCHED'), WHEN);
    expect(record.what.operationType).toBe('ROUTE_DISPATCHED');
    expect(record.proof.priorRecordIds).toEqual(['pid.v1.res0']);
    expect(record.outcome.result).toBe('DISPATCHED');
  });

  test('ROUTE_COMPLETED carries all hop ids as affected subjects', () => {
    const record = routeCompletedEvidence(plan('COMPLETED'), LATER);
    expect(record.what.subjectIds).toEqual(['pid.v1.plan', 'pid.v1.intent', 'pid.v1.hop0']);
    expect(record.outcome.result).toBe('COMPLETED');
  });

  test('ROUTE_FAILED carries the reason code and the affected hop subset', () => {
    const record = routeFailedEvidence({
      plan: plan('FAILED'),
      when: LATER,
      reasonCode: 'HOP_FAILED',
      affectedHopIds: ['pid.v1.hop0'],
    });
    expect(record.outcome.result).toBe('FAILED');
    expect(record.outcome.reasonCode).toBe('HOP_FAILED');
    expect(record.what.subjectIds).toContain('pid.v1.hop0');
  });

  test('ROUTE_ABANDONED carries the reason code and the affected hop subset', () => {
    const record = routeAbandonedEvidence({
      plan: plan('ABANDONED'),
      when: LATER,
      reasonCode: 'ACQUISITION_FAILED',
    });
    expect(record.outcome.reasonCode).toBe('ACQUISITION_FAILED');
    expect(record.what.subjectIds).toContain('pid.v1.hop0');
  });

  test('the NO_VIABLE_ROUTE compilation failure is ROUTE_FAILED with the reason code', () => {
    const record = routeNoViableRouteEvidence({
      intentId: 'pid.v1.intent',
      attemptKey: 'pid.v1.attempt',
      snapshotId: 'pid.v1.snapshot',
      when: WHEN,
    });
    expect(record.what.operationType).toBe('ROUTE_FAILED');
    expect(record.what.subjectIds).toEqual(['pid.v1.intent', 'pid.v1.attempt', 'pid.v1.snapshot']);
    expect(record.outcome.result).toBe('FAILED');
    expect(record.outcome.reasonCode).toBe('NO_VIABLE_ROUTE');
    expect(record.authority).toBe('Routing Authority');
  });

  test('the emission point is the derived record id of the NO_VIABLE_ROUTE record', () => {
    const record = routeNoViableRouteEvidence({
      intentId: 'pid.v1.intent',
      attemptKey: 'pid.v1.attempt',
      snapshotId: 'pid.v1.snapshot',
      when: WHEN,
    });
    expect(evidenceRecordId(record)).toMatch(/^pid\.v1\.[0-9a-f]{64}$/);
  });

  test('every operation type is one of the six named A04 types (no inventions)', () => {
    expect(Object.values(ROUTE_EVIDENCE_VOCABULARY)).toEqual([
      'ROUTE_COMPILED',
      'ROUTE_VALIDATED',
      'ROUTE_DISPATCHED',
      'ROUTE_COMPLETED',
      'ROUTE_FAILED',
      'ROUTE_ABANDONED',
    ]);
  });

  test('the real log accepts every A04 record shape (GC-5 slot validation)', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    await submitRoutingEvidence(log, routeCompiledEvidence(
      {
        planId: 'pid.v1.plan',
        intentId: 'pid.v1.intent',
        compilerVersion: ROUTE_COMPILER_VERSION,
        snapshotId: 'pid.v1.snapshot',
        hops: [],
        valueLedger: {
          sourceAmount: money('EUR', 1, 2),
          deliveredAmount: money('EUR', 1, 2),
          conversions: [],
          fees: [],
        },
        deadlineEpochMs: 60_000,
      },
      WHEN,
    ));
    await submitRoutingEvidence(log, routeValidatedEvidence(plan('VALIDATED', { state: 'VALIDATED' }), WHEN));
    await submitRoutingEvidence(log, routeDispatchedEvidence(plan('DISPATCHED'), WHEN));
    await submitRoutingEvidence(log, routeCompletedEvidence(plan('COMPLETED'), WHEN));
    await submitRoutingEvidence(log, routeFailedEvidence({ plan: plan('FAILED'), when: WHEN, reasonCode: 'HOP_FAILED' }));
    await submitRoutingEvidence(log, routeAbandonedEvidence({ plan: plan('ABANDONED'), when: WHEN, reasonCode: 'SUPERSEDED' }));
    const types = log
      .records()
      .slice(1)
      .map((record) => record.what.operationType);
    expect(types).toEqual([
      'ROUTE_COMPILED',
      'ROUTE_VALIDATED',
      'ROUTE_DISPATCHED',
      'ROUTE_COMPLETED',
      'ROUTE_FAILED',
      'ROUTE_ABANDONED',
    ]);
    const verification = log.verifyAndRecord(2_000);
    expect(verification.verdict).toBe('VERIFIED');
  });
});
