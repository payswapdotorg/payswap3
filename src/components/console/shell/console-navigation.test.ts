/**
 * PC-002 — Console navigation model tests.
 *
 * Every expectation is derived FROM the frozen registry (and PC-001's
 * mechanically-derived access map) — never from a hardcoded copy of the
 * tree. The tests prove:
 *
 *   - each role sees EXACTLY the modules PC-001's policy allows it (the
 *     navigation model and CONSOLE_MODULE_ACCESS cannot drift);
 *   - groups appear in the frozen information-architecture order with
 *     mechanically-derived labels (the frozen top-level grammar:
 *     Overview, Payments, Checkout, Accounts, Capabilities, Developers,
 *     Operations, Documentation);
 *   - dynamic-segment routes stay deep-linkable registry modules but never
 *     become navigation destinations;
 *   - item labels are registry labels (prefix-stripped presentation only);
 *   - the design §6 role boundaries surface in the navigation the same way
 *     they do in the policy (spot checks mirroring PC-001 policy.test.ts).
 */

import { describe, expect, test } from 'bun:test';
import { ROLES, type Role } from '@/lib/navigation';
import { CONSOLE_GROUPS, type ConsoleGroupId } from '@/lib/console/types';
import { CONSOLE_REGISTRY, findConsoleModule } from '@/lib/console/registry';
import { CONSOLE_MODULE_ACCESS } from '@/lib/console/policy';
import {
  consoleGroupLabel,
  consoleNavItemLabel,
  consoleNavigationForRole,
  consoleNavigationItemCount,
  isStaticConsoleHref,
} from './console-navigation';

/** Group of registry entries (helper for expectations derived from sources). */
type RegistryEntries = readonly (typeof CONSOLE_REGISTRY)[number][];

/** Expected groups for a role, derived from the registry + frozen group order. */
function expectedGroupsForRole(role: Role): { group: ConsoleGroupId; entries: RegistryEntries }[] {
  const expected: { group: ConsoleGroupId; entries: RegistryEntries }[] = [];
  for (const group of CONSOLE_GROUPS) {
    const entries = CONSOLE_REGISTRY.filter(
      (entry) => entry.group === group && entry.allowedRoles.includes(role),
    );
    if (entries.length > 0) {
      expected.push({ group, entries });
    }
  }
  return expected;
}

describe('PC-002 console navigation — registry derivation (every role)', () => {
  test('each role sees exactly its policy-allowed modules: no more, no fewer', () => {
    for (const role of ROLES) {
      const navigation = consoleNavigationForRole(role);
      const navItemIds = navigation.flatMap((group) => group.items.map((item) => item.id));
      // Expected: PC-001's access map minus dynamic-segment routes.
      const expectedIds = (CONSOLE_MODULE_ACCESS[role] as readonly string[]).filter((id) => {
        const entry = findConsoleModule(id);
        return entry !== undefined && isStaticConsoleHref(entry.href);
      });
      expect(navItemIds).toEqual(expectedIds);
    }
  });

  test('groups keep the frozen information-architecture order and derived labels', () => {
    for (const role of ROLES) {
      const navigation = consoleNavigationForRole(role);
      const expected = expectedGroupsForRole(role).map(({ group }) => consoleGroupLabel(group));
      expect(navigation.map((navGroup) => navGroup.label)).toEqual(expected);
      // Group labels are the capitalized frozen group ids.
      for (const navGroup of navigation) {
        expect(navGroup.label).toBe(consoleGroupLabel(navGroup.group));
      }
    }
  });

  test('the derived top-level grammar labels are exactly the frozen design §5 names', () => {
    expect(CONSOLE_GROUPS.map((group) => consoleGroupLabel(group))).toEqual([
      'Overview',
      'Payments',
      'Checkout',
      'Accounts',
      'Capabilities',
      'Developers',
      'Operations',
      'Documentation',
    ]);
  });

  test('items keep registry order, hrefs, descriptions, and statuses verbatim', () => {
    for (const role of ROLES) {
      const navigation = consoleNavigationForRole(role);
      const expected = expectedGroupsForRole(role);
      expect(navigation.map((group) => group.group)).toEqual(expected.map((e) => e.group));
      navigation.forEach((navGroup, index) => {
        const entries = expected[index]!.entries;
        expect(navGroup.items.length <= entries.length).toBe(true);
        navGroup.items.forEach((item) => {
          const entry = entries.find((candidate) => candidate.id === item.id);
          expect(entry).toBeDefined();
          expect(item.href).toBe(entry!.href);
          expect(item.description).toBe(entry!.description);
          expect(item.status).toBe(entry!.status);
        });
      });
    }
  });

  test('every navigation destination is a real registry route (nothing invented)', () => {
    const registryHrefs = new Set(CONSOLE_REGISTRY.map((entry) => entry.href));
    for (const role of ROLES) {
      for (const group of consoleNavigationForRole(role)) {
        for (const item of group.items) {
          expect(registryHrefs.has(item.href)).toBe(true);
        }
      }
    }
  });

  test('dynamic-segment registry routes are never navigation destinations', () => {
    const dynamicHrefs = CONSOLE_REGISTRY.filter((entry) => !isStaticConsoleHref(entry.href)).map(
      (entry) => entry.href,
    );
    expect(dynamicHrefs).toEqual(['/console/payments/[paymentId]']);
    for (const role of ROLES) {
      const hrefs = consoleNavigationForRole(role).flatMap((group) => group.items.map((item) => item.href));
      for (const dynamicHref of dynamicHrefs) {
        expect(hrefs.includes(dynamicHref)).toBe(false);
      }
    }
  });

  test('every role keeps the Overview root as its first navigation group', () => {
    for (const role of ROLES) {
      const navigation = consoleNavigationForRole(role);
      expect(navigation[0]!.group).toBe('overview');
      expect(navigation[0]!.items[0]!.href).toBe('/console');
      expect(navigation[0]!.items[0]!.status).toBe('available');
    }
  });

  test('item counts match the model (summary helper)', () => {
    for (const role of ROLES) {
      const navigation = consoleNavigationForRole(role);
      const total = navigation.reduce((count, group) => count + group.items.length, 0);
      expect(consoleNavigationItemCount(navigation)).toBe(total);
    }
  });
});

