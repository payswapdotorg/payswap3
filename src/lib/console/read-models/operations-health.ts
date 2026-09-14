/**
 * PC-003 — Operations health read model.
 *
 * Thin server-side composition over the EXISTING operational health read —
 * the SAME composition point the /api/ready boundary enriches through (the
 * DEP-007 additive componentHealth field):
 *   - probeComponentHealth() (src/lib/observability/readiness.ts) — the
 *     fail-closed nine-domain component health probe over the durable store
 *     the application hosts (deriveComponentHealth over
 *     collectTelemetrySnapshot; observation-only, never financial evidence).
 *
 * The domain vocabulary and per-domain states are carried VERBATIM from the
 * observability taxonomy (OBSERVABILITY_DOMAINS /
 * DOMAIN_DEFINITIONS — src/lib/observability/taxonomy.ts): ok | degraded |
 * unknown-data | down. The console's only contribution is the documented,
 * deterministic projection of the health authority's OWN states onto the
 * six-status vocabulary (nothing is recomputed, aggregated beyond the
 * authority's own worst-of rollup, or invented):
 *
 *   ok          → SUCCEEDED      (the health authority's definitive good verdict)
 *   degraded    → ACTION_REQUIRED (every non-ok health state carries a REQUIRED
 *                                  action descriptor — the DEP-007 model's own rule)
 *   unknown-data→ UNKNOWN        (the health authority's own unknown — data cannot
 *                                  be derived; fail-closed, never a guessed ok)
 *   down        → FAILED         (the health authority's definitive down verdict)
 *
 * UNKNOWN discipline: the probe itself is fail-closed (an unopenable store or
 * underivable snapshot RETURNS unknown-data — the authority's answer — as a
 * VALUE with UNKNOWN presentation), so the read's UNAVAILABLE branch exists
 * only for a transport failure of the probe call itself (it should never
 * throw; if it ever does, the read stays UNKNOWN — never ok, never down).
 *
 * Role scoping: the composite operations-health read serves the six frozen
 * operations modules (queues / execution / reconciliation / unknown /
 * clearing-netting / incidents — all operator-only in the frozen registry);
 * the API route guards it with the registry-derived intersection (see
 * src/lib/console/authority/route-access.ts).
 */

import { consoleSourceMetadata, loadOperationsHealthProbe } from '../authority/sources';
import type { ComponentHealthProbe } from '@/lib/observability/readiness';
import type { HealthState } from '@/lib/observability/health';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';
import { consoleTransportFailure, consoleValue } from '../dto';
import type { ConsoleReadResult, ConsoleStatus } from '../types';

// ── DTOs ───────────────────────────────────────────────────────────────────

/** One observability domain's health, exactly as the health authority reports it. */
export interface ConsoleOperationsHealthDomainDto {
  /** The frozen observability domain id (taxonomy vocabulary). */
  readonly domain: string;
  /** The health authority's own state, verbatim (ok | degraded | unknown-data | down). */
  readonly state: HealthState;
  /** The documented projection of the health state onto the six statuses. */
  readonly displayStatus: ConsoleStatus;
  /** Present iff state !== 'ok' — the REQUIRED action descriptor (the DEP-007 rule). */
  readonly action?: {
    readonly whatToInspect: string;
    readonly drill: string;
    readonly runbookSection: string;
  };
}

/** The operations-health read value (the health authority's own composite answer). */
export interface ConsoleOperationsHealthDto {
  /** The worst-of rollup across all nine domains, verbatim from the authority. */
  readonly overall: HealthState;
  /** The documented projection of the overall health onto the six statuses. */
  readonly overallDisplayStatus: ConsoleStatus;
  /** The readiness projection the health model derives (ready | health-unknown | unhealthy). */
  readonly readiness: 'ready' | 'health-unknown' | 'unhealthy';
  /** The probe's own generatedAt (epoch ms). */
  readonly generatedAt: number;
  readonly domains: readonly ConsoleOperationsHealthDomainDto[];
  /** Present iff the probe could not derive health (fail-closed named error). */
  readonly probeError?: string;
}

// ── The documented health → console status projection ─────────────────────

/**
 * The deterministic projection of the health authority's states onto the
 * six-status vocabulary (see the module header for the rationale; the
 * exhaustiveness is machine-checked in operations-health.test.ts).
 */
export const OPERATIONS_HEALTH_STATUS: Readonly<Record<HealthState, ConsoleStatus>> = {
  ok: 'SUCCEEDED',
  degraded: 'ACTION_REQUIRED',
  'unknown-data': 'UNKNOWN',
  down: 'FAILED',
};

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Read the composite operations health. The probe's fail-closed answers
 * (including unknown-data with a probeError) are VALUES — the health
 * authority's own verdicts; only a thrown probe call lands in the
 * UNAVAILABLE (UNKNOWN) branch.
 */
export async function readConsoleOperationsHealth(): Promise<ConsoleReadResult<ConsoleOperationsHealthDto>> {
  const authority = consoleSourceMetadata('operations-health');
  // The readiness probe is loaded ON DEMAND through the registry's lazy
  // accessor — its module graph binds the server-only durable substrate,
  // so console code never pulls it in statically (browser/test contexts
  // stay free of it; the route runs server-side where it loads fine).
  const probeComponentHealth = await loadOperationsHealthProbe();
  let probe: ComponentHealthProbe;
  try {
    probe = probeComponentHealth();
  } catch (error) {
    // Should be unreachable (the probe is fail-closed internally) — but a
    // transport failure here stays UNKNOWN: never a guessed ok, never down.
    const detail = error instanceof Error ? error.message : String(error);
    return consoleTransportFailure(
      authority,
      `The operations health probe could not be evaluated (${detail}).`,
    );
  }

  // The domains in the frozen taxonomy order (the probe's record is keyed by
  // domain; ordering here is presentation-only and derives from the frozen
  // vocabulary module).
  const domains: ConsoleOperationsHealthDomainDto[] = OBSERVABILITY_DOMAINS.map((domain) => {
    const projection = probe.domains[domain];
    return {
      domain,
      state: projection.state,
      displayStatus: OPERATIONS_HEALTH_STATUS[projection.state],
      ...(projection.action === undefined
        ? {}
        : {
            action: {
              whatToInspect: projection.action.whatToInspect,
              drill: projection.action.drill,
              runbookSection: projection.action.runbookSection,
            },
          }),
    };
  });

  return consoleValue(
    {
      overall: probe.overall,
      overallDisplayStatus: OPERATIONS_HEALTH_STATUS[probe.overall],
      readiness: probe.readiness,
      generatedAt: probe.generatedAt,
      domains,
      ...(probe.probeError === undefined ? {} : { probeError: probe.probeError }),
    },
    OPERATIONS_HEALTH_STATUS[probe.overall],
    authority,
  );
}
