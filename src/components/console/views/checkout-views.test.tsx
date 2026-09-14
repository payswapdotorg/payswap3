/**
 * PC-004 — Checkout views tests (sessions + configuration + test path).
 *
 * Proven here:
 *   - sessions: boundary facts render verbatim; an EMPTY list renders as the
 *     authority's legitimate VALUE (distinct from an unavailable read); the
 *     per-session status sub-read renders the authority-reported state, and
 *     a failed sub-read degrades ONLY that session's status to UNKNOWN;
 *   - configuration: the honest gap renders (no invented settings), with the
 *     one authoritative fact (the pinned runtime status) quoted verbatim;
 *   - the test view: the server-derived environment renders, the existing
 *     execution paths link out, and NO console-local simulator language or
 *     command fabrication exists.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import type {
  ConsoleCheckoutSessionsDto,
  ConsoleCheckoutSessionStatusDto,
} from '@/lib/console/read-models/checkout-sessions';
import { ConsoleCheckoutSessionsView } from './checkout-sessions-view';
import { ConsoleCheckoutConfigurationView } from './checkout-configuration-view';
import { ConsoleCheckoutTestView } from './checkout-test-view';
import type { ConsoleEnvironmentContext } from '@/lib/console/types';

const AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'console.checkout — fixture',
  protocolObject: 'fixture checkout state',
  owningAuthority: 'Checkout/Intent Authority — fixture',
  runtimeBoundary: 'getCheckoutPort() — fixture boundary',
  durableSource: 'the durable substrate + A01 store — fixture',
  unknownSemantics: 'authority-unreachable renders UNKNOWN; empty list is a legitimate VALUE.',
  evidenceReference: 'cko-map-01..08 (spec/product/checkout-mapping-records.md)',
};

function sessionsValue(
  sessions: ConsoleCheckoutSessionsDto['sessions'],
): ConsoleReadResult<ConsoleCheckoutSessionsDto> {
  return {
    outcome: 'value',
    value: {
      sessions,
      runtime: 'ARRIVING',
      authorityOwner: 'Checkout/Intent Authority (spec/architecture/v0.1)',
      reportedBy: 'A01 runtime adapter (fixture)',
    },
    status: 'SUCCEEDED',
    authority: AUTHORITY,
  };
}

function statusValue(): ConsoleReadResult<ConsoleCheckoutSessionStatusDto> {
  return {
    outcome: 'value',
    value: {
      checkoutId: 'cko_fixture_1',
      state: 'offered',
      displayStatus: 'ACTION_REQUIRED',
      mappingRecord: 'cko-map-01 (spec/product/checkout-mapping-records.md)',
      reportedBy: 'A01 runtime adapter (fixture)',
      at: '2026-09-15T09:00:00.000Z',
      nextActions: ['accept', 'decline'],
    },
    status: 'ACTION_REQUIRED',
    authority: AUTHORITY,
  };
}

function unavailable<T>(): ConsoleReadResult<T> {
  return {
    outcome: 'unavailable',
    presentationStatus: 'UNKNOWN',
    note: 'The fixture checkout read could not reach its owning authority. This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.',
    authority: AUTHORITY,
  };
}

describe('PC-004 checkout sessions view', () => {
  const session: ConsoleCheckoutSessionsDto['sessions'][number] = {
    checkoutId: 'cko_fixture_1',
    protocolReference: 'pr_fixture_1',
    title: 'Fixture offer',
    receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
    validUntil: '2026-09-20T12:00:00.000Z',
  };

  test('renders the session facts, boundary facts, per-session status, and attribution', () => {
    const statuses = new Map<string, ConsoleReadResult<ConsoleCheckoutSessionStatusDto>>([
      ['cko_fixture_1', statusValue()],
    ]);
    const html = renderToStaticMarkup(
      <ConsoleCheckoutSessionsView result={sessionsValue([session])} statuses={statuses} />,
    );
    expect(html).toContain('data-console-checkout-session="cko_fixture_1"');
    expect(html).toContain('Fixture offer');
    expect(html).toContain('25.00 USD');
    expect(html).toContain('2026-09-20 12:00 UTC');
    // Boundary facts verbatim.
    expect(html).toContain('ARRIVING');
    expect(html).toContain('Checkout/Intent Authority (spec/architecture/v0.1)');
    // The status sub-read composes the authority-reported state.
    expect(html).toContain('data-console-status="ACTION_REQUIRED"');
    expect(html).toContain('offered');
    expect(html).toContain('cko-map-01');
    // Attribution present.
    expect(html).toContain('Checkout/Intent Authority — fixture');
    // Layout safety.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
    expect(html).toContain('break-all');
  });

  test('an EMPTY session list renders as the authoritative VALUE — distinct from UNKNOWN', () => {
    const html = renderToStaticMarkup(
      <ConsoleCheckoutSessionsView result={sessionsValue([])} statuses={new Map()} />,
    );
    expect(html).toContain('data-testid="console-checkout-empty-value"');
    expect(html).toContain('no open checkout offers');
    expect(html.includes('data-console-status="UNKNOWN"')).toBe(false);
  });

  test('a failed per-session status sub-read degrades ONLY that status to UNKNOWN', () => {
    const statuses = new Map<string, ConsoleReadResult<ConsoleCheckoutSessionStatusDto>>([
      ['cko_fixture_1', unavailable()],
    ]);
    const html = renderToStaticMarkup(
      <ConsoleCheckoutSessionsView result={sessionsValue([session])} statuses={statuses} />,
    );
    expect(html).toContain('data-testid="console-checkout-status-unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    // The listed session facts still render.
    expect(html).toContain('Fixture offer');
    expect(html).toContain('25.00 USD');
  });

  test('an unavailable list renders UNKNOWN — never a fabricated empty list', () => {
    const html = renderToStaticMarkup(
      <ConsoleCheckoutSessionsView result={unavailable()} statuses={new Map()} />,
    );
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('console-checkout-empty-value')).toBe(false);
  });
});

describe('PC-004 checkout configuration view (honest gap)', () => {
  test('renders the recorded gap and NO invented settings', () => {
    const html = renderToStaticMarkup(
      <ConsoleCheckoutConfigurationView boundary={sessionsValue([])} />,
    );
    expect(html).toContain('data-console-gap="true"');
    expect(html).toContain('No checkout configuration authority or settings read exists');
    // The one authoritative fact: the pinned runtime status, verbatim.
    expect(html).toContain('data-testid="console-checkout-configuration-runtime"');
    expect(html).toContain('ARRIVING');
    // Session items are NOT rendered here (sessions module owns them).
    expect(html.includes('data-console-checkout-session=')).toBe(false);
    // No setting-like key/value fabrication.
    expect(html.includes('name="')).toBe(false);
  });

  test('an unavailable boundary read still renders the gap (the gap is a recorded fact)', () => {
    const html = renderToStaticMarkup(
      <ConsoleCheckoutConfigurationView boundary={unavailable()} />,
    );
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
  });
});

describe('PC-004 checkout test view (existing paths, no simulator)', () => {
  const ENVIRONMENT: ConsoleEnvironmentContext = {
    kind: 'sandbox',
    configuredValue: 'sandbox',
    source: 'PAYSWAP_ENV — fixture',
    derivedBy: 'server',
    startupConfiguration: {
      ok: true,
      env: 'sandbox',
      checks: [{ id: 'fixture-check', ok: true, detail: 'fixture detail' }],
    },
  };

  test('renders the server-derived environment and the existing execution paths as links', () => {
    const html = renderToStaticMarkup(<ConsoleCheckoutTestView environment={ENVIRONMENT} />);
    expect(html).toContain('data-testid="console-checkout-test-environment"');
    expect(html).toContain('Environment: sandbox');
    expect(html).toContain('derived by server configuration only');
    // The existing sanctioned paths link out (44px targets).
    expect(html).toContain('href="/pay"');
    expect(html).toContain('href="/checkout"');
    expect(html).toContain('min-h-11');
    // The protocol command boundary is documented.
    expect(html).toContain('/api/protocol/commands');
  });

  test('composes NO simulator and fabricates NO command envelope', () => {
    const html = renderToStaticMarkup(<ConsoleCheckoutTestView environment={ENVIRONMENT} />);
    expect(html).toContain('no local checkout');
    expect(html).toContain('never constructs command envelopes');
    // No forms or inputs: nothing executes from this page.
    expect(html.includes('<form')).toBe(false);
    expect(html.includes('<input')).toBe(false);
    expect(html.includes('<button')).toBe(false);
  });

  test('the production environment renders with the production wording (server-derived only)', () => {
    const production: ConsoleEnvironmentContext = {
      ...ENVIRONMENT,
      kind: 'production',
      configuredValue: 'production',
      startupConfiguration: { ...ENVIRONMENT.startupConfiguration, env: 'production' },
    };
    const html = renderToStaticMarkup(<ConsoleCheckoutTestView environment={production} />);
    expect(html).toContain('Environment: production');
    expect(html).toContain('Production configuration is active');
  });
});
