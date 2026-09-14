/**
 * PC-003 — Payments read-model tests: DTO schema conformance, the frozen
 * display mapping, UNKNOWN propagation (no-answer and transport — never
 * FAILED/SUCCEEDED, never an empty list standing in for an answer), the
 * waiting sub-read's distinct honest answers, source metadata, and adapter
 * thinness (the read model delegates through the REAL port accessors —
 * proven by registering test backings at the ports' own register seams and
 * observing the DTO derive from them).
 */

import { describe, expect, test } from 'bun:test';

import { getIntentPort, registerIntentPortBacking } from '@/lib/protocol/intent-port';
import type {
  IntentPort,
  IntentQueryResult,
  IntentStateSnapshot,
  SessionIntentListResult,
} from '@/lib/protocol/intent-port';
import { getWaitingPort, registerWaitingPortBacking } from '@/lib/protocol/waiting-port';
import type {
  WaitingConditionStateId,
  WaitingLookupResult,
  WaitingPort,
  WaitingRecoveryAction,
  WaitingResolutionStateId,
  WaitingSnapshot,
  WaitingUnknownStateId,
  WaitingViewerRole,
} from '@/lib/protocol/waiting-port';
import { CONSOLE_STATUSES, isConsoleStatus } from '../dto';
import { consoleSourceMetadata } from '../authority/sources';
import { readConsolePaymentDetail, readConsolePayments } from './payments';

// ── Test backings (the ports' own register seams — no runtime is booted) ────

function intentBacking(overrides: {
  list?: () => Promise<SessionIntentListResult>;
  state?: (intentId: string) => Promise<IntentQueryResult>;
}): IntentPort {
  return {
    boundary: () => ({
      adapter: 'intent-port',
      authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
      runtimeStatus: 'LIVE',
      implementation: 'pc-003 test backing',
      authoritative: true,
      note: 'test backing',
    }),
    getCompositionOptions: () => ({
      outcomeStatements: [],
      recipients: [],
      sources: [],
      currency: 'USD',
    }),
    requestConsequenceReport: async () => ({ kind: 'no-answer', note: 'test backing' }),
    submitIntent: async () => ({
      kind: 'not-transported',
      submissionRef: 'sr_test',
      note: 'test backing',
    }),
    getIntentState: async (intentId) =>
      overrides.state
        ? overrides.state(intentId)
        : { kind: 'no-answer', reason: 'no-record', note: 'test backing holds no record' },
    listSessionIntents: async () =>
      overrides.list ? overrides.list() : { kind: 'no-answer', note: 'test backing holds no list' },
    getPresentationFixture: async () => ({
      kind: 'no-answer',
      reason: 'no-record',
      note: 'test backing',
    }),
  };
}

function waitingBacking(
  lookup: (referenceId: string, viewerRole: WaitingViewerRole) => WaitingLookupResult,
): WaitingPort {
  return {
    runtime: 'LIVE',
    authorityOwner: 'pc-003 test backing',
    nonAuthoritative: false,
    lookupWaiting: lookup,
    requestRecheck: () => ({
      status: 'rejected',
      authorityStateId: 'fq.inquiry.rejected',
      referenceId: 'ref',
      reason: 'test backing',
    }),
    requestRecovery: () => ({
      status: 'denied',
      authorityStateId: 'fq.recovery.denied',
      referenceId: 'ref',
      actionId: 'retry',
      reason: 'test backing',
    }),
  };
}

function snapshotFixture(state: string, intentId: string): IntentStateSnapshot {
  return {
    intentId,
    authority: {
      owner: 'Intent Authority',
      architectureRef: 'spec/architecture/v0.1',
      runtimeStatus: 'LIVE',
      implementation: 'pc-003 test backing',
    },
    authorityState: state as IntentStateSnapshot['authorityState'],
    reportedAt: '2026-09-15T10:00:00.000Z',
    intent: {
      intentId,
      amount: '25.00',
      currency: 'USD',
      recipientName: 'Recipient Test',
      sourceName: 'Source Test',
      customerReference: 'ref-123',
      composedAt: '2026-09-15T09:00:00.000Z',
    },
    stateReport: { kind: 'processing', activity: 'test activity', asReported: 'as reported' },
    evidence: [
      {
        id: 'ev-1',
        at: '2026-09-15T09:00:01.000Z',
        authority: 'Intent Authority',
        kind: 'submission-received',
        summary: 'received',
        details: [{ label: 'key', value: 'value' }],
      },
    ],
  };
}

