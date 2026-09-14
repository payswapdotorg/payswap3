/**
 * PC-001 — Role policy tests: fail-closed authorization over the frozen
 * registry, principal resolution from the EXISTING audience authority, and
 * the redirect guard convention.
 *
 * The request-context chain (cookies → resolveShellAudience →
 * resolveConsolePrincipal → requireConsoleModule) is driven by mocking
 * 'next/headers' ONLY — the real audience authority module runs unmodified,
 * proving the console reuses it rather than inventing an identity source.
 */

import { describe, expect, mock, test } from 'bun:test';
import { ROLES, type Role } from '@/lib/navigation';

// The mocked session signal — the same cookie the shell audience authority
// reads (payswap-shell-audience). Tests control ONLY this, exactly as an
// HTTP client could; no other input path exists.
let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

import {
  CONSOLE_MODULE_ACCESS,
  authorizeConsoleModule,
  canAccessConsoleModule,
  isConsoleRole,
  requireConsoleModule,
  resolveConsolePrincipal,
} from './policy';
import { CONSOLE_REGISTRY, CONSOLE_ROOT_MODULE_ID } from './registry';

const UNAUTHENTICATED = { authenticated: false, reason: 'unauthenticated' } as const;

function principalFor(role: Role) {
  return { authenticated: true, role } as const;
}

/** Every (module, role) pair in the product — for the full-matrix scan. */
const ALL_PAIRS: readonly { moduleId: string; role: Role }[] = CONSOLE_REGISTRY.flatMap(
  (entry) => ROLES.map((role) => ({ moduleId: entry.id as string, role })),
);

describe('PC-001 role policy — vocabulary', () => {
  test('isConsoleRole accepts exactly the five repository roles', () => {
    for (const role of ROLES) {
      expect(isConsoleRole(role)).toBe(true);
    }
    expect(isConsoleRole('unauthenticated')).toBe(false);
    expect(isConsoleRole('admin')).toBe(false);
    expect(isConsoleRole('')).toBe(false);
    expect(isConsoleRole(null)).toBe(false);
    expect(isConsoleRole(42)).toBe(false);
  });
});

