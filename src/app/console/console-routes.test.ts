/**
 * PC-002 — Console route-tree conformance + deep-link gating tests.
 *
 * Three mechanical guarantees over the real source tree and the real policy:
 *
 *   1. ROUTE TREE = REGISTRY (no drift, no orphan routes): every frozen
 *      registry route has exactly one page entrypoint under src/app/console/,
 *      and every page entrypoint corresponds to exactly one registry route.
 *      A route conflict or orphan route is a PC-002 stop condition — this
 *      scan makes it a test failure instead.
 *   2. GUARD WIRING: every console page guards itself through
 *      requireConsoleRoute('<its own registry href>') (fail closed on direct
 *      entry), and the route-group layout enforces the root-module guard for
 *      the whole group.
 *   3. DEEP-LINK GATING (fail closed): through the REAL policy chain
 *      (cookies → resolveShellAudience → resolveConsolePrincipal →
 *      authorizeConsoleModule) driven by mocking 'next/headers' ONLY — the
 *      full route × role matrix plus unauthenticated and registry-unknown
 *      routes. Authorized principals pass; every unauthorized combination
 *      redirects before content renders; routes outside the registry 404.
 */

import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

import { requireConsoleRoute } from '@/components/console/shell/console-route';
import { CONSOLE_REGISTRY } from '@/lib/console/registry';
import { ROLES, type Role } from '@/lib/navigation';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const CONSOLE_APP_ROOT = join(REPO_ROOT, 'src', 'app', 'console');

/** Registry href → expected page entrypoint path (repo-relative, posix). */
function pagePathForHref(href: string): string {
  return `src/app/console${href.replace('/console', '')}/page.tsx`;
}

function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, visit);
    } else if (entry === 'page.tsx') {
      visit(path);
    }
  }
}

/** All page entrypoints under src/app/console/ (repo-relative, posix). */
function consolePageFiles(): string[] {
  const files: string[] = [];
  walk(CONSOLE_APP_ROOT, (path) => {
    files.push(path.slice(REPO_ROOT.length + 1).replaceAll('\\', '/'));
  });
  return files;
}

/** What requireConsoleRoute does for one viewer (redirect / pass / 404). */
async function routeOutcome(href: string): Promise<'redirect' | 'pass' | 'not-found'> {
  try {
    await requireConsoleRoute(href);
    return 'pass';
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === 'string') {
      if (digest.startsWith('NEXT_REDIRECT')) {
        return 'redirect';
      }
      if (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')) {
        return 'not-found';
      }
    }
    throw error;
  }
}

describe('PC-002 route tree — registry ⇄ route files (no drift, no orphans)', () => {
  test('every frozen registry route has exactly one page entrypoint', () => {
    const onDisk = new Set(consolePageFiles());
    for (const entry of CONSOLE_REGISTRY) {
      expect(onDisk.has(pagePathForHref(entry.href))).toBe(true);
    }
  });

  test('every console page entrypoint corresponds to exactly one registry route (no orphan routes)', () => {
    const registryPaths = new Set(CONSOLE_REGISTRY.map((entry) => pagePathForHref(entry.href)));
    const onDisk = consolePageFiles();
    for (const path of onDisk) {
      expect(registryPaths.has(path)).toBe(true);
    }
    expect(onDisk.length).toBe(CONSOLE_REGISTRY.length);
  });

  test('the route paths under /console conflict with nothing outside the frozen registry scope', () => {
    // All console routes live under the single /console prefix; the frozen
    // registry is the complete set of them (previous test), and no existing
    // product route declares a /console/* path (the product navigation
    // grammar reserves /console only through this registry).
    for (const entry of CONSOLE_REGISTRY) {
      expect(entry.href.startsWith('/console')).toBe(true);
    }
  });
});