// The default waiting backing (registered at module level — the ambient
// bun:test declaration exports no beforeAll): the queue authority's honest
// no-record answer, re-registered per detail test where a case needs more.
registerWaitingPortBacking(waitingBacking(() => ({ status: 'not-found', referenceId: 'any' })));

// ── Payment list ───────────────────────────────────────────────────────────

describe('PC-003 payments read model — list', () => {
  test('a records answer is a VALUE: per-item authority states + frozen display mapping + mapping records', async () => {
    registerIntentPortBacking(
      intentBacking({
        list: async () => ({
          kind: 'records',
          records: [
            {
              intentId: 'pi_1',
              authorityState: 'FULFILLED',
              reportedAt: '2026-09-15T10:00:00.000Z',
              amount: '25.00',
              currency: 'USD',
              recipientName: 'Recipient Test',
            },
            {
              intentId: 'pi_2',
              authorityState: 'ROUTED',
              reportedAt: '2026-09-15T09:00:00.000Z',
              amount: '10.00',
              currency: 'USD',
              recipientName: 'Recipient Test',
            },
            {
              intentId: 'pi_3',
              authorityState: 'DRAFT',
              reportedAt: '2026-09-15T08:00:00.000Z',
              amount: '5.00',
              currency: 'USD',
              recipientName: 'Recipient Test',
            },
          ],
        }),
      }),
    );
    const result = await readConsolePayments('customer');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    // The read-level status convention: the authority ANSWERED the read.
    expect(result.status).toBe('SUCCEEDED');
    // Per-item business truth comes from the frozen mapping — NOT an aggregate.
    expect(result.value.payments.map((p) => p.displayStatus)).toEqual(['SUCCEEDED', 'IN_PROGRESS', 'WAITING']);
    expect(result.value.payments.map((p) => p.authorityState)).toEqual(['FULFILLED', 'ROUTED', 'DRAFT']);
    expect(result.value.payments.map((p) => p.mappingRecord)).toEqual([
      'IMR-13 (spec/product/intent-mapping-records.md)',
      'IMR-11 (spec/product/intent-mapping-records.md)',
      'IMR-9 (spec/product/intent-mapping-records.md)',
    ]);
    expect(result.value.viewerRole).toBe('customer');
    expect(result.value.scopeNote.length).toBeGreaterThan(0);
    // Source metadata: the registry's payments entry, by identity.
    expect(result.authority).toBe(consoleSourceMetadata('payments'));
  });

  test('every item display status is one of the six frozen statuses', async () => {
    const states = ['DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED'] as const;
    registerIntentPortBacking(
      intentBacking({
        list: async () => ({
          kind: 'records',
          records: states.map((state, i) => ({
            intentId: `pi_${i}`,
            authorityState: state,
            reportedAt: '2026-09-15T10:00:00.000Z',
            amount: '1.00',
            currency: 'USD',
            recipientName: 'R',
          })),
        }),
      }),
    );
    const result = await readConsolePayments('operator');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.payments.length).toBe(states.length);
    for (const payment of result.value.payments) {
      expect(isConsoleStatus(payment.displayStatus)).toBe(true);
      expect((CONSOLE_STATUSES as readonly string[]).includes(payment.displayStatus)).toBe(true);
    }
  });

  test('a no-answer list is the UNAVAILABLE branch — UNKNOWN, never an empty-list VALUE', async () => {
    const note = 'The A15 chain records no intents yet — availability is UNKNOWN, not an authoritative empty list.';
    registerIntentPortBacking(intentBacking({ list: async () => ({ kind: 'no-answer', note }) }));
    const result = await readConsolePayments('merchant');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toBe(note);
    // Structurally: the unavailable branch has NO business status at all.
    expect('status' in result).toBe(false);
    expect('value' in result).toBe(false);
    expect(result.authority).toBe(consoleSourceMetadata('payments'));
  });

  test('a transport failure is UNKNOWN — never FAILED, never SUCCEEDED', async () => {
    registerIntentPortBacking(
      intentBacking({
        list: async () => {
          throw new Error('connection refused');
        },
      }),
    );
    const result = await readConsolePayments('customer');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('connection refused');
    expect(result.note).toContain('not a business outcome');
  });
});

// ── Payment detail ─────────────────────────────────────────────────────────

