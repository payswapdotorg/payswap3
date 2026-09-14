/**
 * PC-001 — Registry tests: the frozen information architecture (design §5)
 * exactly, structural invariants, and the mechanical cross-check against
 * spec/console/route-role-matrix.md (the spec matrix and the code registry
 * can never drift).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, type Role } from '@/lib/navigation';
import { CONSOLE_GROUPS, type ConsoleGroupId } from './types';
import {
  CONSOLE_REGISTRY,
  CONSOLE_ROOT_HREF,
  CONSOLE_ROOT_MODULE_ID,
  consoleRegistryByGroup,
  consoleRegistrySummary,
  consoleRoutesForRole,
  findConsoleModule,
  findConsoleRoute,
} from './registry';
import { canAccessConsoleModule } from './policy';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const MATRIX_PATH = join(REPO_ROOT, 'spec', 'console', 'route-role-matrix.md');

/** The frozen route set — design §5 information architecture, exact. */
const FROZEN_ROUTES: readonly { href: string; group: string }[] = [
  { href: '/console', group: 'overview' },
  { href: '/console/payments', group: 'payments' },
  { href: '/console/payments/[paymentId]', group: 'payments' },
  { href: '/console/checkout/sessions', group: 'checkout' },
  { href: '/console/checkout/configuration', group: 'checkout' },
  { href: '/console/checkout/test', group: 'checkout' },
  { href: '/console/accounts/customers', group: 'accounts' },
  { href: '/console/accounts/merchants', group: 'accounts' },
  { href: '/console/accounts/providers', group: 'accounts' },
  { href: '/console/accounts/operators', group: 'accounts' },
  { href: '/console/capabilities', group: 'capabilities' },
  { href: '/console/developers/api-keys', group: 'developers' },
  { href: '/console/developers/webhooks', group: 'developers' },
  { href: '/console/developers/logs', group: 'developers' },
  { href: '/console/developers/request-inspector', group: 'developers' },
  { href: '/console/developers/environments', group: 'developers' },
  { href: '/console/operations/queues', group: 'operations' },
  { href: '/console/operations/execution', group: 'operations' },
  { href: '/console/operations/reconciliation', group: 'operations' },
  { href: '/console/operations/unknown', group: 'operations' },
  { href: '/console/operations/clearing-netting', group: 'operations' },
  { href: '/console/operations/incidents', group: 'operations' },
  { href: '/console/documentation/api', group: 'documentation' },
  { href: '/console/documentation/concepts', group: 'documentation' },
  { href: '/console/documentation/examples', group: 'documentation' },
  { href: '/console/documentation/guides', group: 'documentation' },
];

