/**
 * PC-004 — Payment detail page tests (the §7 flagship, at the page seam).
 *
 * The PC-003 route-test precedent: 'next/headers' mocked (the real guard chain
 * runs), the wiring seam mocked to a no-op, and the intent + waiting port
 * backings registered at the ports' OWN register seams — the page then composes
 * the REAL PC-003 payment-detail read model over them (no read-model module is
 * mocked: the bun test process shares the module registry across files, and a
 * read-model mock would poison the PC-003 suites that import it for real).
 * The page's `params` promise drives the requested reference.
 *
 * Proven here:
 *   - an allowed role receives the composed flagship view (outcome-first
 *     facts, timeline, waiting sub-read, attribution from the REAL source
 *     registry);
 *   - a no-answer read renders UNKNOWN with the reconciliation path — never
 *     "not found" failure (design §7/§9);
 *   - role isolation: provider is redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerIntentPortBacking } from '@/lib/protocol/intent-port';
import type { IntentPort, IntentQueryResult, IntentStateSnapshot } from '@/lib/protocol/intent-port';
import { registerWaitingPortBacking } from '@/lib/protocol/waiting-port';
import type { WaitingPort } from '@/lib/protocol/waiting-port';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

// ── Port test backings (the ports' own register seams) ─────────────────────

let stateCallCount = 0;

function intentStateBacking(state: (intentId: string) => Promise<IntentQueryResult>): IntentPort {
  return {
    boundary: () => ({
      adapter: 'intent-port',
      authorityOwner: 'Intent Authority (spec/architecture/v0.1)',
      runtimeStatus: 'LIVE',
      implementation: 'pc-004 page-test backing',
      authoritative: true,
      note: 'page-test backing',
    }),
    getCompositionOptions: () => ({
      outcomeStatements: [],
      recipients: [],
      sources: [],
      currency: 'USD',
    }),
    requestConsequenceReport: async () => ({ kind: 'no-answer', note: 'page-test backing' }),
    submitIntent: async () => ({
      kind: 'not-transported',
      submissionRef: 'sr_page_test',
      note: 'page-test backing',
    }),
    getIntentState: async (intentId) => {
      stateCallCount += 1;
      return state(intentId);
    },
    listSessionIntents: async () => ({ kind: 'no-answer', note: 'page-test backing holds no list' }),
    getPresentationFixture: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'page-test backing' }),
  };
}

function waitingNoRecordBacking(): WaitingPort {
  return {
    runtime: 'LIVE',
    authorityOwner: 'Fulfillment/Queue Authority (pc-004 page-test backing)',
    nonAuthoritative: false,
    lookupWaiting: () => ({ status: 'not-found', referenceId: 'any' }),
    requestRecheck: () => ({
      status: 'rejected',
      authorityStateId: 'fq.inquiry.rejected',
      referenceId: 'ref',
      reason: 'page-test backing',
    }),
    requestRecovery: () => ({
      status: 'denied',
      authorityStateId: 'fq.recovery.denied',
      referenceId: 'ref',
      actionId: 'retry',
      reason: 'page-test backing',
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
      implementation: 'pc-004 page-test backing',
    },
    authorityState: state as IntentStateSnapshot['authorityState'],
    reportedAt: '2026-09-15T10:00:00.000Z',
    intent: {
      intentId,
      amount: '25.00',
      currency: 'USD',
      recipientName: 'Detail Recipient',
      sourceName: 'Detail Source',
      customerReference: 'ref-detail',
      composedAt: '2026-09-15T09:00:00.000Z',
    },
    stateReport: { kind: 'processing', activity: 'fixture activity', asReported: 'as reported' },
    evidence: [
      {
        id: 'ev-detail-1',
        at: '2026-09-15T09:00:01.000Z',
        authority: 'Intent Authority',
        kind: 'submission-received',
        summary: 'Submission received',
        details: [],
      },
    ],
  };
}

const SNAPSHOT_RESULT: IntentQueryResult = {
  kind: 'snapshot',
  snapshot: snapshotFixture('AUTHORIZED', 'pi_detail_1'),
};

// The default backings: the snapshot the composed page renders, plus the
// queue authority's honest no-record answer for the waiting sub-read.
registerIntentPortBacking(intentStateBacking(async () => SNAPSHOT_RESULT));
registerWaitingPortBacking(waitingNoRecordBacking());

const ConsolePaymentsPaymentIdPage = (await import('./page')).default;

async function renderPage(paymentId: string): Promise<string> {
  return renderToStaticMarkup(
    await ConsolePaymentsPaymentIdPage({ params: Promise.resolve({ paymentId }) }),
  );
}

describe('PC-004 /console/payments/[paymentId] page — flagship composition', () => {
  test('customer receives the composed flagship view: outcome first, figures, timeline, attribution', async () => {
    mockedAudienceCookie = 'customer';
    const html = await renderPage('pi_detail_1');
    expect(html).toContain('data-console-view="payment-detail"');
    expect(html).toContain('pi_detail_1');
    expect(html).toContain('data-console-status="IN_PROGRESS"');
    // Outcome precedes the detail facts (the facts section's own heading id);
    // numeric comparison outside the matcher — the ambient bun:test
    // declaration carries no toBeLessThan.
    const outcomeAt = html.indexOf('data-console-status="IN_PROGRESS"');
    const factsAt = html.indexOf('id="console-payment-facts"');
    expect(outcomeAt >= 0).toBe(true);
    expect(factsAt > outcomeAt).toBe(true);
    expect(html).toContain('25.00 USD');
    expect(html).toContain('Detail Recipient');
    expect(html).toContain('Detail Source');
    expect(html).toContain('ref-detail');
    // The frozen display mapping + its record, verbatim.
    expect(html).toContain('AUTHORIZED');
    expect(html).toContain('IMR-10 (spec/product/intent-mapping-records.md)');
    // The authority state report renders verbatim.
    expect(html).toContain('fixture activity');
    // The A15 timeline renders the evidence record the port surfaced.
    expect(html).toContain('data-console-evidence="ev-detail-1"');
    expect(html).toContain('submission-received');
    // The waiting sub-read's honest no-record answer.
    expect(html).toContain('data-testid="console-payment-waiting-none"');
    // Honest absences for fields this read does not carry.
    expect(html).toContain('not carried by the intent read');
    // Attribution from the REAL source-registry metadata.
    expect(html).toContain('Intent Authority (A01) for intent/evidence reads');
    expect(html).toContain('Fulfillment/Queue Authority (A08, with A06/A07 reads)');
  });

  test('an encoded reference is decoded once for the read and rendered raw', async () => {
    mockedAudienceCookie = 'customer';
    const html = await renderPage('pi_detail_1');
    expect(html).toContain('pi_detail_1');
  });

  test('a no-answer read renders UNKNOWN with the reconciliation path — never "not found" failure', async () => {
    registerIntentPortBacking(
      intentStateBacking(async () => ({
        kind: 'no-answer',
        reason: 'no-record',
        note: 'No intent record for this reference is reachable — page-test no-answer backing.',
      })),
    );
    mockedAudienceCookie = 'operator';
    const html = await renderPage('pi_missing');
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html).toContain('pi_missing');
    expect(html).toContain('No intent record for this reference is reachable — page-test no-answer backing.');
    expect(html).toContain('getIntentState() no-answer renders UNKNOWN with its reconciliation path');
  });

  // Restore the default snapshot backing for any later consumer in this file.
  registerIntentPortBacking(intentStateBacking(async () => SNAPSHOT_RESULT));
});

describe('PC-004 /console/payments/[paymentId] page — role isolation', () => {
  test('provider is redirected before any read composes', async () => {
    const before = stateCallCount;
    mockedAudienceCookie = 'provider';
    let thrown: unknown;
    try {
      await renderPage('pi_detail_1');
    } catch (error) {
      thrown = error;
    }
    const digest = (thrown as { digest?: unknown })?.digest;
    expect(typeof digest).toBe('string');
    expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    expect(stateCallCount).toBe(before);
  });
});