describe('PC-003 payments read model — detail', () => {
  test('a snapshot answer is a VALUE: authority-quoted figures, verbatim evidence, waiting none', async () => {
    registerIntentPortBacking(
      intentBacking({ state: async () => ({ kind: 'snapshot', snapshot: snapshotFixture('AUTHORIZED', 'pi_1') }) }),
    );
    const result = await readConsolePaymentDetail('pi_1', 'customer');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('IN_PROGRESS'); // frozen mapping: AUTHORIZED → IN_PROGRESS
    expect(result.value.authorityState).toBe('AUTHORIZED');
    expect(result.value.mappingRecord).toBe('IMR-10 (spec/product/intent-mapping-records.md)');
    expect(result.value.amount).toBe('25.00');
    expect(result.value.currency).toBe('USD');
    expect(result.value.recipientName).toBe('Recipient Test');
    expect(result.value.sourceName).toBe('Source Test');
    expect(result.value.customerReference).toBe('ref-123');
    expect(result.value.composedAt).toBe('2026-09-15T09:00:00.000Z');
    // Evidence carried verbatim.
    expect(result.value.evidence.length).toBe(1);
    expect(result.value.evidence[0]?.id).toBe('ev-1');
    // The queue authority's honest no-record answer is a VALUE, not UNKNOWN.
    expect(result.value.waiting.status).toBe('none');
    expect(result.authority).toBe(consoleSourceMetadata('payment-detail'));
  });

  test('the waiting sub-read carries the queue authority’s reported snapshot per kind', async () => {
    // A discriminated case union so the snapshot ids stay the authority’s
    // literal types (no invented states can enter the fixtures).
    type WaitingCase =
      | { readonly kind: 'condition'; readonly id: WaitingConditionStateId; readonly expected: 'WAITING' }
      | { readonly kind: 'unknown'; readonly id: WaitingUnknownStateId; readonly expected: 'UNKNOWN' }
      | {
          readonly kind: 'resolution';
          readonly id: WaitingResolutionStateId;
          readonly expected: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
        };
    const cases: readonly WaitingCase[] = [
      { kind: 'condition', id: 'fq.queued.liquidity-credit', expected: 'WAITING' },
      { kind: 'unknown', id: 'fq.unknown.pending-reconciliation', expected: 'UNKNOWN' },
      { kind: 'resolution', id: 'fq.resolved.completed', expected: 'SUCCEEDED' },
      { kind: 'resolution', id: 'fq.resolved.failed', expected: 'FAILED' },
      { kind: 'resolution', id: 'fq.resolved.still-unknown', expected: 'UNKNOWN' },
    ];
    for (const testCase of cases) {
      registerIntentPortBacking(
        intentBacking({ state: async () => ({ kind: 'snapshot', snapshot: snapshotFixture('ROUTED', 'pi_9') }) }),
      );
      registerWaitingPortBacking(
        waitingBacking((): WaitingLookupResult => {
          const base = {
            referenceId: 'pi_9',
            intentSummary: 'test intent',
            amount: { value: '25.00', currency: 'USD' as const },
            viewerRole: 'operator' as WaitingViewerRole,
            allowedViewerRoles: ['customer', 'merchant', 'operator'] as readonly WaitingViewerRole[],
            reportedBy: 'A08 test backing',
            reportedAt: '2026-09-15T11:00:00.000Z',
            recovery: [] as readonly WaitingRecoveryAction[],
            inquiry: { available: false, notAvailableReason: 'test', whatHappensNext: 'nothing' },
          };
          let snapshot: WaitingSnapshot;
          if (testCase.kind === 'condition') {
            snapshot = {
              ...base,
              snapshotKind: 'condition',
              authorityStateId: testCase.id,
              conditionKind: 'queued',
              whatIsWaiting: 'liquidity',
              reason: 'insufficient liquidity',
              expectation: 'next window',
            };
          } else if (testCase.kind === 'unknown') {
            snapshot = {
              ...base,
              snapshotKind: 'unknown',
              authorityStateId: testCase.id,
              subject: 'outcome unknown',
              explanation: 'pending reconciliation',
              waitedFor: 'settlement confirmation',
              reconciliation: { whoResolves: 'ops', recheckTrigger: 'next run', whatUserSeesNext: 'same page' },
            };
          } else {
            const outcome =
              testCase.id === 'fq.resolved.completed'
                ? 'succeeded'
                : testCase.id === 'fq.resolved.failed'
                  ? 'failed'
                  : 'still-unknown';
            snapshot = {
              ...base,
              snapshotKind: 'resolution',
              authorityStateId: testCase.id,
              outcome,
              outcomeDetail: 'done',
              ...(testCase.id === 'fq.resolved.failed' ? { failureReason: 'rail refused' } : {}),
            };
          }
          return { status: 'found', snapshot };
        }),
      );
      const result = await readConsolePaymentDetail('pi_9', 'operator');
      expect(result.outcome).toBe('value');
      if (result.outcome !== 'value') continue;
      expect(result.value.waiting.status).toBe('reported');
      if (result.value.waiting.status !== 'reported') continue;
      expect(result.value.waiting.authorityStateId).toBe(testCase.id);
      expect(result.value.waiting.displayStatus).toBe(testCase.expected);
    }
  });

  test('a role-denied waiting lookup is the authority’s authorization answer (not UNKNOWN)', async () => {
    registerIntentPortBacking(
      intentBacking({ state: async () => ({ kind: 'snapshot', snapshot: snapshotFixture('DRAFT', 'pi_2') }) }),
    );
    registerWaitingPortBacking(
      waitingBacking((_referenceId, viewerRole) => ({
        status: 'role-denied',
        referenceId: 'pi_2',
        viewerRole,
        allowedViewerRoles: ['operator'],
      })),
    );
    const result = await readConsolePaymentDetail('pi_2', 'customer');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.waiting.status).toBe('role-denied');
    if (result.value.waiting.status === 'role-denied') {
      expect(result.value.waiting.viewerRole).toBe('customer');
      expect(result.value.waiting.allowedViewerRoles).toEqual(['operator']);
    }
  });

  test('a waiting transport failure degrades ONLY the sub-read — the A01 answer stands', async () => {
    registerIntentPortBacking(
      intentBacking({ state: async () => ({ kind: 'snapshot', snapshot: snapshotFixture('FULFILLED', 'pi_3') }) }),
    );
    registerWaitingPortBacking(
      waitingBacking(() => {
        throw new Error('queue authority unreachable');
      }),
    );
    const result = await readConsolePaymentDetail('pi_3', 'merchant');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED');
    expect(result.value.waiting.status).toBe('unknown');
    if (result.value.waiting.status === 'unknown') {
      expect(result.value.waiting.note).toContain('queue authority unreachable');
    }
  });

  test('a no-answer detail is the UNAVAILABLE branch — UNKNOWN, never "not found" failure', async () => {
    registerIntentPortBacking(
      intentBacking({
        state: async () => ({
          kind: 'no-answer',
          reason: 'no-record',
          note: 'No intent record for this reference is reachable — UNKNOWN, never "not found" failure.',
        }),
      }),
    );
    const result = await readConsolePaymentDetail('pi_missing', 'operator');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect('status' in result).toBe(false);
    expect(result.note).toContain('UNKNOWN');
  });

  test('a transport failure of the detail read is UNKNOWN — never FAILED/SUCCEEDED', async () => {
    registerIntentPortBacking(
      intentBacking({
        state: async () => {
          throw new Error('intent authority unreachable');
        },
      }),
    );
    const result = await readConsolePaymentDetail('pi_x', 'customer');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('not a business outcome');
  });
});

