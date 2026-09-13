// src/lib/observability/readiness.ts — the ADDITIVE readiness enrichment
// for src/app/api/ready/route.ts (DEP-007).
//
// ONE duty: derive the nine-domain component health over the durable store
// the web-api-boundary application hosts (the in-process DEP-003 substrate
// form — RTN-012 precedent), for the /api/ready route's additive
// `componentHealth` field.
//
// STRICTLY ADDITIVE: the route's existing contract is untouched —
//   - the F6 configuration checks (startup-config.ts) stay THE authority on
//     readiness; this enrichment never flips a status code;
//   - src/app/api/health/route.ts (liveness — the F6 liveness/readiness
//     separation) is untouched;
//   - the existing response fields and codes are byte-identical; the route
//     only GAINS a field.
//
// FAIL-CLOSED: when the durable store cannot be opened or the snapshot
// cannot be derived, the probe reports `unknown-data` with the named error
// — never a guessed 'ok' (and never a thrown error that would break the
// route's existing behavior).
//
// The database is opened LAZILY (first probe) and cached for the process
// lifetime (openDurableDatabase applies the migration no-op + pragmas once;
// repeated probes are pure queries). Server-side only: this module is
// imported exclusively by the ready route, never by a client component.

import { openDurableDatabase } from '../durable/db.ts';
import type { DurableDatabase } from '../durable/db.ts';
import { collectTelemetrySnapshot } from './telemetry.ts';
import type { TelemetryOptions } from './telemetry.ts';
import { deriveComponentHealth, readinessProjection } from './health.ts';
import type { ComponentHealth, HealthState } from './health.ts';
import { DOMAIN_DEFINITIONS } from './taxonomy.ts';
import type { ObservabilityDomain } from './taxonomy.ts';

/** The lazily-opened, process-lifetime durable handle for probing. */
let probeDatabase: DurableDatabase | null = null;

/** Open (once) or return the cached probe database at the configured path. */
export function getReadinessProbeDatabase(): DurableDatabase {
  if (probeDatabase !== null && probeDatabase.isOpen()) {
    return probeDatabase;
  }
  probeDatabase = openDurableDatabase();
  return probeDatabase;
}

/** The compact per-domain projection the route reports (value-free). */
export interface ComponentHealthDomainProjection {
  readonly state: HealthState;
  /** Present iff state !== 'ok' (the required action descriptor). */
  readonly action?: {
    readonly whatToInspect: string;
    readonly drill: string;
    readonly runbookSection: string;
  };
}

/** The additive readiness enrichment payload. */
export interface ComponentHealthProbe {
  readonly overall: HealthState;
  readonly readiness: 'ready' | 'health-unknown' | 'unhealthy';
  readonly generatedAt: number;
  readonly domains: Readonly<Record<ObservabilityDomain, ComponentHealthDomainProjection>>;
  /** Present when the probe could not derive health (fail-closed). */
  readonly probeError?: string;
}

function project(health: ComponentHealth): ComponentHealthProbe {
  const domains = {} as Record<ObservabilityDomain, ComponentHealthDomainProjection>;
  for (const [domain, domainHealth] of Object.entries(health.domains) as Array<
    [ObservabilityDomain, ComponentHealth['domains'][ObservabilityDomain]]
  >) {
    domains[domain] =
      domainHealth.action === undefined
        ? { state: domainHealth.state }
        : { state: domainHealth.state, action: domainHealth.action };
  }
  return {
    overall: health.overall,
    readiness: readinessProjection(health),
    generatedAt: health.generatedAt,
    domains: Object.freeze(domains),
  };
}

/**
 * Probe the component health for the readiness enrichment. FAIL-CLOSED:
 * an unopenable store or a failed derivation reports `unknown-data` with
 * the named error — never a guess, never a thrown error.
 */
export function probeComponentHealth(
  options: { readonly database?: DurableDatabase; readonly telemetry?: TelemetryOptions } = {},
): ComponentHealthProbe {
  let database: DurableDatabase;
  try {
    database = options.database ?? getReadinessProbeDatabase();
  } catch (error) {
    return failClosed(error, 'durable store could not be opened for the health probe');
  }
  try {
    const snapshot = collectTelemetrySnapshot(database, options.telemetry);
    return project(deriveComponentHealth(snapshot));
  } catch (error) {
    return failClosed(error, 'the telemetry snapshot could not be derived');
  }
}

function failClosed(error: unknown, reason: string): ComponentHealthProbe {
  const name = error instanceof Error ? error.name : 'Error';
  const domains = {} as Record<ObservabilityDomain, ComponentHealthDomainProjection>;
  for (const domain of Object.keys(DOMAIN_DEFINITIONS) as ObservabilityDomain[]) {
    domains[domain] = { state: 'unknown-data' };
  }
  return {
    overall: 'unknown-data',
    readiness: 'health-unknown',
    generatedAt: Date.now(),
    domains: Object.freeze(domains),
    probeError: `${reason} (${name}) — health is not derivable; this enrichment never guesses (F6)`,
  };
}
