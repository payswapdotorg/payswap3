/**
 * PC-005 — The webhook event catalog: the identifiers a webhook delivery
 * would reference, taken ONLY from vocabularies the repository actually
 * defines (design §11: "delivery attempts and outcomes reference
 * authoritative event identifiers").
 *
 * Two REAL vocabularies exist at this baseline, and the catalog lists
 * exactly what they define — nothing invented:
 *
 *   1. The nine closed observability domains — imported directly from the
 *      frozen taxonomy (OBSERVABILITY_DOMAINS / DOMAIN_DEFINITIONS,
 *      src/lib/observability/taxonomy.ts). The import is the REAL symbol,
 *      so the catalog cannot drift from the taxonomy.
 *   2. The durable substrate's job-lifecycle event types — the vocabulary
 *      defined by the substrate event module (src/lib/durable/events.ts:
 *      job_enqueued, job_reserved, job_succeeded, job_attempt_failed,
 *      job_dead_lettered, job_lease_expired, job_enqueue_deduped, recorded
 *      under SUBSTRATE_EVENT_OWNER). The console governance boundary
 *      forbids importing that module from console code, so the catalog
 *      records the identifiers as documented strings and a TEST verifies
 *      each one against the real source file text — the identifiers are
 *      proven real without crossing the import boundary.
 *
 * HONEST DELIVERY STATE (design §11): NO delivery worker exists at this
 * baseline — delivery attempts are not recorded, and retries are not
 * implemented. A retry must never imply protocol replay or duplicate
 * financial effects. The webhooks view states this; the catalog describes
 * what a delivery WOULD reference, never a simulated delivery.
 */

import { DOMAIN_DEFINITIONS, OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';
import type { ObservabilityDomain } from '@/lib/observability/taxonomy';

/** The source vocabulary a catalog entry comes from. */
export type WebhookEventSource =
  | 'observability-taxonomy'
  | 'durable-substrate-job-lifecycle';

/** One referenceable event identifier (as the owning vocabulary defines it). */
export interface WebhookEventCatalogEntry {
  /** The identifier itself, verbatim from the owning vocabulary. */
  readonly identifier: string;
  /** Which real vocabulary defines it. */
  readonly source: WebhookEventSource;
  /** What the identifier means (the taxonomy's own definition, verbatim for domains). */
  readonly definition: string;
  /** The module that owns the vocabulary (rendered as attribution). */
  readonly sourceModule: string;
}

/**
 * The substrate job-lifecycle event types, verbatim from the durable
 * substrate event vocabulary (src/lib/durable/events.ts — the substrate's
 * own lifecycle events recorded under SUBSTRATE_EVENT_OWNER). Verified
 * against the real source text by webhook-events.test.ts.
 */
export const SUBSTRATE_JOB_LIFECYCLE_EVENT_TYPES: readonly string[] = Object.freeze([
  'job_enqueued',
  'job_reserved',
  'job_succeeded',
  'job_attempt_failed',
  'job_dead_lettered',
  'job_lease_expired',
  'job_enqueue_deduped',
]);

/** Descriptions of the substrate lifecycle types (documentation form). */
const SUBSTRATE_JOB_LIFECYCLE_DEFINITIONS: Readonly<Record<string, string>> = Object.freeze({
  job_enqueued: 'A durable job was enqueued onto the substrate command path.',
  job_reserved: 'A worker reserved the job for execution (lease taken).',
  job_succeeded: 'The reserved job completed successfully.',
  job_attempt_failed: 'One execution attempt failed; the job remains retryable per substrate policy.',
  job_dead_lettered: 'The job exhausted its attempts and moved to the dead-letter state.',
  job_lease_expired: "The execution lease expired before completion (a 'zombie' reservation).",
  job_enqueue_deduped: 'A duplicate enqueue was deduplicated by the substrate.',
});

const SUBSTRATE_EVENT_SOURCE_MODULE =
  'durable substrate event vocabulary (src/lib/durable/events.ts — substrate lifecycle events under owner durable-substrate)';
const TAXONOMY_SOURCE_MODULE =
  'observability taxonomy (src/lib/observability/taxonomy.ts — the closed nine-domain union)';

function substrateEntry(identifier: string): WebhookEventCatalogEntry {
  return {
    identifier,
    source: 'durable-substrate-job-lifecycle',
    definition:
      SUBSTRATE_JOB_LIFECYCLE_DEFINITIONS[identifier] ??
      'Durable substrate job-lifecycle event (see the substrate event vocabulary).',
    sourceModule: SUBSTRATE_EVENT_SOURCE_MODULE,
  };
}

function domainEntry(domain: ObservabilityDomain): WebhookEventCatalogEntry {
  return {
    identifier: domain,
    source: 'observability-taxonomy',
    // The taxonomy's own definition, verbatim — never re-worded here.
    definition: DOMAIN_DEFINITIONS[domain].definition,
    sourceModule: TAXONOMY_SOURCE_MODULE,
  };
}

/**
 * The catalog: nine observability domains + seven substrate job-lifecycle
 * event types. Built FROM the real taxonomy import, so the domain half is
 * mechanically the frozen union (a tenth domain would appear here only by
 * a governed change to the taxonomy itself).
 */
export const CONSOLE_WEBHOOK_EVENT_CATALOG: readonly WebhookEventCatalogEntry[] = Object.freeze([
  ...OBSERVABILITY_DOMAINS.map(domainEntry),
  ...SUBSTRATE_JOB_LIFECYCLE_EVENT_TYPES.map(substrateEntry),
]);

/**
 * The honest delivery state note rendered wherever delivery records would
 * appear (stated, never simulated).
 */
export const WEBHOOK_DELIVERY_STATE_NOTE =
  'No delivery worker exists at this baseline: delivery attempts are not recorded and retries are not implemented — a webhook retry must never imply protocol replay or duplicate financial effects (design §11). The event catalog above lists the identifiers a delivery WOULD reference; no delivery is simulated here.';