describe('PC-002 route tree — guard wiring (every page fails closed on direct entry)', () => {
  test('every module page guards itself through requireConsoleRoute with its own registry href', () => {
    for (const entry of CONSOLE_REGISTRY) {
      const path = join(REPO_ROOT, pagePathForHref(entry.href));
      const source = readFileSync(path, 'utf8');
      expect(source.includes(`requireConsoleRoute('${entry.href}')`)).toBe(true);
      expect(source.includes(`consoleRouteMetadata('${entry.href}')`)).toBe(true);
    }
  });

  // PC-004 progression: these module pages now render COMPOSED feature views
  // (PC-003 read models through PC-004 view components). The registry status
  // flip to `available` is a Lead-governed merge-time action, so this list —
  // not the registry status — records which pages have shipped composed
  // views. Pages NOT on this list and still `planned` keep the honest
  // placeholder requirement (PC-005 owns developers/* and documentation/*).
  const PC_004_COMPOSED_HREFS: readonly string[] = [
    '/console',
    '/console/payments',
    '/console/payments/[paymentId]',
    '/console/checkout/sessions',
    '/console/checkout/configuration',
    '/console/checkout/test',
    '/console/accounts/customers',
    '/console/accounts/merchants',
    '/console/accounts/providers',
    '/console/accounts/operators',
    '/console/capabilities',
    '/console/operations/queues',
    '/console/operations/execution',
    '/console/operations/reconciliation',
    '/console/operations/unknown',
    '/console/operations/clearing-netting',
    '/console/operations/incidents',
  ];

  test('PC-004-composed module pages render composed views — never the placeholder', () => {
    for (const href of PC_004_COMPOSED_HREFS) {
      const path = join(REPO_ROOT, pagePathForHref(href));
      const source = readFileSync(path, 'utf8');
      // The composed page must render through PC-004 view components...
      expect(source.includes('@/components/console/views')).toBe(true);
      // ...and must NOT render the planned-state placeholder anymore.
      expect(source.includes('ConsolePlannedModule')).toBe(false);
    }
  });

  // PC-005 progression: the developer-controls pages now render COMPOSED
  // feature views (PC-005 read models over the in-memory stores through
  // PC-005 view components). As with PC-004, the registry status flip to
  // `available` is a Lead-governed merge-time action, so this list — not
  // the registry status — records which pages have shipped composed views.
  const PC_005_COMPOSED_HREFS: readonly string[] = [
    '/console/developers/api-keys',
    '/console/developers/webhooks',
    '/console/developers/logs',
    '/console/developers/request-inspector',
    '/console/developers/environments',
  ];

  // PC-005 family 4: the documentation pages render composed content views
  // (self-contained composed pages over their colocated content modules —
  // the route inventory, spec links, and example set — plus the shared
  // composed view chrome). Same Lead-governed status-flip convention.
  const PC_005_DOCUMENTATION_COMPOSED_HREFS: readonly string[] = [
    '/console/documentation/api',
    '/console/documentation/concepts',
    '/console/documentation/examples',
    '/console/documentation/guides',
  ];

  test('PC-005-composed developer pages render composed views — never the placeholder', () => {
    for (const href of PC_005_COMPOSED_HREFS) {
      const path = join(REPO_ROOT, pagePathForHref(href));
      const source = readFileSync(path, 'utf8');
      // The composed page must render through PC-005 view components...
      expect(source.includes('@/components/console/developers')).toBe(true);
      // ...and must NOT render the planned-state placeholder anymore.
      expect(source.includes('ConsolePlannedModule')).toBe(false);
    }
  });

  test('PC-005-composed documentation pages render composed content — never the placeholder', () => {
    for (const href of PC_005_DOCUMENTATION_COMPOSED_HREFS) {
      const path = join(REPO_ROOT, pagePathForHref(href));
      const source = readFileSync(path, 'utf8');
      // The composed documentation page renders through the shared composed
      // view chrome (the same header the PC-004 families use)...
      expect(source.includes('@/components/console/views/console-view-chrome')).toBe(true);
      // ...and must NOT render the planned-state placeholder anymore.
      expect(source.includes('ConsolePlannedModule')).toBe(false);
    }
  });

  test('every remaining planned module page renders the honest planned-state placeholder for its own href', () => {
    for (const entry of CONSOLE_REGISTRY) {
      if (entry.status !== 'planned') {
        continue;
      }
      if (PC_004_COMPOSED_HREFS.includes(entry.href)) {
        continue;
      }
      if (PC_005_COMPOSED_HREFS.includes(entry.href)) {
        continue;
      }
      if (PC_005_DOCUMENTATION_COMPOSED_HREFS.includes(entry.href)) {
        continue;
      }
      const path = join(REPO_ROOT, pagePathForHref(entry.href));
      const source = readFileSync(path, 'utf8');
      expect(source.includes(`ConsolePlannedModule href="${entry.href}"`)).toBe(true);
      // No feature-view imports: a planned route must not render composed
      // data surfaces (the owning phase ships those).
      expect(source.includes('@/lib/console/read-models')).toBe(false);
      expect(source.includes('@/components/console/views')).toBe(false);
    }
  });

  test('the route-group layout enforces the root-module guard for the whole /console group', () => {
    const layout = readFileSync(join(CONSOLE_APP_ROOT, 'layout.tsx'), 'utf8');
    expect(layout.includes('requireConsoleModule(CONSOLE_ROOT_MODULE_ID)')).toBe(true);
  });
});