describe('PC-002 console navigation — item labels (registry-derived presentation)', () => {
  test('prefixed registry labels strip the "Group — " prefix for the nested navigation', () => {
    expect(consoleNavItemLabel(findConsoleModule('console.payments.all')!, 'Payments')).toBe('all');
    expect(consoleNavItemLabel(findConsoleModule('console.operations.queues')!, 'Operations')).toBe('queues');
    expect(
      consoleNavItemLabel(findConsoleModule('console.operations.unknown')!, 'Operations'),
    ).toBe('UNKNOWN cases');
    expect(
      consoleNavItemLabel(findConsoleModule('console.operations.clearing-netting')!, 'Operations'),
    ).toBe('clearing & netting');
    expect(consoleNavItemLabel(findConsoleModule('console.accounts.customers')!, 'Accounts')).toBe('customers');
    expect(consoleNavItemLabel(findConsoleModule('console.developers.api-keys')!, 'Developers')).toBe('API keys');
    expect(consoleNavItemLabel(findConsoleModule('console.documentation.api')!, 'Documentation')).toBe('API reference');
  });

  test('labels without the group prefix render verbatim (no invention)', () => {
    expect(consoleNavItemLabel(findConsoleModule('console.overview')!, 'Overview')).toBe('Overview');
    expect(consoleNavItemLabel(findConsoleModule('console.payments.detail')!, 'Payments')).toBe('Payment detail');
    expect(consoleNavItemLabel(findConsoleModule('console.checkout.sessions')!, 'Checkout')).toBe('Checkout sessions');
    expect(consoleNavItemLabel(findConsoleModule('console.capabilities')!, 'Capabilities')).toBe('Capabilities');
  });
});

describe('PC-002 console navigation — design §6 role boundaries (spot checks)', () => {
  test('customer: personal payments + checkout test + documentation, no merchant/operator/admin modules', () => {
    const hrefs = consoleNavigationForRole('customer').flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain('/console');
    expect(hrefs).toContain('/console/payments');
    expect(hrefs).toContain('/console/checkout/test');
    expect(hrefs).toContain('/console/documentation/api');
    expect(hrefs.includes('/console/checkout/sessions')).toBe(false);
    expect(hrefs.includes('/console/developers/api-keys')).toBe(false);
    expect(hrefs.includes('/console/operations/queues')).toBe(false);
    expect(hrefs.includes('/console/accounts/customers')).toBe(false);
    expect(hrefs.includes('/console/capabilities')).toBe(false);
  });

  test('merchant: payments, full checkout, own accounts, developer tooling, documentation', () => {
    const groups = consoleNavigationForRole('merchant');
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain('/console/payments');
    expect(hrefs).toContain('/console/checkout/sessions');
    expect(hrefs).toContain('/console/checkout/configuration');
    expect(hrefs).toContain('/console/accounts/merchants');
    expect(hrefs).toContain('/console/developers/api-keys');
    expect(hrefs).toContain('/console/developers/environments');
    expect(hrefs.includes('/console/capabilities')).toBe(false);
    expect(hrefs.includes('/console/operations/queues')).toBe(false);
    expect(hrefs.includes('/console/accounts/customers')).toBe(false);
  });

  test('provider: capabilities + own account projection + documentation, no payment visibility', () => {
    const hrefs = consoleNavigationForRole('provider').flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain('/console/capabilities');
    expect(hrefs).toContain('/console/accounts/providers');
    expect(hrefs).toContain('/console/documentation/api');
    expect(hrefs.includes('/console/payments')).toBe(false);
    expect(hrefs.includes('/console/operations/queues')).toBe(false);
    expect(hrefs.includes('/console/developers/api-keys')).toBe(false);
  });

  test('operator: permitted payment visibility + all operations modules, no developer/admin surfaces', () => {
    const hrefs = consoleNavigationForRole('operator').flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain('/console/payments');
    expect(hrefs).toContain('/console/operations/queues');
    expect(hrefs).toContain('/console/operations/unknown');
    expect(hrefs).toContain('/console/operations/incidents');
    expect(hrefs.includes('/console/developers/api-keys')).toBe(false);
    expect(hrefs.includes('/console/accounts/customers')).toBe(false);
    expect(hrefs.includes('/console/capabilities')).toBe(false);
  });

  test('administrator: cross-role account projections, no operator-only operations modules', () => {
    const hrefs = consoleNavigationForRole('administrator').flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain('/console/accounts/customers');
    expect(hrefs).toContain('/console/accounts/operators');
    expect(hrefs.includes('/console/operations/queues')).toBe(false);
    expect(hrefs.includes('/console/payments')).toBe(false);
    expect(hrefs.includes('/console/capabilities')).toBe(false);
  });
});