// ── Adapter thinness (delegation through the REAL port accessors) ─────────

describe('PC-003 payments read model — adapter thinness', () => {
  test('the read model derives its DTO from the backing registered at the port seam (getIntentPort())', async () => {
    registerIntentPortBacking(
      intentBacking({
        list: async () => ({
          kind: 'records',
          records: [
            {
              intentId: 'pi_distinctive_7',
              authorityState: 'CANCELLED',
              reportedAt: '2026-09-15T12:00:00.000Z',
              amount: '77.77',
              currency: 'USD',
              recipientName: 'Distinctive Recipient',
            },
          ],
        }),
      }),
    );
    // The port the read model resolves IS the accessor recorded in the
    // owning-source registry (identity), and it returns the registered
    // backing — so the DTO's distinctive values prove the delegation.
    expect(getIntentPort().boundary().implementation).toBe('pc-003 test backing');
    const result = await readConsolePayments('operator');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.payments[0]?.intentId).toBe('pi_distinctive_7');
    expect(result.value.payments[0]?.amount).toBe('77.77');
    expect(result.value.payments[0]?.displayStatus).toBe('FAILED'); // CANCELLED → FAILED per the frozen mapping
    // The waiting sub-read resolves through getWaitingPort() the same way.
    expect(getWaitingPort().authorityOwner).toBe('pc-003 test backing');
  });
});