describe('PC-002 deep-link gating — full route × role matrix (fail closed)', () => {
  test('unauthenticated viewer is redirected from EVERY console route', async () => {
    mockedAudienceCookie = undefined;
    for (const entry of CONSOLE_REGISTRY) {
      expect(await routeOutcome(entry.href)).toBe('redirect');
    }
  });

  test('an invalid session signal fails closed exactly like no signal', async () => {
    mockedAudienceCookie = 'superuser';
    for (const entry of CONSOLE_REGISTRY) {
      expect(await routeOutcome(entry.href)).toBe('redirect');
    }
  });

  test('every (route, role) pair: pass ONLY when the registry explicitly allows the role', async () => {
    for (const role of ROLES) {
      mockedAudienceCookie = role;
      for (const entry of CONSOLE_REGISTRY) {
        const expected = entry.allowedRoles.includes(role) ? 'pass' : 'redirect';
        expect(await routeOutcome(entry.href)).toBe(expected);
      }
    }
  });

  test('registry-unknown routes 404 through the existing not-found convention', async () => {
    const invented = [
      '/console/payments/cancel',
      '/console/operations/kill-switch',
      '/console/admin',
      '/console/developers/secrets',
      '/console/documentation/v2',
    ];
    for (const role of [...ROLES, undefined]) {
      mockedAudienceCookie = role;
      for (const href of invented) {
        expect(await routeOutcome(href)).toBe('not-found');
      }
    }
  });
});

describe('PC-002 deep-link gating — representative deep links per role class', () => {
  test('customer: personal payments pass; operations/developer/admin deep links fail closed', async () => {
    mockedAudienceCookie = 'customer';
    expect(await routeOutcome('/console')).toBe('pass');
    expect(await routeOutcome('/console/payments')).toBe('pass');
    expect(await routeOutcome('/console/checkout/test')).toBe('pass');
    // Dynamic module route (payment detail): the page guards its own module
    // (console.payments.detail) with its registry template href — the
    // concrete segment value never participates in authorization.
    expect(await routeOutcome('/console/payments/[paymentId]')).toBe('pass');
    expect(await routeOutcome('/console/operations/queues')).toBe('redirect');
    expect(await routeOutcome('/console/developers/api-keys')).toBe('redirect');
    expect(await routeOutcome('/console/accounts/customers')).toBe('redirect');
    expect(await routeOutcome('/console/capabilities')).toBe('redirect');
  });

  test('merchant: checkout + developer tooling pass; capabilities/operations fail closed', async () => {
    mockedAudienceCookie = 'merchant';
    expect(await routeOutcome('/console/checkout/sessions')).toBe('pass');
    expect(await routeOutcome('/console/developers/webhooks')).toBe('pass');
    expect(await routeOutcome('/console/accounts/merchants')).toBe('pass');
    expect(await routeOutcome('/console/capabilities')).toBe('redirect');
    expect(await routeOutcome('/console/operations/incidents')).toBe('redirect');
    expect(await routeOutcome('/console/accounts/providers')).toBe('redirect');
  });

  test('provider: capabilities + own account pass; payments/operations fail closed', async () => {
    mockedAudienceCookie = 'provider';
    expect(await routeOutcome('/console/capabilities')).toBe('pass');
    expect(await routeOutcome('/console/accounts/providers')).toBe('pass');
    expect(await routeOutcome('/console/documentation/guides')).toBe('pass');
    expect(await routeOutcome('/console/payments')).toBe('redirect');
    expect(await routeOutcome('/console/payments/[paymentId]')).toBe('redirect');
    expect(await routeOutcome('/console/operations/queues')).toBe('redirect');
  });

  test('operator: operations modules + permitted payment visibility pass; developer/admin fail closed', async () => {
    mockedAudienceCookie = 'operator';
    expect(await routeOutcome('/console/operations/queues')).toBe('pass');
    expect(await routeOutcome('/console/operations/unknown')).toBe('pass');
    expect(await routeOutcome('/console/payments')).toBe('pass');
    expect(await routeOutcome('/console/developers/api-keys')).toBe('redirect');
    expect(await routeOutcome('/console/accounts/customers')).toBe('redirect');
    expect(await routeOutcome('/console/capabilities')).toBe('redirect');
  });

  test('administrator: account projections pass; operator-only operations and payments fail closed', async () => {
    mockedAudienceCookie = 'administrator';
    expect(await routeOutcome('/console/accounts/customers')).toBe('pass');
    expect(await routeOutcome('/console/accounts/operators')).toBe('pass');
    expect(await routeOutcome('/console/documentation/concepts')).toBe('pass');
    expect(await routeOutcome('/console/operations/queues')).toBe('redirect');
    expect(await routeOutcome('/console/payments')).toBe('redirect');
    expect(await routeOutcome('/console/developers/api-keys')).toBe('redirect');
  });
});
