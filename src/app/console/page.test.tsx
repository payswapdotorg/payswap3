/**
 * PC-004 — Console Overview page tests (composition at the page seam).
 *
 * The overview composes the registry-derived module map, the server-derived
 * environment (the REAL PC-001 module), and — role-aware — the REAL PC-003
 * operations-health read model, whose lazy readiness seam is MOCKED (the
 * PC-003 route-test precedent). The read-model module itself is NEVER mocked:
 * bun's mock.module mutates a loaded module's exports in place, so a
 * read-model mock would poison the PC-003 suites that import it statically
 * in the same `bun test` process.
 *
 * Proven here:
 *   - the operator sees the composed health summary with attribution;
 *   - every OTHER role sees the honest role-scoping note and NO health data
 *     (composing operator-scoped telemetry for other roles would expose
 *     another role's data — the stop condition the role-awareness avoids);
 *   - no invented metrics: the overview carries no counts/volumes/rates;
 *   - unauthenticated viewers are redirected.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ComponentHealthDomainProjection,
  ComponentHealthProbe,
} from '@/lib/observability/readiness';
import type { ComponentHealth } from '@/lib/observability/health';
import { readinessProjection } from '@/lib/observability/health';
import type { ObservabilityDomain } from '@/lib/observability/taxonomy';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

// The readiness probe is MOCKED at the lazy seam the REAL read model loads on
// demand (loadOperationsHealthProbe → the /api/ready composition point); the
// read model then composes the fixture below into its documented DTO.
let probeCalls = 0;

const OVERVIEW_PROBE: ComponentHealthProbe = {
  overall: 'unknown-data',
  readiness: readinessProjection({ overall: 'unknown-data' } as ComponentHealth),
  generatedAt: Date.UTC(2026, 8, 15, 10, 0, 0),
  domains: (() => {
    const record = {} as Record<ObservabilityDomain, ComponentHealthDomainProjection>;
    for (const domain of OBSERVABILITY_DOMAINS) {
      record[domain] = { state: 'ok' };
    }
    record.queue = { state: 'unknown-data' };
    record.execution = {
      state: 'degraded',
      action: {
        whatToInspect: 'fixture inspect',
        drill: 'fixture drill',
        runbookSection: 'fixture runbook',
      },
    };
    return record;
  })(),
};

mock.module('@/lib/observability/readiness', () => ({
  probeComponentHealth: () => {
    probeCalls += 1;
    return OVERVIEW_PROBE;
  },
  getReadinessProbeDatabase: (): never => {
    throw new Error('console code must never open the readiness probe database directly');
  },
}));

const ConsoleOverviewPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleOverviewPage());
}

describe('PC-004 /console overview — role-aware operations-health composition', () => {
  test('operator sees the composed health summary with attribution', async () => {
    mockedAudienceCookie = 'operator';
    const html = await await renderPage();
    expect(html).toContain('data-console-view="operations-health-summary"');
    // The health authority's own vocabulary renders verbatim.
    expect(html).toContain('unknown-data');
    expect(html).toContain('health-unknown');
    expect(html).toContain('data-console-health-domain="queue"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    // Attribution from the REAL source-registry metadata (the read model's own).
    expect(html).toContain('deployment/observability authorities');
    expect(html).toContain('probeComponentHealth (src/lib/observability/readiness.ts)');
  });

  test('every non-operator role sees the scoping note and NO health data (no read composed)', async () => {
    for (const audience of ['customer', 'merchant', 'provider', 'administrator']) {
      const before = probeCalls;
      mockedAudienceCookie = audience;
      const html = await await renderPage();
      expect(html).toContain('data-testid="console-operations-health-role-scoped"');
      expect(html).toContain(audience);
      // No health data leaks: no summary view, no domain chips.
      expect(html.includes('data-console-view="operations-health-summary"')).toBe(false);
      expect(html.includes('data-console-health-domain=')).toBe(false);
      expect(probeCalls).toBe(before);
    }
  });

  test('no invented metrics: the overview states what it deliberately does not show', async () => {
    mockedAudienceCookie = 'customer';
    const html = await await renderPage();
    expect(html).toContain('data-testid="console-overview-no-invented-metrics"');
    expect(html).toContain('No payment counts, volumes, success rates');
  });
});

describe('PC-004 /console overview — module map + environment (PC-002 content preserved)', () => {
  test('the registry-derived module map and environment render for every role', async () => {
    for (const audience of ['customer', 'merchant', 'provider', 'operator', 'administrator']) {
      mockedAudienceCookie = audience;
      const html = await await renderPage();
      expect(html).toContain('data-testid="console-principal-role"');
      expect(html).toContain(audience);
      expect(html).toContain('data-testid="console-environment-kind"');
      expect(html).toContain('Frozen route/module registry');
      expect(html).toContain('Your console modules');
    }
  });

  test('unauthenticated viewer is redirected before any content renders', async () => {
    const before = probeCalls;
    mockedAudienceCookie = undefined;
    let thrown: unknown;
    try {
      await renderPage();
    } catch (error) {
      thrown = error;
    }
    const digest = (thrown as { digest?: unknown })?.digest;
    expect(typeof digest).toBe('string');
    expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    expect(probeCalls).toBe(before);
  });
});