describe('PC-001 registry — frozen information architecture (design §5)', () => {
  test('the registry is EXACTLY the frozen route set — no more, no fewer', () => {
    expect(CONSOLE_REGISTRY.map((entry) => entry.href)).toEqual(FROZEN_ROUTES.map((r) => r.href));
    expect(CONSOLE_REGISTRY.length).toBe(FROZEN_ROUTES.length);
  });

  test('every route sits in its frozen top-level group', () => {
    for (const entry of CONSOLE_REGISTRY) {
      const frozen = FROZEN_ROUTES.find((r) => r.href === entry.href);
      expect(frozen).toBeDefined();
      expect(entry.group).toBe(frozen!.group);
    }
  });

  test('the eight top-level groups appear in the frozen order', () => {
    expect([...CONSOLE_GROUPS]).toEqual([
      'overview',
      'payments',
      'checkout',
      'accounts',
      'capabilities',
      'developers',
      'operations',
      'documentation',
    ]);
    const grouped = consoleRegistryByGroup();
    for (const group of CONSOLE_GROUPS as readonly ConsoleGroupId[]) {
      expect(grouped[group].length).toBeGreaterThan(0);
    }
  });

  test('module ids are unique and every href is unique', () => {
    const ids = CONSOLE_REGISTRY.map((entry) => entry.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    const hrefs = CONSOLE_REGISTRY.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test('every route starts with the canonical /console prefix', () => {
    for (const entry of CONSOLE_REGISTRY) {
      expect(entry.href.startsWith('/console')).toBe(true);
    }
  });
});

describe('PC-001 registry — first-release status policy', () => {
  test('post-PC-004 status policy: composed feature views are available; developers and documentation stay planned until PC-005', () => {
    // Lead-applied governed flip (PC-004 merge): the modules PC-004 composed
    // are functionally available; developers/documentation remain planned
    // pending PC-005. Root was available from PC-001.
    const available = CONSOLE_REGISTRY.filter((entry) => entry.status === 'available');
    expect(available.map((entry) => entry.id as string).sort()).toEqual([
      'console.accounts.customers',
      'console.accounts.merchants',
      'console.accounts.operators',
      'console.accounts.providers',
      'console.capabilities',
      'console.checkout.configuration',
      'console.checkout.sessions',
      'console.checkout.test',
      'console.operations.clearing-netting',
      'console.operations.execution',
      'console.operations.incidents',
      'console.operations.queues',
      'console.operations.reconciliation',
      'console.operations.unknown',
      'console.overview',
      'console.payments.all',
      'console.payments.detail',
    ]);
    const planned = CONSOLE_REGISTRY.filter((entry) => entry.status === 'planned');
    expect(planned.map((entry) => entry.id as string).sort()).toEqual([
      'console.developers.api-keys',
      'console.developers.environments',
      'console.developers.logs',
      'console.developers.request-inspector',
      'console.developers.webhooks',
      'console.documentation.api',
      'console.documentation.concepts',
      'console.documentation.examples',
      'console.documentation.guides',
    ]);
  });

  test('the root module id and href are the canonical constants', () => {
    expect(CONSOLE_ROOT_MODULE_ID).toBe('console.overview');
    expect(CONSOLE_ROOT_HREF).toBe('/console');
    expect(findConsoleRoute('/console')?.id).toBe(CONSOLE_ROOT_MODULE_ID);
    expect(findConsoleModule('console.overview')?.href).toBe('/console');
  });

  test('summary counts add up', () => {
    const summary = consoleRegistrySummary();
    expect(summary.totalRoutes).toBe(CONSOLE_REGISTRY.length);
    expect(summary.availableRoutes + summary.plannedRoutes).toBe(summary.totalRoutes);
    expect(summary.groups.length).toBe(CONSOLE_GROUPS.length);
    expect(summary.groups.reduce((total, group) => total + group.routes, 0)).toBe(
      summary.totalRoutes,
    );
  });
});

describe('PC-001 registry — role model invariants (design §6)', () => {
  test('allowed roles are drawn from the existing repository vocabulary', () => {
    for (const entry of CONSOLE_REGISTRY) {
      expect(entry.allowedRoles.length).toBeGreaterThan(0);
      for (const role of entry.allowedRoles) {
        expect((ROLES as readonly string[]).includes(role)).toBe(true);
      }
    }
  });

  test('every role can see at least the console root and documentation', () => {
    for (const role of ROLES) {
      const routes = consoleRoutesForRole(role);
      expect(routes.some((entry) => entry.id === CONSOLE_ROOT_MODULE_ID)).toBe(true);
      expect(routes.some((entry) => entry.group === 'documentation')).toBe(true);
    }
  });

  test('consoleRoutesForRole matches canAccessConsoleModule for every pair', () => {
    for (const role of ROLES) {
      const allowed = new Set(consoleRoutesForRole(role).map((entry) => entry.id as string));
      for (const entry of CONSOLE_REGISTRY) {
        expect(allowed.has(entry.id as string)).toBe(
          canAccessConsoleModule(role, entry.id as string),
        );
      }
    }
  });
});

describe('PC-001 registry — spec route-role matrix cross-check (no drift)', () => {
  test('spec/console/route-role-matrix.md matches the registry for every route × role', () => {
    const matrix = readFileSync(MATRIX_PATH, 'utf8');
    const rows = matrix
      .split('\n')
      .filter((line) => line.startsWith('| `console.'));
    expect(rows.length).toBe(CONSOLE_REGISTRY.length);

    const roleColumns: readonly Role[] = [
      'customer',
      'merchant',
      'provider',
      'operator',
      'administrator',
    ];
    for (const row of rows) {
      const cells = row.split('|').map((cell) => cell.trim());
      // cells[0] is empty (leading pipe): [ '', moduleId, route, ...roles, rationale, '' ]
      const moduleId = (cells[1] ?? '').replace(/^`|`$/g, '');
      const route = (cells[2] ?? '').replace(/^`|`$/g, '');
      const entry = findConsoleModule(moduleId);
      expect(entry).toBeDefined();
      expect(entry!.href).toBe(route);
      roleColumns.forEach((role, index) => {
        const cell = cells[3 + index] ?? '';
        const expected = entry!.allowedRoles.includes(role) ? 'allow' : 'deny';
        expect(cell).toBe(expected);
      });
    }
  });
});
