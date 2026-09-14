/**
 * PC-005 — Documentation pages tests (route inventory + internal links).
 *
 * The PC-004 page-test convention: 'next/headers' mocked (the audience
 * cookie is the only input a test controls), the REAL page components
 * render their REAL composed content.
 *
 * Proven here:
 *   - all four documentation pages render composed content for an allowed
 *     role (documentation is every-role per the frozen registry), and one
 *     page renders for EVERY role;
 *   - unauthenticated viewers are redirected before any content renders;
 *   - ROUTE INVENTORY: the API reference's inventory equals the REAL
 *     implemented route files under src/app/api/** in BOTH directions
 *     (no undocumented route, no invented route), each entry's methods
 *     match the route file's exported handlers, and each source file
 *     exists;
 *   - INTERNAL LINKS RESOLVE: every console href rendered by any of the
 *     four pages is a frozen-registry route; every referenced repository
 *     path (data-docs-repo-path) exists on disk; every example's route
 *     reference is either an implemented API route or a registry console
 *     route — no dead internal links;
 *   - EXAMPLE LABELS: every executable example renders the executable
 *     badge with its honest response; every illustrative example renders
 *     the illustrative badge and its "why illustrative" statement.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSOLE_REGISTRY } from '@/lib/console/registry';
import { DOCUMENTATION_API_ROUTE_ENTRIES, DOCUMENTATION_API_ROUTE_PATHS } from './api/route-inventory';
import { DOCUMENTATION_SPEC_LINKS } from './concepts/spec-links';
import { DOCUMENTATION_EXAMPLES } from './examples/example-set';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const API_APP_ROOT = join(REPO_ROOT, 'src', 'app', 'api');

const ConsoleDocumentationApiPage = (await import('./api/page')).default;
const ConsoleDocumentationConceptsPage = (await import('./concepts/page')).default;
const ConsoleDocumentationExamplesPage = (await import('./examples/page')).default;
const ConsoleDocumentationGuidesPage = (await import('./guides/page')).default;

const PAGES: readonly { readonly name: string; readonly render: () => Promise<string> }[] = [
  { name: 'api', render: async () => renderToStaticMarkup(await ConsoleDocumentationApiPage()) },
  { name: 'concepts', render: async () => renderToStaticMarkup(await ConsoleDocumentationConceptsPage()) },
  { name: 'examples', render: async () => renderToStaticMarkup(await ConsoleDocumentationExamplesPage()) },
  { name: 'guides', render: async () => renderToStaticMarkup(await ConsoleDocumentationGuidesPage()) },
];

/** Every route file under src/app/api/** → { path, methods }. */
function implementedApiRoutes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry === 'route.ts') {
        // Route path derivation keeps the /api prefix and dynamic segments
        // verbatim (src/app/api/console/payments/[paymentId]/route.ts →
        // /api/console/payments/[paymentId]).
        const routePath = `/api/${path
          .slice(API_APP_ROOT.length + 1)
          .replaceAll('\\', '/')
          .replace(/\/route\.ts$/, '')}`;
        const source = readFileSync(path, 'utf8');
        const methods = [...source.matchAll(/export async function (GET|POST|DELETE|PUT|PATCH)\b/g)].map(
          (match) => match[1],
        );
        found.set(routePath, methods);
      }
    }
  };
  walk(API_APP_ROOT);
  return found;
}

/** Every href="…" value rendered in the given markup. */
function renderedHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

/** Every data-docs-repo-path value rendered in the given markup. */
function renderedRepoPaths(html: string): string[] {
  return [...html.matchAll(/data-docs-repo-path="([^"]+)"/g)].map((match) => match[1]);
}

/** Every data-docs-example-route value rendered in the given markup. */
function renderedExampleRoutes(html: string): string[] {
  return [...html.matchAll(/data-docs-example-route="([^"]+)"/g)].map((match) => match[1]);
}

describe('PC-005 documentation pages — rendering and role coverage', () => {
  test('all four pages render composed content for an allowed role', async () => {
    mockedAudienceCookie = 'merchant';
    const api = await PAGES[0].render();
    expect(api).toContain('data-console-view="documentation-api"');
    expect(api).toContain('data-docs-api-route="/api/health"');
    const concepts = await PAGES[1].render();
    expect(concepts).toContain('data-console-view="documentation-concepts"');
    expect(concepts).toContain('data-docs-repo-path="spec/architecture/v0.1/README.md"');
    const examples = await PAGES[2].render();
    expect(examples).toContain('data-console-view="documentation-examples"');
    expect(examples).toContain('data-docs-example-label="executable"');
    const guides = await PAGES[3].render();
    expect(guides).toContain('data-console-view="documentation-guides"');
    expect(guides).toContain('data-docs-guide-step="1"');
    // No page renders the planned-state placeholder anymore.
    for (const page of PAGES) {
      expect((await page.render()).includes('ConsolePlannedModule')).toBe(false);
    }
  });

  test('documentation renders for EVERY authenticated role (the frozen ALL_ROLES grant)', async () => {
    for (const role of ['customer', 'merchant', 'provider', 'operator', 'administrator']) {
      mockedAudienceCookie = role;
      const html = await PAGES[0].render();
      expect(html).toContain('data-console-view="documentation-api"');
    }
  });

  test('unauthenticated viewers are redirected before any content renders', async () => {
    mockedAudienceCookie = undefined;
    for (const page of PAGES) {
      let thrown: unknown;
      try {
        await page.render();
      } catch (error) {
        thrown = error;
      }
      const digest = (thrown as { digest?: unknown })?.digest;
      expect(typeof digest).toBe('string');
      expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    }
  });
});

