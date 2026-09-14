/**
 * PC-002 — Console shell render tests (server-rendered markup, no browser).
 *
 * The console shell components are server components; these tests render
 * them to static markup (the same output the server sends) and prove:
 *
 *   - NAVIGATION GRAMMAR: for every role, the rendered navigation contains
 *     EXACTLY the role-allowed modules (derived from CONSOLE_REGISTRY —
 *     never a hardcoded list) and NOTHING the role may not access;
 *   - DESKTOP/MOBILE SAME ROUTES: every navigation href renders exactly
 *     twice (once in the mobile disclosure, once in the desktop sidebar) —
 *     the two presentations are the same component over the same model, so
 *     collapsing never changes route semantics;
 *   - PLANNED-STATUS HONESTY: planned modules carry the visible "Planned"
 *     tag in the navigation and render the honest placeholder (registry
 *     label + status + description, NO invented data, no six-status chips);
 *   - HEADER/FOOTER: the role label uses the grammar's audienceLabel
 *     vocabulary and the environment note is the server-resolved context.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ROLES, audienceLabel, type Role } from '@/lib/navigation';
import { CONSOLE_REGISTRY, findConsoleRoute } from '@/lib/console/registry';
import type { ConsoleEnvironmentContext } from '@/lib/console/types';
import { consoleNavigationForRole, isStaticConsoleHref } from './console-navigation';
import { ConsoleNav } from './console-nav';
import { ConsoleHeader } from './console-header';
import { ConsoleFooter } from './console-footer';
import { ConsolePlannedModule } from './console-planned-module';

/** A representative server-derived environment context (shape-only fixture). */
const ENVIRONMENT: ConsoleEnvironmentContext = {
  kind: 'sandbox',
  configuredValue: 'sandbox',
  source: 'PAYSWAP_ENV — server-side build/start-time configuration',
  derivedBy: 'server',
  startupConfiguration: {
    ok: true,
    env: 'sandbox',
    checks: [{ id: 'fixture', ok: true, detail: 'test fixture context' }],
  },
};

/** Count non-overlapping occurrences of a substring. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** All registry routes the role may access (derived expectation source). */
function allowedHrefsForRole(role: Role): string[] {
  return CONSOLE_REGISTRY.filter(
    (entry) => entry.allowedRoles.includes(role) && isStaticConsoleHref(entry.href),
  ).map((entry) => entry.href);
}

describe('PC-002 console nav — role-filtered rendering (every role)', () => {
  test('renders exactly the allowed modules as links — and no other route', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ConsoleNav groups={consoleNavigationForRole(role)} />,
      );
      const allowed = allowedHrefsForRole(role);
      for (const href of allowed) {
        expect(html).toContain(`href="${href}"`);
      }
      // Every rendered href is one of the allowed ones (nothing invented,
      // nothing leaked): collect all hrefs in the markup.
      const renderedHrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(renderedHrefs)).toEqual(new Set(allowed));
    }
  });

  test('modules the role may NOT access never appear anywhere in the markup', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ConsoleNav groups={consoleNavigationForRole(role)} />,
      );
      for (const entry of CONSOLE_REGISTRY) {
        if (!entry.allowedRoles.includes(role) && isStaticConsoleHref(entry.href)) {
          expect(html.includes(`href="${entry.href}"`)).toBe(false);
          expect(html.includes(`data-console-module="${entry.id}"`)).toBe(false);
        }
      }
    }
  });

  test('every role sees the Overview root link', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ConsoleNav groups={consoleNavigationForRole(role)} />,
      );
      expect(html).toContain('href="/console"');
    }
  });
});

