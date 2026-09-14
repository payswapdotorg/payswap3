/**
 * PC-003 — Console payment detail API tests: the thin route wiring
 * end-to-end (the flagship read). Server-side role check FIRST (fail-closed
 * 404 {ok:false}), then the SYS-001 wiring seam (mocked to a no-op — the port
 * backings are registered at the REAL port seams), then the read result
 * through the PC-001 envelope untouched. Only the dynamic route segment
 * identifies the reference; a reference the authority cannot answer for is
 * the UNKNOWN envelope branch — AUTHORIZATION denial is the only 404.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// Registered BEFORE the route module is dynamically imported: the real
// server-composition binds the server-only durable substrate at LOAD time.
mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

const { GET } = await import('./route');
const { registerIntentPortBacking: registerIntent } = await import('@/lib/protocol/intent-port');
const { registerWaitingPortBacking: registerWaiting } = await import('@/lib/protocol/waiting-port');
import type { IntentPort, IntentQueryResult } from '@/lib/protocol/intent-port';
import type { WaitingLookupResult, WaitingPort } from '@/lib/protocol/waiting-port';

function waitingBacking(lookup: () => WaitingLookupResult): WaitingPort {
  return {
    runtime: 'LIVE',
    authorityOwner: 'pc-003 route test backing',
    nonAuthoritative: false,
    lookupWaiting: () => lookup(),
    requestRecheck: () => ({
      status: 'rejected',
      authorityStateId: 'fq.inquiry.rejected',
      referenceId: 'ref',
      reason: 'route test backing',
    }),
    requestRecovery: () => ({
      status: 'denied',
      authorityStateId: 'fq.recovery.denied',
      referenceId: 'ref',
      actionId: 'retry',
      reason: 'route test backing',
    }),
  };
}

function detailBacking(state: (intentId: string) => Promise<IntentQueryResult>): IntentPort {
  return {
    boundary: () => ({
      adapter: 'intent-port',
      authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
      runtimeStatus: 'LIVE',
      implementation: 'pc-003 route test backing',
      authoritative: true,
      note: 'route test backing',
    }),
    getCompositionOptions: () => ({
      outcomeStatements: [],
      recipients: [],
      sources: [],
      currency: 'USD',
    }),
    requestConsequenceReport: async () => ({ kind: 'no-answer', note: 'route test backing' }),
    submitIntent: async () => ({
      kind: 'not-transported',
      submissionRef: 'sr_route_test',
      note: 'route test backing',
    }),
    getIntentState: state,
    listSessionIntents: async () => ({ kind: 'no-answer', note: 'route test backing' }),
    getPresentationFixture: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'route test backing' }),
  };
}

function request(paymentId: string): Request {
  return new Request(`http://localhost/api/console/payments/${paymentId}`);
}

describe('PC-003 /api/console/payments/[paymentId] — fail-closed authorization', () => {
  test('unauthenticated caller gets 404 and NO content', async () => {
    mockedAudienceCookie = undefined;
    const response = await GET(request('pi_1'), { params: Promise.resolve({ paymentId: 'pi_1' }) });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
    expect(Object.keys(body)).toEqual(['ok']);
  });

  test('a role outside the frozen registry grant (provider) is denied with the same 404', async () => {
    mockedAudienceCookie = 'provider';
    const response = await GET(request('pi_1'), { params: Promise.resolve({ paymentId: 'pi_1' }) });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok?: unknown };
    expect(body.ok).toBe(false);
  });
});

describe('PC-003 /api/console/payments/[paymentId] — the flagship read through the envelope', () => {
  test('an allowed role receives the authority-quoted detail for the referenced payment', async () => {
    mockedAudienceCookie = 'customer';
    registerIntent(
      detailBacking(async (intentId) => ({
        kind: 'snapshot',
        snapshot: {
          intentId,
          authority: {
            owner: 'Intent Authority',
            architectureRef: 'spec/architecture/v0.1',
            runtimeStatus: 'LIVE',
            implementation: 'pc-003 route test backing',
          },
          authorityState: 'FULFILLING',
          reportedAt: '2026-09-15T10:00:00.000Z',
          intent: {
            intentId,
            amount: '12.34',
            currency: 'USD',
            recipientName: 'Detail Recipient',
            sourceName: 'Detail Source',
            composedAt: '2026-09-15T09:00:00.000Z',
          },
          stateReport: { kind: 'processing', activity: 'test activity', asReported: 'as reported' },
          evidence: [],
        },
      })),
    );
    registerWaiting(waitingBacking(() => ({ status: 'not-found', referenceId: 'pi_detail_9' })));
    const response = await GET(request('pi_detail_9'), {
      params: Promise.resolve({ paymentId: 'pi_detail_9' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      principal: { role: string };
      result: {
        outcome: string;
        status: string;
        value: { intentId: string; authorityState: string; displayStatus: string; waiting: { status: string } };
        authority: { view: string };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.principal.role).toBe('customer');
    expect(body.result.outcome).toBe('value');
    expect(body.result.status).toBe('IN_PROGRESS'); // frozen mapping: FULFILLING → IN_PROGRESS
    expect(body.result.value.intentId).toBe('pi_detail_9'); // the dynamic segment reached the read
    expect(body.result.value.authorityState).toBe('FULFILLING');
    expect(body.result.value.displayStatus).toBe('IN_PROGRESS');
    expect(body.result.value.waiting.status).toBe('none');
    expect(body.result.authority.view).toContain('console.payments.detail');
  });

  test('a no-answer for the reference is 200 + presentation UNKNOWN — never a 404, never "not found" failure', async () => {
    mockedAudienceCookie = 'operator';
    registerIntent(
      detailBacking(async () => ({
        kind: 'no-answer',
        reason: 'no-record',
        note: 'No intent record for this reference is reachable — UNKNOWN, never "not found" failure.',
      })),
    );
    const response = await GET(request('pi_missing'), {
      params: Promise.resolve({ paymentId: 'pi_missing' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { outcome: string; presentationStatus: string };
    };
    expect(body.result.outcome).toBe('unavailable');
    expect(body.result.presentationStatus).toBe('UNKNOWN');
  });
});
