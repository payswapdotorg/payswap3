/**
 * PC-005 — Developer read-model tests: the envelope composition over the
 * in-memory stores (and the PC-001 environment context).
 *
 * Proves:
 *   - every developer read resolves to the VALUE branch of the frozen
 *     PC-001 envelope with authority metadata attached (the in-memory
 *     ruling named honestly in the owningAuthority field);
 *   - an EMPTY store is the honest VALUE "no entries recorded yet" — the
 *     PC-003 recorded gap closes as an honest empty value, never a
 *     fabricated record and never an unavailable read;
 *   - every DTO carries the honest data-provenance note verbatim, and the
 *     log surfaces carry the diagnostic-not-evidence note;
 *   - the request-log read composes AROUND the PC-003 exported seam
 *     (normalizeDeveloperRequestRecord — the PC-003 DTO shape + redaction
 *     path) while widening it with the inspector fields;
 *   - the environment read composes the REAL PC-001 server-derived context
 *     (no request input; PAYSWAP_ENV drives it end-to-end).
 */

import { describe, expect, test } from 'bun:test';
import { resetDeveloperControlStoresForTesting } from './store-reset';
import {
  readConsoleDeveloperApiKeys,
  readConsoleDeveloperEnvironments,
  readConsoleDeveloperRequestInspector,
  readConsoleDeveloperRequestLogs,
  readConsoleDeveloperWebhooks,
} from './read-models';
import { getDeveloperApiKeyStore } from './api-key-store';
import { getDeveloperRequestLogStore } from './request-log-store';
import { getDeveloperWebhookStore } from './webhook-store';
import { IN_MEMORY_DEVELOPER_SURFACE_NOTE, DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE } from './developer-provenance';
import { CONSOLE_WEBHOOK_EVENT_CATALOG, WEBHOOK_DELIVERY_STATE_NOTE } from './webhook-events';
import { OBSERVABILITY_DOMAINS } from '@/lib/observability/taxonomy';

/** Reset the module-scoped singletons before every read (order-independence). */
function reset(): void {
  resetDeveloperControlStoresForTesting();
}

describe('PC-005 read models — the frozen envelope over the in-memory stores', () => {
  test('an EMPTY API-key store is the honest VALUE (no keys yet — the gap note, not UNKNOWN)', () => {
    reset();
    const result = readConsoleDeveloperApiKeys('merchant');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED');
    expect(result.value.keys).toEqual([]);
    expect(result.value.audit).toEqual([]);
    expect(result.value.provenance).toBe(IN_MEMORY_DEVELOPER_SURFACE_NOTE);
    // The owning authority is named honestly as NON-DURABLE.
    expect(result.authority.owningAuthority).toContain('in-memory');
    expect(result.authority.owningAuthority).toContain('NON-DURABLE');
    expect(result.authority.durableSource).toContain('none');
  });

  test('a created key appears in the read (secret-free), scoped to the derived environment', () => {
    reset();
    const created = getDeveloperApiKeyStore().create(
      { label: 'read-model-key' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    const result = readConsoleDeveloperApiKeys('merchant');
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.keys.length).toBe(1);
    expect(result.value.keys[0]?.label).toBe('read-model-key');
    expect(JSON.stringify(result.value).includes(created.created.secret)).toBe(false);
    expect(result.value.audit.map((entry) => entry.action)).toEqual(['api-key.created']);
  });

  test('the webhooks read carries the real event catalog and the honest delivery state', () => {
    reset();
    const result = readConsoleDeveloperWebhooks('merchant');
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.endpoints).toEqual([]);
    expect(result.value.eventCatalog).toBe(CONSOLE_WEBHOOK_EVENT_CATALOG);
    expect(result.value.eventCatalog.map((entry) => entry.identifier)).toEqual([
      ...OBSERVABILITY_DOMAINS,
      'job_enqueued',
      'job_reserved',
      'job_succeeded',
      'job_attempt_failed',
      'job_dead_lettered',
      'job_lease_expired',
      'job_enqueue_deduped',
    ]);
    expect(result.value.deliveryStateNote).toBe(WEBHOOK_DELIVERY_STATE_NOTE);
    expect(result.value.provenance).toBe(IN_MEMORY_DEVELOPER_SURFACE_NOTE);
  });

  test('a webhook endpoint appears secret-free with its audit entry', () => {
    reset();
    const created = getDeveloperWebhookStore().create(
      { url: 'https://example.com/hooks' },
      { role: 'merchant', environment: 'sandbox' },
    );
    if (!created.ok) throw new Error('expected creation to succeed');
    const result = readConsoleDeveloperWebhooks('merchant');
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.endpoints.length).toBe(1);
    expect(JSON.stringify(result.value).includes(created.created.signingSecret)).toBe(false);
    expect(result.value.audit.map((entry) => entry.action)).toEqual(['webhook-endpoint.created']);
  });
});

