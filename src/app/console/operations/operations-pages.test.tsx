/**
 * PC-004 — Operations pages tests (all six operations modules at the page
 * seam).
 *
 * The pages compose the REAL PC-003 operations-health read model, whose lazy
 * readiness seam is MOCKED (the PC-003 route-test precedent). The read-model
 * module itself is NEVER mocked: bun's mock.module mutates a loaded module's
 * exports in place, so a read-model mock would poison the PC-003 suites that
 * import it statically in the same `bun test` process.
 *
 * Proven here:
 *   - every operations page composes the PC-003 operations-health read model
 *     and highlights its OWN frozen taxonomy domain;
 *   - the health authority's own vocabulary renders verbatim and its
 *     unknown-data state renders UNKNOWN (never a guessed ok, never a
 *     business verdict);
 *   - the honest gap panel names the module-specific telemetry with no
 *     exposed read at this baseline;
 *   - role isolation: operator passes; every other role redirects before any
 *     read composes (the six operations modules are operator-only).
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
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

const OPERATIONS_PROBE: ComponentHealthProbe = {
  overall: 'unknown-data',
  readiness: readinessProjection({ overall: 'unknown-data' } as ComponentHealth),
  generatedAt: Date.UTC(2026, 8, 15, 10, 0, 0),
  domains: (() => {
    const record = {} as Record<ObservabilityDomain, ComponentHealthDomainProjection>;
    for (const domain of OBSERVABILITY_DOMAINS) {
      record[domain] = { state: 'ok' };
    }
    record.queue = {
      state: 'degraded',
      action: {
        whatToInspect: 'inspect queue',
        drill: 'drill queue',
        runbookSection: 'runbook queue',
      },
    };
    record.unknown = { state: 'unknown-data' };
    return record;
  })(),
};

mock.module('@/lib/observability/readiness', () => ({
  probeComponentHealth: () => {
    probeCalls += 1;
    return OPERATIONS_PROBE;
  },
  getReadinessProbeDatabase: (): never => {
    throw new Error('console code must never open the readiness probe database directly');
  },
}));

const QUEUES = (await import('./queues/page')).default;
const EXECUTION = (await import('./execution/page')).default;
const RECONCILIATION = (await import('./reconciliation/page')).default;
const UNKNOWN_CASES = (await import('./unknown/page')).default;
const CLEARING_NETTING = (await import('./clearing-netting/page')).default;
const INCIDENTS = (await import('./incidents/page')).default;

/** An async server-component page (renders a React element tree). */
type AsyncPage = () => Promise<ReactElement>;
const PAGES: readonly [string, AsyncPage, string][] = [
  ['queues', QUEUES, 'queue'],
  ['execution', EXECUTION, 'execution'],
  ['reconciliation', RECONCILIATION, 'reconciliation'],
  ['unknown', UNKNOWN_CASES, 'unknown'],
  ['clearing-netting', CLEARING_NETTING, 'clearing-netting'],
  ['incidents', INCIDENTS, 'incident-recovery'],
];

/** Render one async page component to static markup. */
async function render(page: AsyncPage): Promise<string> {
  return renderToStaticMarkup(await page());
}

/** True when the page render redirects (the guard fired before content). */
async function renderRedirected(page: AsyncPage): Promise<boolean> {
  try {
    await page();
    return false;
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
  }
}

describe('PC-004 operations pages — composed health per module', () => {
  for (const [name, page, domain] of PAGES) {
    test(`the ${name} page composes the health read and highlights its own domain (${domain})`, async () => {
      mockedAudienceCookie = 'operator';
      const html = await render(page);
      expect(html).toContain('data-console-view="operations-domain"');
      expect(html).toContain(`data-console-module-id="console.operations.${name}"`);
      // The module's own domain appears highlighted (module section + taxonomy).
      expect(html.split(`data-console-health-domain="${domain}"`).length - 1).toBe(2);
      expect(html).toContain('ring-1');
      // The full frozen taxonomy renders with verbatim states.
      expect(html).toContain('unknown-data');
      expect(html).toContain('degraded');
      // The honest gap panel names the module-specific telemetry gap.
      expect(html).toContain('data-testid="console-operations-gap"');
      // Attribution from the REAL source-registry metadata (the read model's own).
      expect(html).toContain('deployment/observability authorities');
      expect(html).toContain('probeComponentHealth (src/lib/observability/readiness.ts)');
      // Layout safety.
      expect(html.includes('<table')).toBe(false);
    });
  }

  test('the health authority’s own UNKNOWN (unknown-data) renders UNKNOWN — never a guessed ok', async () => {
    mockedAudienceCookie = 'operator';
    const html = await render(UNKNOWN_CASES);
    expect(html).toContain('data-console-health-domain="unknown"');
    expect(html).toContain('unknown-data');
    expect(html).toContain('data-console-status="UNKNOWN"');
    // The OVERALL rollup chip is UNKNOWN (unknown-data overall) — its aria-label
    // is the UNKNOWN presentation carrying the overall subject. Per-domain chips
    // for the fixture's ok domains legitimately render SUCCEEDED; the OVERALL
    // verdict is what must never be a guessed ok.
    expect(html).toMatch(/aria-label="Unknown\.[^"]*Subject: overall operations health\./);
    const overallSucceeded = /aria-label="Succeeded\.[^"]*Subject: overall operations health\./.test(html);
    expect(overallSucceeded).toBe(false);
  });
});

describe('PC-004 operations pages — role isolation (operator-only modules)', () => {
  test('every non-operator role redirects before any read composes, on every operations page', async () => {
    for (const [, page] of PAGES) {
      const before = probeCalls;
      for (const audience of ['customer', 'merchant', 'provider', 'administrator']) {
        mockedAudienceCookie = audience;
        expect(await renderRedirected(page)).toBe(true);
      }
      expect(probeCalls).toBe(before);
    }
  });

  test('unauthenticated viewers redirect on every operations page', async () => {
    for (const [, page] of PAGES) {
      mockedAudienceCookie = undefined;
      expect(await renderRedirected(page)).toBe(true);
    }
  });
});
