/**
 * PC-003 — Operations health read-model tests: the documented health→console
 * status projection (exhaustive over the health authority's four states), DTO
 * schema conformance over the NINE frozen observability domains, the
 * fail-closed probe's own answers as VALUES (unknown-data ⇒ presentation
 * UNKNOWN — never a guessed ok, never down), transport failure of the probe
 * itself ⇒ the UNAVAILABLE branch, and delegation through the lazy readiness
 * accessor (the /api/ready composition point).
 *
 * The readiness module is MOCKED (mock.module) — the real module binds the
 * server-only durable substrate; the read model loads it ON DEMAND through
 * loadOperationsHealthProbe(), which is exactly the seam the mock replaces.
 * The mocked module also PROVES the console read never touches the probe
 * database seam itself: getReadinessProbeDatabase throws if called.
 */

import { describe, expect, mock, test } from 'bun:test';

import type {
  ComponentHealthDomainProjection,
  ComponentHealthProbe,
} from '@/lib/observability/readiness';
import type { ComponentHealth, HealthState } from '@/lib/observability/health';
import { HEALTH_SEVERITY, readinessProjection } from '@/lib/observability/health';
import type { ObservabilityDomain } from '@/lib/observability/taxonomy';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';
import { CONSOLE_STATUSES, isConsoleStatus } from '../dto';
import { consoleSourceMetadata, loadOperationsHealthProbe } from '../authority/sources';
import { OPERATIONS_HEALTH_STATUS, readConsoleOperationsHealth } from './operations-health';

// ── The mocked readiness module (the lazy accessor's dynamic-import target) ─

let mockedProbe: ComponentHealthProbe | undefined;
let probeCalls = 0;

mock.module('@/lib/observability/readiness', () => ({
  probeComponentHealth: (): ComponentHealthProbe => {
    probeCalls += 1;
    if (mockedProbe === undefined) {
      throw new Error('test fixture not set');
    }
    return mockedProbe;
  },
  // The console read must NEVER open the probe database itself — the probe's
  // own fail-closed internals own database handling. Calling this from the
  // console boundary is a boundary violation and fails the test loudly.
  getReadinessProbeDatabase: (): never => {
    throw new Error('console code must never open the readiness probe database directly');
  },
}));

// ── Fixtures (shaped exactly like the real probe's projection) ─────────────

function probeFixture(domains: Record<string, HealthState>, overall: HealthState, probeError?: string): ComponentHealthProbe {
  const record = {} as Record<ObservabilityDomain, ComponentHealthDomainProjection>;
  for (const domain of OBSERVABILITY_DOMAINS) {
    const state = domains[domain] ?? 'ok';
    record[domain] =
      state === 'ok'
        ? { state }
        : {
            state,
            action: {
              whatToInspect: `inspect ${domain}`,
              drill: `drill ${domain}`,
              runbookSection: `runbook#${domain}`,
            },
          };
  }
  return {
    overall,
    // The authority’s OWN readiness projection (only `overall` participates
    // — the cast carries the minimal health object the function reads).
    readiness: readinessProjection({ overall } as ComponentHealth),
    generatedAt: 1726444800000,
    domains: record,
    ...(probeError === undefined ? {} : { probeError }),
  };
}

// ── The documented projection (exhaustive, nothing invented) ───────────────

describe('PC-003 operations health — the documented health→console status projection', () => {
  test('the projection is exhaustive over the health authority’s four states (and nothing else)', () => {
    expect(Object.keys(OPERATIONS_HEALTH_STATUS).sort()).toEqual(
      ['degraded', 'down', 'ok', 'unknown-data'].sort(),
    );
    expect(HEALTH_SEVERITY['ok']).toBe(0); // the frozen severity order (worst last)
  });

  test('each health state projects to exactly one of the six frozen statuses', () => {
    for (const state of Object.keys(OPERATIONS_HEALTH_STATUS) as HealthState[]) {
      expect(isConsoleStatus(OPERATIONS_HEALTH_STATUS[state])).toBe(true);
      expect((CONSOLE_STATUSES as readonly string[]).includes(OPERATIONS_HEALTH_STATUS[state])).toBe(true);
    }
    expect(OPERATIONS_HEALTH_STATUS['ok']).toBe('SUCCEEDED');
    expect(OPERATIONS_HEALTH_STATUS['degraded']).toBe('ACTION_REQUIRED');
    expect(OPERATIONS_HEALTH_STATUS['unknown-data']).toBe('UNKNOWN');
    expect(OPERATIONS_HEALTH_STATUS['down']).toBe('FAILED');
  });
});

// ── The read ───────────────────────────────────────────────────────────────

