/**
 * PC-004 — Payments list page tests (composition through the REAL read model).
 *
 * Following the PC-003 route-test precedent exactly: the request-context chain
 * is driven by mocking 'next/headers' ONLY (the real audience authority and
 * the real page run unmodified), the SYS-001 wiring seam is mocked to a no-op
 * (the same seam the product routes drive), and the intent port backing is
 * registered AT THE PORT'S OWN REGISTER SEAM — the page then composes the REAL
 * PC-003 read model over that backing. No read-model module is mocked (a
 * bun test process shares the module registry across files, and mocking the
 * read-model module would poison the PC-003 read-model and route suites that
 * import it for real).
 *
 * Proven here:
 *   - role isolation: an allowed role (customer) renders the composed list;
 *     provider (outside the frozen grant) and unauthenticated viewers are
 *     redirected BEFORE any read is composed (no port call happens);
 *   - UNKNOWN discipline: the port's no-answer renders the UNKNOWN panel —
 *     never an empty list, never a business verdict;
 *   - attribution is present on the composed page (the REAL source registry
 *     metadata, not fixture text).
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerIntentPortBacking } from '@/lib/protocol/intent-port';
import type { IntentPort, SessionIntentListResult } from '@/lib/protocol/intent-port';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// The SYS-001 wiring seam (no runtime boots in the page test).
mock.module('@/lib/protocol/server-composition', () => ({
  ensureProductPortsWired: async () => {},
}));

// ── The intent-port test backing (the port's own register seam) ────────────

let listCallCount = 0;

function intentListBacking(list: () => Promise<SessionIntentListResult>): IntentPort {
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
    getIntentState: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'page-test backing' }),
    listSessionIntents: async () => {
      listCallCount += 1;
      return list();
    },
    getPresentationFixture: async () => ({ kind: 'no-answer', reason: 'no-record', note: 'page-test backing' }),
  };
}

const RECORDS_LIST: SessionIntentListResult = {
  kind: 'records',
  records: [
    {
      intentId: 'pi_page_1',
      authorityState: 'FULFILLED',
      reportedAt: '2026-09-15T10:00:00.000Z',
      amount: '25.00',
      currency: 'USD',
      recipientName: 'Page Recipient',
    },
  ],
};

// The default backing: the records answer the composed page renders.
registerIntentPortBacking(intentListBacking(async () => RECORDS_LIST));

const ConsolePaymentsPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsolePaymentsPage());
}

/** Assert the page render redirects (the guard fired before content). */
async function expectRedirect(): Promise<void> {
  let thrown: unknown;
  try {
    await renderPage();
  } catch (error) {
    thrown = error;
  }
  const digest = (thrown as { digest?: unknown })?.digest;
  expect(typeof digest).toBe('string');
  expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
}

describe('PC-004 /console/payments page — role isolation (fail closed before any read)', () => {
  test('unauthenticated viewer is redirected and NO read is composed', async () => {
    const before = listCallCount;
    mockedAudienceCookie = undefined;
    await expectRedirect();
    expect(listCallCount).toBe(before);
  });

  test('provider (outside the frozen registry grant) is redirected and NO read is composed', async () => {
    const before = listCallCount;
    mockedAudienceCookie = 'provider';
    await expectRedirect();
    expect(listCallCount).toBe(before);
  });

  test('customer (allowed role) renders the composed payment list with attribution', async () => {
    mockedAudienceCookie = 'customer';
    const html = await renderPage();
    expect(html).toContain('data-console-view="payments-list"');
    expect(html).toContain('data-console-payment="pi_page_1"');
    expect(html).toContain('data-console-status="SUCCEEDED"');
    expect(html).toContain('25.00 USD');
    // The authority state renders verbatim with its frozen mapping record.
    expect(html).toContain('FULFILLED');
    expect(html).toContain('IMR-13 (spec/product/intent-mapping-records.md)');
    // Deep links to the flagship detail.
    expect(html).toContain('href="/console/payments/pi_page_1"');
    // Attribution renders from the REAL source-registry metadata.
    expect(html).toContain('Intent Authority (A01, spec/architecture/v0.1)');
    expect(html).toContain('getIntentPort() (src/lib/protocol/intent-port.ts)');
    // The honest scope note renders verbatim (the read model's own).
    expect(html).toContain('The intent port exposes no per-role list filter');
  });
});

describe('PC-004 /console/payments page — UNKNOWN discipline at the page level', () => {
  test('a no-answer list renders the UNKNOWN panel — never an empty list, never a business verdict', async () => {
    registerIntentPortBacking(
      intentListBacking(async () => ({
        kind: 'no-answer',
        note: 'The A15 chain records no intents — page-test no-answer backing.',
      })),
    );
    mockedAudienceCookie = 'operator';
    const html = await renderPage();
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html.includes('console-payments-empty-value')).toBe(false);
    // The port's own note renders verbatim, plus the real reconciliation path.
    expect(html).toContain('The A15 chain records no intents — page-test no-answer backing.');
    expect(html).toContain('never an empty list standing in for an authoritative zero');
    // The module header still identifies the page (registry-derived).
    expect(html).toContain('data-console-module-page="console.payments.all"');
  });

  test('a transport failure of the list read is UNKNOWN — never FAILED, never SUCCEEDED', async () => {
    registerIntentPortBacking(
      intentListBacking(() => {
        throw new Error('page-test transport failure');
      }),
    );
    mockedAudienceCookie = 'merchant';
    const html = await renderPage();
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html).toContain('transport/infrastructure failure, not a business outcome');
  });

  // Restore the default records backing for any later consumer in this file.
  registerIntentPortBacking(intentListBacking(async () => RECORDS_LIST));
});
