/**
 * PC-004 — Operations health view tests (summary + per-domain module view).
 *
 * Proven here:
 *   - the summary renders the worst-of rollup, readiness, and every domain
 *     with the health authority's own state vocabulary verbatim;
 *   - unknown-data (the health authority's own UNKNOWN) renders UNKNOWN —
 *     distinct from business FAILED, never a guessed ok;
 *   - the per-module domain view highlights the module's own domain and
 *     renders the full taxonomy with the action descriptors;
 *   - the honest gap panel names the module-specific telemetry that has no
 *     exposed read at this baseline;
 *   - an unavailable read renders UNKNOWN — never ok, never down.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleOperationsHealthDto } from '@/lib/console/read-models/operations-health';
import {
  ConsoleOperationsHealthSummaryView,
  ConsoleOperationsDomainView,
  OPERATIONS_MODULE_DOMAIN,
  OPERATIONS_MODULE_GAP,
} from './operations-health-view';

const AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'console.operations.* — fixture',
  protocolObject: 'the nine observability domains — fixture',
  owningAuthority: 'deployment/observability authorities — fixture',
  runtimeBoundary: 'probeComponentHealth() — fixture boundary',
  durableSource: 'durable_events / durable_jobs signals — fixture',
  unknownSemantics: 'the probe is fail-closed: an underivable snapshot reports unknown-data.',
  evidenceReference: 'spec/system-reconciliation.md + DEP-007 evidence',
};

function healthValue(
  domains: ConsoleOperationsHealthDto['domains'],
  overall: ConsoleOperationsHealthDto['overall'] = 'ok',
): ConsoleReadResult<ConsoleOperationsHealthDto> {
  return {
    outcome: 'value',
    value: {
      overall,
      overallDisplayStatus: overall === 'ok' ? 'SUCCEEDED' : overall === 'unknown-data' ? 'UNKNOWN' : 'FAILED',
      readiness: overall === 'ok' ? 'ready' : overall === 'unknown-data' ? 'health-unknown' : 'unhealthy',
      generatedAt: Date.UTC(2026, 8, 15, 10, 0, 0),
      domains,
    },
    status: overall === 'ok' ? 'SUCCEEDED' : overall === 'unknown-data' ? 'UNKNOWN' : 'FAILED',
    authority: AUTHORITY,
  };
}

function domainFixture(
  domain: string,
  state: ConsoleOperationsHealthDto['domains'][number]['state'],
): ConsoleOperationsHealthDto['domains'][number] {
  const displayStatus =
    state === 'ok' ? 'SUCCEEDED' : state === 'unknown-data' ? 'UNKNOWN' : state === 'down' ? 'FAILED' : 'ACTION_REQUIRED';
  return {
    domain,
    state,
    displayStatus,
    ...(state === 'ok'
      ? {}
      : {
          action: {
            whatToInspect: `inspect ${domain}`,
            drill: `drill ${domain}`,
            runbookSection: `runbook ${domain}`,
          },
        }),
  };
}

function unavailable(): ConsoleReadResult<ConsoleOperationsHealthDto> {
  return {
    outcome: 'unavailable',
    presentationStatus: 'UNKNOWN',
    note: 'The fixture health probe could not be evaluated. This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.',
    authority: AUTHORITY,
  };
}

describe('PC-004 operations health summary view', () => {
  test('renders the rollup, readiness, every domain verbatim, and attribution', () => {
    const html = renderToStaticMarkup(
      <ConsoleOperationsHealthSummaryView
        result={healthValue([
          domainFixture('queue', 'ok'),
          domainFixture('unknown', 'unknown-data'),
        ])}
      />,
    );
    expect(html).toContain('data-console-view="operations-health-summary"');
    expect(html).toContain('data-console-status="SUCCEEDED"');
    // The health authority's own vocabulary renders verbatim.
    expect(html).toContain('unknown-data');
    expect(html).toContain('ready');
    // Per-domain chips: ok → SUCCEEDED, unknown-data → UNKNOWN.
    expect(html).toContain('data-console-status="UNKNOWN"');
    // The domain ids render as the authority's own vocabulary.
    expect(html).toContain('data-console-health-domain="queue"');
    expect(html).toContain('data-console-health-domain="unknown"');
    // Attribution present.
    expect(html).toContain('deployment/observability authorities — fixture');
    // Layout safety.
    expect(html.includes('<table')).toBe(false);
    expect(html).toContain('min-w-0');
  });

  test('the probe’s fail-closed error renders when present (named by the authority)', () => {
    const value = healthValue([domainFixture('queue', 'unknown-data')], 'unknown-data');
    const withError: ConsoleReadResult<ConsoleOperationsHealthDto> =
      value.outcome === 'value'
        ? {
            ...value,
            value: { ...value.value, probeError: 'fixture: snapshot underivable' },
          }
        : value;
    const html = renderToStaticMarkup(<ConsoleOperationsHealthSummaryView result={withError} />);
    expect(html).toContain('data-testid="console-health-probe-error"');
    expect(html).toContain('fixture: snapshot underivable');
  });

  test('an unavailable health read renders UNKNOWN — never ok, never down', () => {
    const html = renderToStaticMarkup(<ConsoleOperationsHealthSummaryView result={unavailable()} />);
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="SUCCEEDED"')).toBe(false);
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
  });
});

describe('PC-004 operations domain view (per-module)', () => {
  test('highlights the module’s own domain and renders the full taxonomy with actions', () => {
    const html = renderToStaticMarkup(
      <ConsoleOperationsDomainView
        result={healthValue([domainFixture('queue', 'degraded'), domainFixture('command', 'ok')])}
        href="/console/operations/queues"
      />,
    );
    expect(html).toContain('data-console-module-id="console.operations.queues"');
    // The module's own domain renders highlighted — once in the module
    // section and once in the full taxonomy.
    expect(html.split('data-console-health-domain="queue"').length - 1).toBe(2);
    expect(html).toContain('ring-1');
    // The highlighted domain renders its REQUIRED action descriptor.
    expect(html).toContain('inspect queue');
    expect(html).toContain('runbook queue');
    expect(html).toContain('degraded');
    // The gap panel names the module-specific telemetry gap.
    expect(html).toContain('data-testid="console-operations-gap"');
    expect(html).toContain('no queue-depth or worker listing read is exposed');
    // Attribution present.
    expect(html).toContain('deployment/observability authorities — fixture');
  });

  test('every operations module maps to exactly one frozen taxonomy domain with a gap statement', () => {
    // The mapping covers exactly the six operations module ids, and every
    // mapped domain is one of the nine frozen taxonomy ids the read model
    // can carry.
    const operationsModules = Object.keys(OPERATIONS_MODULE_DOMAIN);
    expect(operationsModules).toEqual([
      'console.operations.queues',
      'console.operations.execution',
      'console.operations.reconciliation',
      'console.operations.unknown',
      'console.operations.clearing-netting',
      'console.operations.incidents',
    ]);
    const taxonomyDomains = [
      'command',
      'queue',
      'execution',
      'unknown',
      'reconciliation',
      'clearing-netting',
      'settlement-finality',
      'incident-recovery',
      'deployment',
    ];
    for (const domain of Object.values(OPERATIONS_MODULE_DOMAIN)) {
      expect(taxonomyDomains.includes(domain)).toBe(true);
    }
    // Every operations module has a recorded gap statement.
    for (const moduleId of operationsModules) {
      expect(OPERATIONS_MODULE_GAP[moduleId]).toBeTruthy();
    }
  });

  test('an unavailable read on an operations page renders UNKNOWN — never a verdict', () => {
    const html = renderToStaticMarkup(
      <ConsoleOperationsDomainView result={unavailable()} href="/console/operations/incidents" />,
    );
    expect(html).toContain('data-console-read="unavailable"');
    expect(html).toContain('data-console-status="UNKNOWN"');
    expect(html.includes('data-console-status="FAILED"')).toBe(false);
  });
});
