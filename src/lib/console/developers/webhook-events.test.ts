/**
 * PC-005 — Webhook event catalog tests: the identifiers are REAL.
 *
 * Design §11: "delivery attempts and outcomes reference authoritative event
 * identifiers". This suite proves every catalog entry is defined by a real
 * repository vocabulary — none is invented:
 *
 *   - every observability-domain entry is a member of the frozen closed
 *     union OBSERVABILITY_DOMAINS and quotes DOMAIN_DEFINITIONS verbatim
 *     (identity-checked against the REAL imported symbols);
 *   - every substrate job-lifecycle identifier appears in the REAL durable
 *     substrate event module source text (read from disk — the console
 *     governance boundary forbids importing that module from console code,
 *     so the check reads the source instead; the identifiers are the
 *     substrate's own vocabulary, verified not trusted).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAIN_DEFINITIONS, OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';
import {
  CONSOLE_WEBHOOK_EVENT_CATALOG,
  SUBSTRATE_JOB_LIFECYCLE_EVENT_TYPES,
  WEBHOOK_DELIVERY_STATE_NOTE,
} from './webhook-events';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

describe('PC-005 webhook event catalog — every identifier is defined by a real vocabulary', () => {
  test('the nine observability domains are present, verbatim from the frozen taxonomy', () => {
    const domainEntries = CONSOLE_WEBHOOK_EVENT_CATALOG.filter(
      (entry) => entry.source === 'observability-taxonomy',
    );
    expect(domainEntries.map((entry) => entry.identifier)).toEqual([...OBSERVABILITY_DOMAINS]);
    for (const entry of domainEntries) {
      // The definition quotes the taxonomy's own definition verbatim.
      const domain = entry.identifier as keyof typeof DOMAIN_DEFINITIONS;
      expect(entry.definition).toBe(DOMAIN_DEFINITIONS[domain].definition);
      expect(entry.sourceModule).toContain('src/lib/observability/taxonomy.ts');
    }
  });

  test('every substrate job-lifecycle identifier appears in the REAL substrate event module source', () => {
    const substrateSource = readFileSync(
      join(REPO_ROOT, 'src', 'lib', 'durable', 'events.ts'),
      'utf8',
    );
    const substrateEntries = CONSOLE_WEBHOOK_EVENT_CATALOG.filter(
      (entry) => entry.source === 'durable-substrate-job-lifecycle',
    );
    expect(substrateEntries.map((entry) => entry.identifier)).toEqual([
      ...SUBSTRATE_JOB_LIFECYCLE_EVENT_TYPES,
    ]);
    for (const entry of substrateEntries) {
      // The identifier is REAL: the substrate module's own documentation
      // vocabulary names it (job lifecycle events under its owner constant).
      expect(substrateSource.includes(entry.identifier)).toBe(true);
    }
  });

  test('the catalog is exactly the two real vocabularies — sixteen entries, no inventions', () => {
    expect(CONSOLE_WEBHOOK_EVENT_CATALOG.length).toBe(9 + SUBSTRATE_JOB_LIFECYCLE_EVENT_TYPES.length);
    expect(new Set(CONSOLE_WEBHOOK_EVENT_CATALOG.map((entry) => entry.identifier)).size).toBe(
      CONSOLE_WEBHOOK_EVENT_CATALOG.length,
    );
  });

  test('the honest delivery-state note states the §11 rule (no worker, no replay implication)', () => {
    expect(WEBHOOK_DELIVERY_STATE_NOTE).toContain('No delivery worker exists at this baseline');
    expect(WEBHOOK_DELIVERY_STATE_NOTE).toContain('retries are not implemented');
    expect(WEBHOOK_DELIVERY_STATE_NOTE).toContain('never imply protocol replay');
    expect(WEBHOOK_DELIVERY_STATE_NOTE).toContain('no delivery is simulated here');
  });
});
