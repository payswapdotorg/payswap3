/**
 * PC-001 — Environment context tests: the console environment is
 * server-derived ONLY. Client input (query params, headers, cookies beyond
 * the shell audience authority) cannot select production/test.
 *
 * Proofs:
 *   1. derivation follows the frozen PAYSWAP_ENV chain (sandbox fail-safe,
 *      production only when explicitly configured);
 *   2. the producing function accepts no input of any kind;
 *   3. the module's imports are allowlisted to the two frozen server
 *      authorities — no request-scoped module (headers/cookies/searchParams)
 *      is even reachable;
 *   4. startup configuration validation rides along fail-closed (names
 *      only, never values).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConsoleEnvironmentContext } from './environment-context';

const ENV_VARIABLE_NAME = 'PAYSWAP_ENV';

const MODULE_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'environment-context.ts');

function withPaySwapEnv(value: string | undefined, run: () => void): void {
  const prior = process.env[ENV_VARIABLE_NAME];
  if (value === undefined) {
    delete process.env[ENV_VARIABLE_NAME];
  } else {
    process.env[ENV_VARIABLE_NAME] = value;
  }
  try {
    run();
  } finally {
    if (prior === undefined) {
      delete process.env[ENV_VARIABLE_NAME];
    } else {
      process.env[ENV_VARIABLE_NAME] = prior;
    }
  }
}

describe('PC-001 environment context — server-derived only', () => {
  test('explicit production configuration resolves production', () => {
    withPaySwapEnv('production', () => {
      const context = getConsoleEnvironmentContext();
      expect(context.kind).toBe('production');
      expect(context.configuredValue).toBe('production');
      expect(context.derivedBy).toBe('server');
    });
  });

  test('explicit sandbox configuration resolves sandbox', () => {
    withPaySwapEnv('sandbox', () => {
      const context = getConsoleEnvironmentContext();
      expect(context.kind).toBe('sandbox');
      expect(context.configuredValue).toBe('sandbox');
    });
  });

  test('unset configuration fail-safes to sandbox (never production by accident)', () => {
    withPaySwapEnv(undefined, () => {
      const context = getConsoleEnvironmentContext();
      expect(context.kind).toBe('sandbox');
      expect(context.configuredValue).toBe('unset-or-invalid');
    });
  });

  test('spoofed/invalid values fail-safe to sandbox — exact allowlist', () => {
    for (const invalid of ['prod', 'PRODUCTION', 'production ', 'true', '1', 'test', 'staging']) {
      withPaySwapEnv(invalid, () => {
        const context = getConsoleEnvironmentContext();
        expect(context.kind).toBe('sandbox');
        expect(context.configuredValue).toBe('unset-or-invalid');
      });
    }
  });

  test('the producer accepts NO input — no client value can be passed at all', () => {
    // Type-level proof (compiles only with zero parameters):
    const producer: () => ReturnType<typeof getConsoleEnvironmentContext> =
      getConsoleEnvironmentContext;
    // Runtime proof: arity 0 — there is no parameter position for a query
    // param, header, cookie, or any client state.
    expect(producer.length).toBe(0);
    expect(typeof producer()).toBe('object');
  });

  test('client-supplied "environment selectors" in surrounding state do not participate', () => {
    // A client can control many things around a request (query params,
    // headers, unrelated cookies, POST bodies). None of them are inputs to
    // the derivation: setting every plausible spoof channel in the ambient
    // environment leaves the classification unchanged.
    withPaySwapEnv('sandbox', () => {
      process.env['NEXT_PUBLIC_PAYSWAP_ENV'] = 'production';
      process.env['PAYSWAP_ENV_CLIENT'] = 'production';
      process.env['VITE_PAYSWAP_ENV'] = 'production';
      try {
        const context = getConsoleEnvironmentContext();
        expect(context.kind).toBe('sandbox');
      } finally {
        delete process.env['NEXT_PUBLIC_PAYSWAP_ENV'];
        delete process.env['PAYSWAP_ENV_CLIENT'];
        delete process.env['VITE_PAYSWAP_ENV'];
      }
    });
  });

  test('the module imports ONLY the frozen server authorities (import allowlist)', () => {
    const source = readFileSync(MODULE_PATH, 'utf8');
    const importSpecifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(importSpecifiers).toEqual([
      '@/lib/environment',
      '@/lib/startup-config',
      './types',
    ]);
    // No request-scoped input is reachable from this module's CODE (comments
    // are stripped first so doc wording cannot false-positive or mask).
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of [
      'next/headers',
      'next/navigation',
      'searchParams',
      'cookies',
      'request',
      'window.',
      'document.',
      'useRouter',
      'useSearchParams',
    ]) {
      expect(codeOnly.includes(forbidden)).toBe(false);
    }
  });

  test('startup configuration rides along: names only, never values', () => {
    withPaySwapEnv('sandbox', () => {
      const context = getConsoleEnvironmentContext();
      expect(context.startupConfiguration.ok).toBe(true);
      expect(context.startupConfiguration.env).toBe('sandbox');
      // Sandbox requires nothing beyond environment selection (F4).
      expect(context.startupConfiguration.checks.length).toBe(1);
      expect(context.startupConfiguration.checks[0]?.id).toBe('environment');
    });
    withPaySwapEnv('production', () => {
      // Deterministic: the four required production names are absent here
      // (captured/restored), so validation must fail closed (F6).
      const requiredNames = [
        'PAYSWAP_DATABASE_URL',
        'PAYSWAP_QUEUE_URL',
        'PAYSWAP_EVIDENCE_STORE_URL',
        'PAYSWAP_RAIL_ADAPTERS_URL',
      ];
      const prior: Record<string, string | undefined> = {};
      for (const name of requiredNames) {
        prior[name] = process.env[name];
        delete process.env[name];
      }
      try {
        const context = getConsoleEnvironmentContext();
        expect(context.startupConfiguration.ok).toBe(false);
        const missing = context.startupConfiguration.checks.filter((check) => !check.ok);
        expect(missing.map((check) => check.id)).toEqual(requiredNames);
        // No check detail carries a secret VALUE — presence only.
        for (const check of context.startupConfiguration.checks) {
          expect(check.detail).not.toMatch(/postgres:\/\//i);
          expect(check.detail).not.toMatch(/https?:\/\//i);
        }
      } finally {
        for (const name of requiredNames) {
          if (prior[name] === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = prior[name];
          }
        }
      }
    });
  });

  test('the context reports the configuration source string, never raw values', () => {
    withPaySwapEnv('production', () => {
      const context = getConsoleEnvironmentContext();
      expect(context.source).toContain('PAYSWAP_ENV');
      expect(context.source).toContain('server-side');
    });
  });
});
