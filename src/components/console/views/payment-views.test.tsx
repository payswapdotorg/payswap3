/**
 * PC-004 — Payment views tests (list + the §7 flagship detail).
 *
 * Fixtures are DTO-shaped only (the PC-003 read-model contracts, carried
 * verbatim from the frozen port shapes) — the components are presentational
 * over the envelope, so no authority is booted.
 *
 * Proven here:
 *   - the list renders per-item authority states with frozen display
 *     resolutions and attribution; an empty records answer renders as the
 *     legitimate VALUE it is;
 *   - an unavailable list renders UNKNOWN — never an empty list, never a
 *     business verdict;
 *   - the detail renders outcome-first, authority-quoted figures, the A15
 *     timeline, the four waiting sub-read answers, and honest absences for
 *     fields the read does not carry (rail/effect, missing reference);
 *   - a transport-failure detail renders the UNKNOWN panel with the
 *     reconciliation path — never "not found" failure;
 *   - presentation/a11y: no tables, min-w-0 containers, break-words codes,
 *     44px interactive targets.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import type {
  ConsolePaymentDetailDto,
  ConsolePaymentListDto,
} from '@/lib/console/read-models/payments';
import { ConsolePaymentListView } from './payment-list-view';
import { ConsolePaymentDetailView } from './payment-detail-view';

const AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'console.payments — fixture',
  protocolObject: 'fixture A01 intent state',
  owningAuthority: 'Intent Authority (A01) — fixture',
  runtimeBoundary: 'getIntentPort() — fixture boundary',
  durableSource: 'the durable substrate + A15 chain — fixture',
  unknownSemantics: 'No-answer renders UNKNOWN with the reconciliation path; who resolves: the intent authority.',
  evidenceReference: 'IMR-9..IMR-15 (spec/product/intent-mapping-records.md)',
};

function listValue(payments: ConsolePaymentListDto['payments']): ConsoleReadResult<ConsolePaymentListDto> {
  return {
    outcome: 'value',
    value: {
      payments,
      viewerRole: 'customer',
      scopeNote: 'Fixture scope note: the owning read authority’s own scope.',
    },
    status: 'SUCCEEDED',
    authority: AUTHORITY,
  };
}

function detailValue(
  overrides: Partial<ConsolePaymentDetailDto> = {},
): ConsoleReadResult<ConsolePaymentDetailDto> {
  const detail: ConsolePaymentDetailDto = {
    intentId: 'pi_fixture_1',
    authorityState: 'ROUTED',
    displayStatus: 'IN_PROGRESS',
    mappingRecord: 'IMR-11 (spec/product/intent-mapping-records.md)',
    reportedAt: '2026-09-15T10:00:00.000Z',
    amount: '25.00',
    currency: 'USD',
    recipientName: 'Fixture Recipient',
    sourceName: 'Fixture Source',
    customerReference: 'ref-fixture',
    composedAt: '2026-09-15T09:00:00.000Z',
    stateReport: { kind: 'processing', activity: 'fixture activity', asReported: 'as reported' },
    evidence: [
      {
        id: 'ev-fixture-1',
        at: '2026-09-15T09:00:01.000Z',
        authority: 'Intent Authority',
        kind: 'submission-received',
        summary: 'Submission received',
        details: [{ label: 'label', value: 'value' }],
      },
    ],
    waiting: {
      status: 'none',
      note: 'The Fulfillment/Queue Authority holds no waiting/queued record for this reference.',
    },
    ...overrides,
  };
  return { outcome: 'value', value: detail, status: detail.displayStatus, authority: AUTHORITY };
}

function unavailable<T>(): ConsoleReadResult<T> {
  return {
    outcome: 'unavailable',
    presentationStatus: 'UNKNOWN',
    note:
      'The fixture authority holds no record for this reference — UNKNOWN with its reconciliation path, never "not found" failure.',
    authority: AUTHORITY,
  };
}

describe('PC-004 payment list view', () => {
  test('renders per-item authority states, frozen display resolutions, and attribution', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentListView
        result={listValue([
          {
            intentId: 'pi_f1',
            authorityState: 'FULFILLED',
            displayStatus: 'SUCCEEDED',
            mappingRecord: 'IMR-13 (spec/product/intent-mapping-records.md)',
            reportedAt: '2026-09-15T10:00:00.000Z',
            amount: '25.00',
            currency: 'USD',
            recipientName: 'Fixture Recipient',
          },
          {
            intentId: 'pi_f2',
            authorityState: 'FAILED',
            displayStatus: 'FAILED',
            mappingRecord: 'IMR-14 (spec/product/intent-mapping-records.md)',
            reportedAt: '2026-09-15T11:00:00.000Z',
            amount: '10.00',
            currency: 'USD',
            recipientName: 'Fixture Recipient',
          },
        ])}
      />,
    );
    expect(html).toContain('data-console-payment="pi_f1"');
    expect(html).toContain('data-console-status="SUCCEEDED"');
    expect(html).toContain('data-console-status="FAILED"');
    expect(html).toContain('FULFILLED');
    expect(html).toContain('IMR-13');
    expect(html).toContain('25.00 USD');
    expect(html).toContain('Fixture scope note');
    // Detail deep links (44px targets).
    expect(html).toContain('href="/console/payments/pi_f1"');
    expect(html).toContain('min-h-11');
    // Attribution present.
    expect(html).toContain('Intent Authority (A01) — fixture');
    // Layout safety: no tables, min-w-0 containers, breakable codes.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
    expect(html).toContain('break-all');
  });

  test('an empty records answer renders as the legitimate VALUE it is (distinct from UNKNOWN)', () => {
    const html = renderToStaticMarkup(<ConsolePaymentListView result={listValue([])} />);
    expect(html).toContain('data-testid="console-payments-empty-value"');
    expect(html).toContain('legitimate');
    // The UNKNOWN chip never appears for an authoritative empty answer.
    expect(html.includes('data-console-status="UNKNOWN"')).toBe(false);
  });

  test('an unavailable list renders UNKNOWN — never an empty list, never a business verdict', () => {
    const html = renderToStaticMarkup(<ConsolePaymentListView result={unavailable()} />);
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html.includes('console-payments-empty-value')).toBe(false);
    // The reconciliation path renders.
    expect(html).toContain('who resolves: the intent authority');
  });
});

describe('PC-004 payment detail view (flagship)', () => {
  test('renders outcome first, authority-quoted figures, timeline, and attribution', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView result={detailValue()} requestedIntentId="pi_fixture_1" />,
    );
    // Outcome first: the status chip appears before the facts section
    // (numeric comparison outside the matcher — the ambient bun:test
    // declaration carries no toBeLessThan).
    const outcomeAt = html.indexOf('data-console-status="IN_PROGRESS"');
    const factsAt = html.indexOf('Payment detail');
    expect(outcomeAt >= 0).toBe(true);
    expect(factsAt > outcomeAt).toBe(true);
    expect(html).toContain('pi_fixture_1');
    expect(html).toContain('25.00 USD');
    expect(html).toContain('Fixture Recipient');
    expect(html).toContain('Fixture Source');
    expect(html).toContain('ref-fixture');
    expect(html).toContain('2026-09-15 09:00 UTC');
    expect(html).toContain('ROUTED');
    expect(html).toContain('IMR-11');
    // The authority state report renders verbatim.
    expect(html).toContain('fixture activity');
    // The A15 timeline renders the evidence record.
    expect(html).toContain('data-console-evidence="ev-fixture-1"');
    expect(html).toContain('submission-received');
    // The waiting sub-read's honest no-record answer.
    expect(html).toContain('data-testid="console-payment-waiting-none"');
    // Attribution present.
    expect(html).toContain('Intent Authority (A01) — fixture');
    // Layout safety.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
    expect(html).toContain('break-all');
  });

  test('honest absences: rail/effect and a missing reference are stated, never invented', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView
        result={detailValue({ customerReference: undefined })}
        requestedIntentId="pi_fixture_1"
      />,
    );
    expect(html).toContain('not carried by the intent read');
    expect(html).toContain('not carried by this read');
    // No invented rail.
    expect(html.includes('rail:')).toBe(false);
  });

  test('a reported waiting sub-read renders the queue authority’s own answer with its status', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView
        result={detailValue({
          waiting: {
            status: 'reported',
            authorityStateId: 'fq.queued.liquidity-credit',
            snapshotKind: 'condition',
            displayStatus: 'WAITING',
            summary: 'Liquidity credit is queued',
            reason: 'insufficient liquidity',
            reportedBy: 'A08 fixture',
            reportedAt: '2026-09-15T11:00:00.000Z',
            recoveryActions: ['retry'],
            inquiryAvailable: false,
          },
        })}
        requestedIntentId="pi_fixture_1"
      />,
    );
    expect(html).toContain('fq.queued.liquidity-credit');
    expect(html).toContain('Liquidity credit is queued');
    expect(html).toContain('retry');
    // The A01 answer stands: the business chip is still the intent mapping.
    expect(html).toContain('data-console-status="IN_PROGRESS"');
    expect(html).toContain('data-console-status="WAITING"');
  });

  test('a role-denied waiting sub-read renders the authority’s authorization answer (not UNKNOWN)', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView
        result={detailValue({
          waiting: { status: 'role-denied', viewerRole: 'customer', allowedViewerRoles: ['operator'] },
        })}
        requestedIntentId="pi_fixture_1"
      />,
    );
    expect(html).toContain('data-testid="console-payment-waiting-role-denied"');
    expect(html).toContain('operator');
  });

  test('a waiting transport failure degrades ONLY the sub-read (the A01 answer stands)', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView
        result={detailValue({
          waiting: { status: 'unknown', note: 'The waiting sub-read could not reach its owning authority.' },
        })}
        requestedIntentId="pi_fixture_1"
      />,
    );
    expect(html).toContain('data-testid="console-payment-waiting-unknown"');
    expect(html).toContain('stands on its own');
    expect(html).toContain('data-console-status="IN_PROGRESS"');
  });

  test('an unavailable detail renders UNKNOWN with the reconciliation path — never "not found" failure', () => {
    const html = renderToStaticMarkup(
      <ConsolePaymentDetailView result={unavailable()} requestedIntentId="pi_missing" />,
    );
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
    expect(html).toContain('pi_missing');
    expect(html).toContain('who resolves: the intent authority');
  });
});
