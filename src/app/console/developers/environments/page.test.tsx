/**
 * PC-005 — Environments page tests (composition through the REAL read model).
 *
 * The PC-004 page-test convention: 'next/headers' mocked (the audience
 * cookie is the only input a test controls), the REAL page component
 * renders through the REAL PC-005 read model over the REAL PC-001
 * server-derived environment context.
 *
 * Proven here:
 *   - merchant (the only allowed role) receives the READ-ONLY presentation:
 *     the resolved kind, the derivation chain, the no-switching note, and
 *     the startup configuration validation summary (names only);
 *   - a spoofed env search parameter is structurally ignored — the page
 *     takes NO input into the read, and no selector exists anywhere;
 *   - production framing appears only when configuration says production
 *     (PAYSWAP_ENV=production), and even then there is no switching;
 *   - every other role is redirected before any read composes.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetDeveloperControlStoresForTesting } from '@/lib/console/developers/store-reset';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const ConsoleDevelopersEnvironmentsPage = (await import('./page')).default;

function reset(): void {
  resetDeveloperControlStoresForTesting();
}

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleDevelopersEnvironmentsPage());
}

/** Save/restore PAYSWAP_ENV around one scenario (the ONLY input). */
async function withEnvironment(
  value: string | undefined,
  scenario: () => Promise<void>,
): Promise<void> {
  const saved = process.env.PAYSWAP_ENV;
  try {
    if (value === undefined) {
      delete process.env.PAYSWAP_ENV;
    } else {
      process.env.PAYSWAP_ENV = value;
    }
    await scenario();
  } finally {
    if (saved === undefined) {
      delete process.env.PAYSWAP_ENV;
    } else {
      process.env.PAYSWAP_ENV = saved;
    }
  }
}

describe('PC-005 /console/developers/environments page — composition', () => {
  test('merchant receives the read-only presentation (sandbox fail-safe, chain, no-switching)', async () => {
    reset();
    await withEnvironment(undefined, async () => {
      mockedAudienceCookie = 'merchant';
      const html = await renderPage();
      expect(html).toContain('data-console-view="developer-environments"');
      expect(html).toContain('data-console-developer-provenance="in-memory"');
      // The resolved kind (sandbox — the fail-safe with PAYSWAP_ENV unset).
      // The kind span carries a class attribute after the testid, so the
      // assertion anchors through a regex on the element's text.
      expect(html).toMatch(/data-testid="console-environment-kind"[^>]*>sandbox</);
      expect(html).toMatch(/data-testid="console-environment-configured"[^>]*>unset-or-invalid</);
      // The derivation chain renders (all four steps).
      expect(html).toContain('data-testid="console-environment-chain-step"');
      expect(html).toContain('PAYSWAP_ENV');
      expect(html).toContain('fail-safe');
      // The no-switching note renders verbatim.
      expect(html).toContain('data-testid="console-environment-no-switching"');
      expect(html).toContain('no control on this page, in the console navigation, or anywhere in the product that selects production/sandbox');
      // The startup configuration validation renders (names only).
      expect(html).toContain('data-testid="console-environment-startup-ok"');
      // A read-only surface: no form, no selector, no submit control.
      expect(html.includes('<form')).toBe(false);
      expect(html.includes('<select')).toBe(false);
    });
  });

  test('a spoofed env search parameter cannot select the environment — the read takes NO input', async () => {
    reset();
    await withEnvironment(undefined, async () => {
      mockedAudienceCookie = 'merchant';
      // The page component itself accepts no searchParams prop at all; the
      // only way to attempt a spoof is the URL, which the page never reads.
      const html = await renderPage();
      expect(html).toMatch(/data-testid="console-environment-kind"[^>]*>sandbox</);
      expect(html).toMatch(/data-testid="console-environment-configured"[^>]*>unset-or-invalid</);
      // Negative form of the regex anchor: the production framing must NOT
      // render (string.match answers null when there is no match).
      expect(html.match(/data-testid="console-environment-kind"[^>]*>production</)).toBe(null);
    });
  });

  test('production framing appears ONLY when configuration explicitly says production', async () => {
    reset();
    await withEnvironment('production', async () => {
      mockedAudienceCookie = 'merchant';
      const html = await renderPage();
      expect(html).toMatch(/data-testid="console-environment-kind"[^>]*>production</);
      expect(html).toMatch(/data-testid="console-environment-configured"[^>]*>production</);
      // Still read-only: no switching even in production framing.
      expect(html).toContain('data-testid="console-environment-no-switching"');
      expect(html.includes('<form')).toBe(false);
    });
  });
});

describe('PC-005 /console/developers/environments page — role isolation', () => {
  test('every non-merchant viewer is redirected before any read composes', async () => {
    reset();
    for (const audience of ['customer', 'provider', 'operator', 'administrator', undefined]) {
      mockedAudienceCookie = audience;
      let thrown: unknown;
      try {
        await renderPage();
      } catch (error) {
        thrown = error;
      }
      const digest = (thrown as { digest?: unknown })?.digest;
      expect(typeof digest).toBe('string');
      expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
    }
  });
});