describe('PC-005 documentation — API route inventory equals the implementation', () => {
  const implemented = implementedApiRoutes();

  test('every implemented route file is documented (no undocumented routes)', () => {
    for (const routePath of implemented.keys()) {
      expect(DOCUMENTATION_API_ROUTE_PATHS.includes(routePath)).toBe(true);
    }
  });

  test('every documented route exists on disk (no invented routes)', () => {
    for (const routePath of DOCUMENTATION_API_ROUTE_PATHS) {
      expect(implemented.has(routePath)).toBe(true);
    }
    // Set equality, stated once more as counts.
    expect(DOCUMENTATION_API_ROUTE_PATHS.length).toBe(implemented.size);
  });

  test('every documented entry matches its route file (methods + source file)', () => {
    for (const entry of DOCUMENTATION_API_ROUTE_ENTRIES) {
      expect(implemented.get(entry.path)).toEqual(entry.methods as string[]);
      expect(existsSync(join(REPO_ROOT, entry.sourceFile))).toBe(true);
    }
  });
});

describe('PC-005 documentation — internal links resolve', () => {
  const registryHrefs = new Set(CONSOLE_REGISTRY.map((entry) => entry.href));
  const implemented = implementedApiRoutes();

  test('every console href rendered by any documentation page is a frozen-registry route', async () => {
    mockedAudienceCookie = 'merchant';
    for (const page of PAGES) {
      const html = await page.render();
      for (const href of renderedHrefs(html)) {
        if (href.startsWith('/console')) {
          expect(registryHrefs.has(href)).toBe(true);
        }
      }
    }
  });

  test('every referenced repository path exists on disk (no dead spec links)', async () => {
    // The concepts inventory itself, then the rendered forms.
    for (const link of DOCUMENTATION_SPEC_LINKS) {
      expect(existsSync(join(REPO_ROOT, link.path))).toBe(true);
    }
    mockedAudienceCookie = 'merchant';
    const html = await PAGES[1].render();
    const rendered = renderedRepoPaths(html);
    expect(rendered.length).toBe(DOCUMENTATION_SPEC_LINKS.length);
    for (const path of rendered) {
      expect(existsSync(join(REPO_ROOT, path))).toBe(true);
    }
  });

  test('every example route reference is a real API route or a registry console route', async () => {
    // The example set itself, then the rendered forms.
    for (const example of DOCUMENTATION_EXAMPLES) {
      for (const route of example.routes) {
        const real = implemented.has(route) || registryHrefs.has(route);
        expect(real).toBe(true);
      }
    }
    mockedAudienceCookie = 'merchant';
    const html = await PAGES[2].render();
    const rendered = renderedExampleRoutes(html);
    expect(rendered.length).toBe(
      DOCUMENTATION_EXAMPLES.reduce((total, example) => total + example.routes.length, 0),
    );
    for (const route of rendered) {
      expect(implemented.has(route) || registryHrefs.has(route)).toBe(true);
    }
  });

  test('the guides page’s console links resolve to registry routes and real page files', async () => {
    mockedAudienceCookie = 'merchant';
    const html = await PAGES[3].render();
    const links = [...html.matchAll(/data-docs-console-link="([^"]+)"/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const href of links) {
      expect(registryHrefs.has(href)).toBe(true);
      const pagePath = join(
        REPO_ROOT,
        `src/app/console${href.replace('/console', '')}/page.tsx`,
      );
      expect(existsSync(pagePath)).toBe(true);
    }
  });
});

describe('PC-005 documentation — example labels', () => {
  test('every executable example renders the executable badge and an honest response', async () => {
    mockedAudienceCookie = 'merchant';
    const html = await PAGES[2].render();
    const executable = DOCUMENTATION_EXAMPLES.filter((example) => example.kind === 'executable');
    for (const example of executable) {
      expect(html).toContain(`data-docs-example="${example.id}"`);
      expect(html).toContain(`data-docs-example="${example.id}" data-docs-example-kind="executable"`);
      expect(html).toContain('Executable — runs against a live server exactly as shown');
      expect(example.response).toBeDefined();
    }
    // No executable example carries an illustrative reason.
    for (const example of executable) {
      expect(example.illustrativeBecause).toBeUndefined();
    }
  });

  test('every illustrative example renders the illustrative badge and its stated reason', async () => {
    mockedAudienceCookie = 'merchant';
    const html = await PAGES[2].render();
    const illustrative = DOCUMENTATION_EXAMPLES.filter((example) => example.kind === 'illustrative');
    expect(illustrative.length).toBeGreaterThan(0);
    for (const example of illustrative) {
      expect(html).toContain(`data-docs-example="${example.id}" data-docs-example-kind="illustrative"`);
      expect(html).toContain('Illustrative — shape only, not runnable as-is');
      expect(html).toContain('Why illustrative: ');
      expect(example.illustrativeBecause).toBeDefined();
      // An illustrative example must NOT promise a runnable response.
      expect(example.response).toBeUndefined();
    }
  });
});
