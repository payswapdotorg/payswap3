/**
 * PC-003 — Developer request-log read-scaffold tests: the RECORDED GAP
 * discipline (no request-log authority exists at this baseline — the read
 * answers the UNAVAILABLE branch with presentation UNKNOWN and fabricates
 * nothing), the gap recorded in the owning-authority metadata, and the pure
 * presentation normalizer PC-005 will ingest through: verbatim record fields
 * with the EXISTING fail-closed redaction primitive
 * (scrubCredentialReferences) applied to every payload FIRST — credentials,
 * authorization headers, and secret-bearing values never cross the boundary
 * unredacted (design §11).
 */

import { describe, expect, test } from 'bun:test';

import { scrubCredentialReferences } from '@/lib/observability/logging';
import type { LogRecord } from '@/lib/observability/logging';
import { consoleSourceMetadata } from '../authority/sources';
import { isConsoleStatus } from '../dto';
import {
  DEVELOPER_REQUESTS_GAP_NOTE,
  normalizeDeveloperRequestRecord,
  readConsoleDeveloperRequests,
} from './developer-requests';

// ── The scaffold read (the recorded gap) ───────────────────────────────────

describe('PC-003 developer requests read scaffold — the recorded owning-authority gap', () => {
  test('the read answers the UNAVAILABLE branch — presentation UNKNOWN, never a business verdict', async () => {
    const result = await readConsoleDeveloperRequests();
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(isConsoleStatus(result.presentationStatus)).toBe(true);
    // Structurally: the unavailable branch has NO business status, NO value.
    expect('status' in result).toBe(false);
    expect('value' in result).toBe(false);
    // The honest gap note, verbatim.
    expect(result.note).toBe(DEVELOPER_REQUESTS_GAP_NOTE);
    expect(result.note).toContain('PENDING-PC-005');
    expect(result.note).toContain('fabricat');
  });

  test('the gap is recorded in the owning-authority metadata (nothing invented)', () => {
    const authority = consoleSourceMetadata('developer-requests');
    expect(authority.owningAuthority).toContain('RECORDED GAP');
    expect(authority.owningAuthority).toContain('PENDING-PC-005');
    expect(authority.durableSource).toContain('none at this baseline');
    expect(authority.unknownSemantics).toContain('diagnostic UNKNOWN');
    // The read attaches EXACTLY that metadata (identity).
    return readConsoleDeveloperRequests().then((result) => {
      expect(result.outcome).toBe('unavailable');
      if (result.outcome === 'unavailable') {
        expect(result.authority).toBe(authority);
      }
    });
  });

  test('the read is deterministic and side-effect free (the same honest answer every time)', async () => {
    const first = await readConsoleDeveloperRequests();
    const second = await readConsoleDeveloperRequests();
    expect(second).toEqual(first);
  });
});

// ── The pure normalizer (PC-005's ingestion seam) ──────────────────────────

describe('PC-003 developer requests normalizer — verbatim fields, fail-closed redaction', () => {
  test('carries wallMs / level / event verbatim and the traceId when present', () => {
    const record: LogRecord = {
      wallMs: 1726444800123,
      level: 'info',
      event: 'console.api.request',
      data: { method: 'GET', path: '/api/console/payments' },
      traceId: 'trace-abc-123',
    };
    expect(normalizeDeveloperRequestRecord(record)).toEqual({
      wallMs: 1726444800123,
      level: 'info',
      event: 'console.api.request',
      data: { method: 'GET', path: '/api/console/payments' },
      traceId: 'trace-abc-123',
    });
  });

  test('omits the traceId field entirely when the record carried none', () => {
    const dto = normalizeDeveloperRequestRecord({
      wallMs: 1,
      level: 'warn',
      event: 'e',
      data: {},
    });
    expect('traceId' in dto).toBe(false);
  });

  test('credential-bearing FIELD NAMES are redacted (the name itself is sensitive)', () => {
    const dto = normalizeDeveloperRequestRecord({
      wallMs: 1,
      level: 'info',
      event: 'e',
      data: {
        api_key: 'anything-at-all',
        secret: 'anything-at-all',
        token: 'anything-at-all',
        password: 'anything-at-all',
        safe: 'kept',
      },
    });
    const data = dto.data as Record<string, unknown>;
    expect(data['api_key']).toBe('[REDACTED:sensitive-key]');
    expect(data['secret']).toBe('[REDACTED:sensitive-key]');
    expect(data['token']).toBe('[REDACTED:sensitive-key]');
    expect(data['password']).toBe('[REDACTED:sensitive-key]');
    expect(data['safe']).toBe('kept');
  });

  test('secret-shaped VALUES are redacted wherever they appear (nested objects, arrays, fields)', () => {
    const dto = normalizeDeveloperRequestRecord({
      wallMs: 1,
      level: 'error',
      event: 'e',
      data: {
        nested: { leak: 'ghp_' + 'a'.repeat(30) },
        authorization: 'Bearer abcdefghijklmnopqr',
        plain: 'ordinary text',
        list: ['sk-' + 'b'.repeat(25)],
      },
    });
    const data = dto.data as Record<string, unknown>;
    expect((data['nested'] as Record<string, unknown>)['leak']).toBe('[REDACTED:credential-reference]');
    // An authorization header is secret-SHAPED material: the value is
    // redacted by the existing primitive's Bearer pattern.
    expect(data['authorization']).toBe('[REDACTED:credential-reference]');
    expect(data['plain']).toBe('ordinary text');
    expect((data['list'] as readonly unknown[])[0]).toBe('[REDACTED:credential-reference]');
  });

  test('the DTO payload is ALWAYS the scrubbed form — the raw payload never crosses', () => {
    const raw = { password: 'super-secret-value' };
    const record: LogRecord = { wallMs: 1, level: 'debug', event: 'e', data: raw };
    const dto = normalizeDeveloperRequestRecord(record);
    expect(JSON.stringify(dto)).not.toContain('super-secret-value');
    expect((dto.data as Record<string, unknown>)['password']).toBe('[REDACTED:sensitive-key]');
    // The redaction is the EXISTING primitive, applied verbatim.
    expect(dto.data).toEqual(scrubCredentialReferences(raw));
  });

  test('the normalizer is pure (same input → same output; the input record is not mutated)', () => {
    const record: LogRecord = {
      wallMs: 42,
      level: 'info',
      event: 'e',
      data: { apiKey: 'x', note: 'n' },
      traceId: 't',
    };
    const first = normalizeDeveloperRequestRecord(record);
    const second = normalizeDeveloperRequestRecord(record);
    expect(second).toEqual(first);
    // The input record keeps its own (unredacted) payload — the DTO is a copy.
    expect(record.data).toEqual({ apiKey: 'x', note: 'n' });
  });
});