describe('PC-002 console nav — desktop/mobile share the same route grammar', () => {
  test('both viewport presentations render (mobile disclosure + desktop sidebar)', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ConsoleNav groups={consoleNavigationForRole(role)} />,
      );
      expect(html).toContain('data-console-nav="mobile"');
      expect(html).toContain('data-console-nav="desktop"');
      expect(html).toContain('<details');
      expect(html).toContain('<summary');
    }
  });

  test('every allowed href appears EXACTLY TWICE — once per presentation, never diverging', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(
        <ConsoleNav groups={consoleNavigationForRole(role)} />,
      );
      for (const href of allowedHrefsForRole(role)) {
        expect(countOccurrences(html, `href="${href}"`)).toBe(2);
      }
      // Both presentations render the same number of module links.
      expect(countOccurrences(html, 'data-console-module=') % 2).toBe(0);
    }
  });

  test('planned modules carry the visible Planned tag in BOTH presentations', () => {
    for (const role of ROLES) {
      const groups = consoleNavigationForRole(role);
      const plannedCount = groups.reduce(
        (count, group) => count + group.items.filter((item) => item.status === 'planned').length,
        0,
      );
      const html = renderToStaticMarkup(<ConsoleNav groups={groups} />);
      expect(countOccurrences(html, '>Planned<')).toBe(plannedCount * 2);
    }
  });

  test('the navigation carries 44px-minimum interactive targets and keyboard-reachable links', () => {
    const html = renderToStaticMarkup(
      <ConsoleNav groups={consoleNavigationForRole('operator')} />,
    );
    // min-h-11 = 44px on every module link and the disclosure summary
    // (the shared focus-visible outline comes from globals.css).
    expect(countOccurrences(html, 'min-h-11')).toBeGreaterThan(
      allowedHrefsForRole('operator').length * 2,
    );
    expect(html).toContain('aria-label="Console modules"');
  });
});

describe('PC-002 console planned module — honest placeholder rendering', () => {
  test('renders the registry label, status, route, module id, description, and allowed roles', () => {
    const entry = findConsoleRoute('/console/operations/queues')!;
    const html = renderToStaticMarkup(<ConsolePlannedModule href="/console/operations/queues" />);
    expect(html).toContain(entry.label);
    expect(html).toContain('>Planned<');
    expect(html).toContain(entry.href);
    expect(html).toContain(entry.id);
    expect(html).toContain(entry.description);
    expect(html).toContain(entry.allowedRoles.join(', '));
    expect(html).toContain('No data is displayed here');
  });

  test('renders NO status chips or invented data — a planned module is not a fake feature view', () => {
    for (const entry of CONSOLE_REGISTRY) {
      if (entry.status !== 'planned') {
        continue;
      }
      const html = renderToStaticMarkup(<ConsolePlannedModule href={entry.href} />);
      // The six-status chip convention never appears on a planned module.
      expect(html.includes('role="status"')).toBe(false);
      expect(html.includes('data-console-status=')).toBe(false);
      // No fabricated data surfaces: no tables, no read-model consumption,
      // no currency/quantity values (registry descriptions may legitimately
      // mention the words "amount"/"parties" when describing the module).
      expect(html.includes('<table')).toBe(false);
      expect(html.includes('read-models')).toBe(false);
      expect(/[€$]\s?\d/.test(html)).toBe(false);
      expect(/\b\d+(\.\d{2})\b/.test(html)).toBe(false);
    }
  });

  test('a registry-unknown route fails closed through the not-found convention', () => {
    let thrown: unknown;
    try {
      renderToStaticMarkup(<ConsolePlannedModule href="/console/invented/route" />);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    expect(((thrown as { digest?: unknown }).digest as string).startsWith('NEXT_HTTP_ERROR_FALLBACK;404')).toBe(true);
  });
});

describe('PC-002 console header/footer — grammar vocabulary and server-derived facts', () => {
  test('the header shows the grammar role label and the server-derived environment note', () => {
    for (const role of ROLES) {
      const html = renderToStaticMarkup(<ConsoleHeader role={role} environment={ENVIRONMENT} />);
      expect(html).toContain(audienceLabel(role));
      expect(html).toContain('Console environment: sandbox');
      expect(html).toContain('derived by server configuration only');
    }
  });

  test('the header renders a semantic header landmark with the console root link', () => {
    const html = renderToStaticMarkup(<ConsoleHeader role="merchant" environment={ENVIRONMENT} />);
    expect(html).toContain('<header');
    expect(html).toContain('href="/console"');
  });

  test('the footer renders the standing console facts and the shell-home grammar link', () => {
    const html = renderToStaticMarkup(<ConsoleFooter role="operator" environment={ENVIRONMENT} />);
    expect(html).toContain('<footer');
    expect(html).toContain(audienceLabel('operator'));
    expect(html).toContain('sandbox');
    expect(html).toContain('href="/"');
    expect(html).toContain('src/lib/console/registry.ts');
    expect(html).toContain('default-deny');
  });
});
