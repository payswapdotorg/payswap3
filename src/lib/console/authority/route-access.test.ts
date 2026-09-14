/**
 * PC-003 — Console API read-access tests: the module guard and the
 * registry-derived operations composite authorization. The request-context
 * chain is driven by mocking 'next/headers' ONLY — the real audience
 * authority and the real PC-001 policy run unmodified.
 */

import { describe, expect, mock, test } from 'bun:test';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

import {
  authorizeConsoleApiRead,
  authorizeConsoleOperationsRead,
  consoleOperationsModuleIds,
  operationsCompositeAccessRoles,
} from './route-access';
import { CONSOLE_REGISTRY } from '../registry';

describe('PC-003 route access — the registry-derived operations composite', () => {
  test('the six frozen operations modules are derived from the registry (not duplicated)', () => {
    const expected = CONSOLE_REGISTRY.filter((entry) => entry.group === 'operations').map((entry) => entry.id);
    expect(consoleOperationsModuleIds()).toEqual(expected);
    expect(expected.length).toBe(6);
  });

  test('the composite access role set is the INTERSECTION over the six operations modules', () => {
    const derived = operationsCompositeAccessRoles();
    const expected = CONSOLE_REGISTRY.filter((entry) => entry.group === 'operations')
      .map((entry) => entry.allowedRoles)
      .reduce((intersection, allowed) => intersection.filter((role) => allowed.includes(role)), [
        'customer',
        'merchant',
        'provider',
        'operator',
        'administrator',
      ] as const);
    expect([...derived].sort()).toEqual([...expected].sort());
    // Mechanically derived, currently operator-only (the frozen registry's grant).
    expect(derived).toEqual(['operator']);
  });
});

describe('PC-003 route access — module guard (fail-closed)', () => {
  test('unauthenticated → denied for every console read module', async () => {
    mockedAudienceCookie = undefined;
    for (const moduleId of [
      'console.payments.all',
      'console.payments.detail',
      'console.checkout.sessions',
      'console.capabilities',
      'console.developers.logs',
    ]) {
      const access = await authorizeConsoleApiRead(moduleId);
      expect(access.allowed).toBe(false);
      if (!access.allowed) {
        expect(access.reason).toBe('unauthenticated');
      }
    }
    const operations = await authorizeConsoleOperationsRead();
    expect(operations.allowed).toBe(false);
  });

  test('an invalid/spoofed audience value is denied (never a guessed role)', async () => {
    mockedAudienceCookie = 'superuser';
    const access = await authorizeConsoleApiRead('console.payments.all');
    expect(access.allowed).toBe(false);
  });

  test('an unknown module id fails closed (unknown-module)', async () => {
    mockedAudienceCookie = 'operator';
    const access = await authorizeConsoleApiRead('console.not-a-module');
    expect(access.allowed).toBe(false);
    if (!access.allowed) {
      expect(access.reason).toBe('unknown-module');
    }
  });

  test('the per-module role grants are exactly the frozen registry grants', async () => {
    const cases: readonly [string, readonly string[]][] = [
      ['console.payments.all', ['customer', 'merchant', 'operator']],
      ['console.payments.detail', ['customer', 'merchant', 'operator']],
      ['console.checkout.sessions', ['merchant']],
      ['console.capabilities', ['provider']],
      ['console.developers.logs', ['merchant']],
    ];
    for (const [moduleId, allowedRoles] of cases) {
      for (const role of ['customer', 'merchant', 'provider', 'operator', 'administrator'] as const) {
        mockedAudienceCookie = role;
        const access = await authorizeConsoleApiRead(moduleId);
        if (allowedRoles.includes(role)) {
          expect(access.allowed).toBe(true);
          if (access.allowed) {
            expect(access.principal.role).toBe(role);
          }
        } else {
          expect(access.allowed).toBe(false);
          if (!access.allowed) {
            expect(access.reason).toBe('role-denied');
          }
        }
      }
    }
  });
});