describe('PC-005 request-log reads — PC-003 seam composition + honest empty value', () => {
  test('an EMPTY ring is the honest VALUE "no entries recorded yet"', () => {
    reset();
    const result = readConsoleDeveloperRequestLogs();
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.entries).toEqual([]);
    expect(result.value.recorded).toBe(0);
    expect(result.value.capacity).toBe(200);
    expect(result.value.provenance).toBe(IN_MEMORY_DEVELOPER_SURFACE_NOTE);
    expect(result.value.diagnosticNote).toBe(DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE);
    expect(result.value.redaction).toContain('scrubCredentialReferences');
    // The authority metadata names the PC-003 seam composition explicitly.
    expect(result.authority.runtimeBoundary).toContain('normalizeDeveloperRequestRecord');
  });

  test('ingested entries surface through the PC-003 normalizer shape, widened with inspector fields', () => {
    reset();
    const store = getDeveloperRequestLogStore();
    store.ingest({
      method: 'POST',
      path: '/api/console/developers/api-keys',
      status: 200,
      event: 'console.developers.api-key.created',
      data: { label: 'k', authorization: 'Bearer abcdefghijklmnopqr' },
      traceId: 'trace_1',
    });
    const result = readConsoleDeveloperRequestLogs();
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.recorded).toBe(1);
    const entry = result.value.entries[0];
    if (!entry) throw new Error('expected an entry');
    // The PC-003 DTO fields (through normalizeDeveloperRequestRecord):
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('console.developers.api-key.created');
    expect(entry.traceId).toBe('trace_1');
    // ...already redacted at ingestion:
    const data = entry.data as Record<string, unknown>;
    expect(data.authorization).toBe('[REDACTED:credential-reference]');
    // ...plus the PC-005 inspector fields:
    expect(entry.method).toBe('POST');
    expect(entry.path).toBe('/api/console/developers/api-keys');
    expect(entry.status).toBe(200);
    expect(entry.id).toBe(1);
  });

  test('the inspector read filters server-side and echoes the active filter', () => {
    reset();
    const store = getDeveloperRequestLogStore();
    store.ingest({ method: 'GET', path: '/a', status: 200, event: 'e1' });
    store.ingest({ method: 'GET', path: '/b', status: 404, event: 'e2' });
    const result = readConsoleDeveloperRequestInspector({ status: 404 });
    if (result.outcome !== 'value') throw new Error('expected value branch');
    expect(result.value.entries.map((entry) => entry.event)).toEqual(['e2']);
    expect(result.value.filter).toEqual({ status: 404 });
    expect(result.value.diagnosticNote).toBe(DEVELOPER_DIAGNOSTIC_NOT_EVIDENCE_NOTE);
    // An empty filtered result is an honest VALUE (nothing matches).
    const none = readConsoleDeveloperRequestInspector({ path: '/zzz' });
    if (none.outcome !== 'value') throw new Error('expected value branch');
    expect(none.value.entries).toEqual([]);
    expect(none.value.filter).toEqual({ path: '/zzz' });
  });
});

describe('PC-005 environment read — the REAL server-derived context, no input', () => {
  test('the read composes the PC-001 context with the derivation chain and the no-switching note', () => {
    reset();
    const saved = process.env.PAYSWAP_ENV;
    try {
      delete process.env.PAYSWAP_ENV;
      const result = readConsoleDeveloperEnvironments();
      if (result.outcome !== 'value') throw new Error('expected value branch');
      // Fail-safe sandbox: unset configuration NEVER presents as production.
      expect(result.value.context.kind).toBe('sandbox');
      expect(result.value.context.derivedBy).toBe('server');
      expect(result.value.derivationChain.length).toBe(4);
      expect(result.value.derivationChain[0]).toContain('PAYSWAP_ENV');
      expect(result.value.noSwitchingNote).toContain('no control');
      expect(result.value.noSwitchingNote).toContain('never participate');
    } finally {
      if (saved === undefined) {
        delete process.env.PAYSWAP_ENV;
      } else {
        process.env.PAYSWAP_ENV = saved;
      }
    }
  });

  test('explicit production configuration surfaces through the SAME chain', () => {
    reset();
    const saved = process.env.PAYSWAP_ENV;
    try {
      process.env.PAYSWAP_ENV = 'production';
      const result = readConsoleDeveloperEnvironments();
      if (result.outcome !== 'value') throw new Error('expected value branch');
      expect(result.value.context.kind).toBe('production');
      expect(result.value.context.configuredValue).toBe('production');
    } finally {
      if (saved === undefined) {
        delete process.env.PAYSWAP_ENV;
      } else {
        process.env.PAYSWAP_ENV = saved;
      }
    }
  });
});