describe('PC-001 role policy — fail-closed decisions (pure)', () => {
  test('unauthenticated principal is denied everywhere (least visibility)', () => {
    for (const entry of CONSOLE_REGISTRY) {
      const decision = authorizeConsoleModule(UNAUTHENTICATED, entry.id);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toBe('unauthenticated');
      }
    }
  });

  test('unknown module ids are denied — nothing outside the registry is allowed', () => {
    const invented: string[] = [
      'console.payments.cancel',
      'console.admin',
      'console.operations.kill-switch',
      'console.developers.secrets',
      '',
      'console',
      'console.overview.extra',
    ];
    for (const moduleId of invented) {
      for (const role of ROLES) {
        const decision = authorizeConsoleModule(principalFor(role), moduleId);
        expect(decision.allowed).toBe(false);
        if (!decision.allowed) {
          expect(decision.reason).toBe('unknown-module');
        }
        expect(canAccessConsoleModule(role, moduleId)).toBe(false);
      }
    }
  });

  test('full matrix scan: allow ONLY when the registry explicitly allows the role', () => {
    for (const { moduleId, role } of ALL_PAIRS) {
      const entry = CONSOLE_REGISTRY.find((candidate) => candidate.id === moduleId);
      const expected = entry!.allowedRoles.includes(role);
      const decision = authorizeConsoleModule(principalFor(role), moduleId);
      expect(decision.allowed).toBe(expected);
      expect(canAccessConsoleModule(role, moduleId)).toBe(expected);
      if (expected && decision.allowed) {
        expect(decision.role).toBe(role);
        expect(decision.moduleId).toBe(moduleId);
      } else if (!expected && !decision.allowed) {
        expect(decision.reason).toBe('role-denied');
      }
    }
  });

  test('default-deny spot checks: role boundaries from design §6', () => {
    // Unauthenticated viewer gets nothing.
    expect(canAccessConsoleModule('customer', 'console.overview')).toBe(true);
    // Provider has no payment visibility.
    expect(canAccessConsoleModule('provider', 'console.payments.all')).toBe(false);
    expect(canAccessConsoleModule('provider', 'console.payments.detail')).toBe(false);
    // Customer gets personal payments + checkout test only (not merchant checkout).
    expect(canAccessConsoleModule('customer', 'console.payments.all')).toBe(true);
    expect(canAccessConsoleModule('customer', 'console.checkout.test')).toBe(true);
    expect(canAccessConsoleModule('customer', 'console.checkout.sessions')).toBe(false);
    expect(canAccessConsoleModule('customer', 'console.checkout.configuration')).toBe(false);
    // Operations are operator-only (administrator is NOT explicitly authorized).
    for (const role of ROLES.filter((r) => r !== 'operator')) {
      expect(canAccessConsoleModule(role, 'console.operations.queues')).toBe(false);
      expect(canAccessConsoleModule(role, 'console.operations.unknown')).toBe(false);
    }
    expect(canAccessConsoleModule('operator', 'console.operations.queues')).toBe(true);
    // Developer tooling is merchant-scoped in the first release.
    expect(canAccessConsoleModule('merchant', 'console.developers.api-keys')).toBe(true);
    expect(canAccessConsoleModule('operator', 'console.developers.api-keys')).toBe(false);
    expect(canAccessConsoleModule('administrator', 'console.developers.api-keys')).toBe(false);
    // Capabilities mirror the existing provider surface.
    expect(canAccessConsoleModule('provider', 'console.capabilities')).toBe(true);
    expect(canAccessConsoleModule('operator', 'console.capabilities')).toBe(false);
    // Accounts administration is administrator-scoped (own account excepted).
    expect(canAccessConsoleModule('administrator', 'console.accounts.customers')).toBe(true);
    expect(canAccessConsoleModule('operator', 'console.accounts.customers')).toBe(false);
    expect(canAccessConsoleModule('merchant', 'console.accounts.merchants')).toBe(true);
    expect(canAccessConsoleModule('provider', 'console.accounts.providers')).toBe(true);
    // Documentation is part of the product shell: every role.
    for (const role of ROLES) {
      expect(canAccessConsoleModule(role, 'console.documentation.api')).toBe(true);
    }
  });

  test('the module-level access map is exactly the registry-derived map (no drift)', () => {
    for (const role of ROLES) {
      const fromMap = new Set<string>(CONSOLE_MODULE_ACCESS[role] as readonly string[]);
      const fromRegistry = new Set(
        CONSOLE_REGISTRY.filter((entry) => entry.allowedRoles.includes(role)).map(
          (entry) => entry.id as string,
        ),
      );
      expect(fromMap).toEqual(fromRegistry);
    }
  });
});

describe('PC-001 role policy — principal resolution (request context)', () => {
  test('no session signal → unauthenticated principal (fail closed, least visibility)', async () => {
    mockedAudienceCookie = undefined;
    const principal = await resolveConsolePrincipal();
    expect(principal).toEqual({ authenticated: false, reason: 'unauthenticated' });
  });

  test('an invalid session signal is ignored → unauthenticated principal', async () => {
    mockedAudienceCookie = 'superuser';
    const principal = await resolveConsolePrincipal();
    expect(principal.authenticated).toBe(false);
  });

  test('a declared audience resolves to the authenticated principal (every role)', async () => {
    for (const role of ROLES) {
      mockedAudienceCookie = role;
      const principal = await resolveConsolePrincipal();
      expect(principal).toEqual({ authenticated: true, role });
    }
  });
});

describe('PC-001 role policy — requireConsoleModule (page guard, fail closed)', () => {
  test('authorized role passes and gets its principal back', async () => {
    mockedAudienceCookie = 'operator';
    const principal = await requireConsoleModule('console.overview');
    expect(principal.role).toBe('operator');
  });

  test('unauthenticated viewer is redirected — guarded content never renders', async () => {
    mockedAudienceCookie = undefined;
    let thrown: unknown;
    try {
      await requireConsoleModule(CONSOLE_ROOT_MODULE_ID);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    const digest = (thrown as { digest?: unknown }).digest;
    expect(typeof digest).toBe('string');
    expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
  });

  test('role-denied module redirects (customer deep link into operations)', async () => {
    mockedAudienceCookie = 'customer';
    let thrown: unknown;
    try {
      await requireConsoleModule('console.operations.queues');
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    expect(((thrown as { digest?: unknown }).digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
  });

  test('unknown module redirects for every role (deep link fail-closed)', async () => {
    for (const role of ROLES) {
      mockedAudienceCookie = role;
      let thrown: unknown;
      try {
        await requireConsoleModule('console.invented.module');
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error).toBe(true);
      expect(((thrown as { digest?: unknown }).digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    }
  });
});
