/**
 * PC-003 — Console API read-response envelope tests: the shared body shape
 * every console API read responds with, and the server-derived environment
 * attachment (the no-input derivation chain — nothing from any request
 * participates).
 */

import { describe, expect, test } from 'bun:test';

import { consoleApiDeniedBody, consoleApiReadResponseBody } from './api-envelope';
import { getConsoleEnvironmentContext } from '../environment-context';
import { consoleValue } from '../dto';
import type { ConsoleAuthorityMetadata } from '../types';
import { CONSOLE_SOURCE_REGISTRY, consoleSourceMetadata } from './sources';

const PRIOR_ENV = process.env['PAYSWAP_ENV'];

const TEST_AUTHORITY: ConsoleAuthorityMetadata = consoleSourceMetadata('payments');

describe('PC-003 api-envelope — the denial body', () => {
  test('denial is the bare marker with NO other content', () => {
    expect(consoleApiDeniedBody()).toEqual({ ok: false });
    expect(Object.keys(consoleApiDeniedBody())).toEqual(['ok']);
  });
});

describe('PC-003 api-envelope — the success body', () => {
  test('carries principal + server-derived environment + the untouched read result', () => {
    const result = consoleValue({ payments: [] }, 'SUCCEEDED', TEST_AUTHORITY);
    const body = consoleApiReadResponseBody('operator', result);
    expect(body.ok).toBe(true);
    expect(body.principal).toEqual({ role: 'operator' });
    // The read result envelope passes through EXACTLY (identity — no
    // re-wrapping, no status translation at the response boundary).
    expect(body.result).toBe(result);
    // The environment is the PC-001 server-derived context.
    expect(body.environment).toEqual(getConsoleEnvironmentContext());
    expect(body.environment.derivedBy).toBe('server');
  });

  test('the environment follows the frozen PAYSWAP_ENV chain (fail-safe sandbox)', () => {
    const result = consoleValue({ payments: [] }, 'SUCCEEDED', TEST_AUTHORITY);
    try {
      delete process.env['PAYSWAP_ENV'];
      expect(consoleApiReadResponseBody('customer', result).environment.kind).toBe('sandbox');

      process.env['PAYSWAP_ENV'] = 'production';
      expect(consoleApiReadResponseBody('customer', result).environment.kind).toBe('production');

      process.env['PAYSWAP_ENV'] = 'prod'; // not on the allowlist
      expect(consoleApiReadResponseBody('customer', result).environment.kind).toBe('sandbox');
    } finally {
      if (PRIOR_ENV === undefined) {
        delete process.env['PAYSWAP_ENV'];
      } else {
        process.env['PAYSWAP_ENV'] = PRIOR_ENV;
      }
    }
  });

  test('the response builder accepts NO request input (structural environment isolation)', () => {
    // Type-level proof at test time: the builder's parameters are (role,
    // result) — there is no parameter through which a query string, header,
    // cookie, or body value could reach the environment derivation.
    expect(consoleApiReadResponseBody.length).toBe(2);
    expect(getConsoleEnvironmentContext.length).toBe(0);
  });
});

describe('PC-003 api-envelope — every read model can produce a response body', () => {
  test('the registry metadata is attachable for every read model (no gaps in the envelope contract)', () => {
    for (const entry of CONSOLE_SOURCE_REGISTRY) {
      const body = consoleApiReadResponseBody(
        'operator',
        consoleValue({ for: entry.readModel }, 'SUCCEEDED', entry.metadata),
      );
      expect(body.result.outcome).toBe('value');
      if (body.result.outcome === 'value') {
        expect(body.result.authority).toBe(entry.metadata);
      }
    }
  });
});