describe('PC-003 operations health read model — the probe’s answers are VALUES', () => {
  test('a healthy probe is a VALUE: overall ok, all nine domains in the frozen order, no probeError', async () => {
    mockedProbe = probeFixture({}, 'ok');
    const result = await readConsoleOperationsHealth();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED');
    expect(result.value.overall).toBe('ok');
    expect(result.value.overallDisplayStatus).toBe('SUCCEEDED');
    expect(result.value.readiness).toBe('ready');
    expect(result.value.generatedAt).toBe(1726444800000);
    expect('probeError' in result.value).toBe(false);
    // All NINE domains, in the frozen taxonomy order, verbatim states.
    expect(result.value.domains.map((domain) => domain.domain)).toEqual([...OBSERVABILITY_DOMAINS]);
    expect(OBSERVABILITY_DOMAINS.length).toBe(9);
    for (const domain of result.value.domains) {
      expect(domain.state).toBe('ok');
      expect(domain.displayStatus).toBe('SUCCEEDED');
      expect('action' in domain).toBe(false);
    }
    expect(result.authority).toBe(consoleSourceMetadata('operations-health'));
  });

  test('a mixed probe carries each domain’s own state verbatim + the REQUIRED action descriptor', async () => {
    mockedProbe = probeFixture(
      { queue: 'degraded', unknown: 'unknown-data', 'settlement-finality': 'down' },
      'down', // the health authority’s own worst-of rollup
    );
    const result = await readConsoleOperationsHealth();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.overall).toBe('down');
    expect(result.value.overallDisplayStatus).toBe('FAILED');
    expect(result.value.readiness).toBe('unhealthy');
    const byDomain = new Map(result.value.domains.map((domain) => [domain.domain, domain]));
    expect(byDomain.get('queue')).toEqual({
      domain: 'queue',
      state: 'degraded',
      displayStatus: 'ACTION_REQUIRED',
      action: { whatToInspect: 'inspect queue', drill: 'drill queue', runbookSection: 'runbook#queue' },
    });
    expect(byDomain.get('unknown')).toEqual({
      domain: 'unknown',
      state: 'unknown-data',
      displayStatus: 'UNKNOWN',
      action: {
        whatToInspect: 'inspect unknown',
        drill: 'drill unknown',
        runbookSection: 'runbook#unknown',
      },
    });
    expect(byDomain.get('settlement-finality')).toEqual({
      domain: 'settlement-finality',
      state: 'down',
      displayStatus: 'FAILED',
      action: {
        whatToInspect: 'inspect settlement-finality',
        drill: 'drill settlement-finality',
        runbookSection: 'runbook#settlement-finality',
      },
    });
    // An ok domain carries NO action field (the DEP-007 rule: non-ok only).
    expect('action' in (byDomain.get('command') ?? {})).toBe(false);
    expect(byDomain.get('command')?.displayStatus).toBe('SUCCEEDED');
  });

  test('the fail-closed probe (unknown-data + probeError) is STILL a VALUE — presentation UNKNOWN, never a guessed ok or down', async () => {
    // Every domain underivable — exactly what the real failClosed() path
    // produces when the store cannot be opened or the snapshot derived.
    const allUnknown: Record<string, HealthState> = {};
    for (const domain of OBSERVABILITY_DOMAINS) {
      allUnknown[domain] = 'unknown-data';
    }
    mockedProbe = probeFixture(
      allUnknown,
      'unknown-data',
      'the telemetry snapshot could not be derived (Error) — health is not derivable; this enrichment never guesses (F6)',
    );
    const result = await readConsoleOperationsHealth();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    // The health authority’s OWN unknown is a VALUE with UNKNOWN presentation —
    // it is NOT the envelope’s unavailable branch and NOT a business verdict.
    expect(result.status).toBe('UNKNOWN');
    expect(result.value.overall).toBe('unknown-data');
    expect(result.value.overallDisplayStatus).toBe('UNKNOWN');
    expect(result.value.readiness).toBe('health-unknown');
    expect(result.value.probeError).toContain('never guesses');
    for (const domain of result.value.domains) {
      expect(domain.state).toBe('unknown-data');
      expect(domain.displayStatus).toBe('UNKNOWN');
    }
  });
});

describe('PC-003 operations health read model — transport failures stay UNKNOWN', () => {
  test('a thrown probe call lands in the UNAVAILABLE branch — never a guessed ok, never down', async () => {
    const prior = mockedProbe;
    mockedProbe = undefined; // the mocked probeComponentHealth throws
    try {
      const result = await readConsoleOperationsHealth();
      expect(result.outcome).toBe('unavailable');
      if (result.outcome !== 'unavailable') return;
      expect(result.presentationStatus).toBe('UNKNOWN');
      expect(result.note).toContain('test fixture not set');
      expect(result.note).toContain('not a business outcome');
      expect('status' in result).toBe(false);
      expect('value' in result).toBe(false);
      expect(result.authority).toBe(consoleSourceMetadata('operations-health'));
    } finally {
      mockedProbe = prior ?? probeFixture({}, 'ok');
    }
  });
});

describe('PC-003 operations health read model — adapter thinness (delegation through the lazy accessor)', () => {
  test('the read delegates through loadOperationsHealthProbe() → the mocked readiness module’s probeComponentHealth', async () => {
    mockedProbe = probeFixture({ execution: 'degraded' }, 'degraded');
    const callsBefore = probeCalls;
    const loaded = await loadOperationsHealthProbe();
    expect(loaded()).toBe(mockedProbe); // the lazy accessor resolves the MOCKED module’s real seam
    const result = await readConsoleOperationsHealth();
    expect(result.outcome).toBe('value');
    expect(probeCalls).toBeGreaterThan(callsBefore); // the read called the probe
    if (result.outcome === 'value') {
      expect(result.value.overall).toBe('degraded');
      expect(result.status).toBe('ACTION_REQUIRED');
    }
  });
});
