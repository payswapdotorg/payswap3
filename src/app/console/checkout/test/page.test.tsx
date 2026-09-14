/**
 * PC-004 — Checkout test page tests (the design §10 surface, at the page
 * seam). The page composes the server-derived environment context (the REAL
 * PC-001 module — pure configuration reads, no authority to mock) and the
 * existing-paths inventory.
 *
 * Proven here:
 *   - the environment signal renders and is server-derived (sandbox or
 *     production — whatever the frozen chain resolves in this process);
 *   - the existing sanctioned paths link out with 44px targets;
 *   - NO simulator, form, input, or button exists on the page.
 */

import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

let mockedAudienceCookie: string | undefined;

mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'payswap-shell-audience' ? { value: mockedAudienceCookie } : undefined,
  }),
}));

const ConsoleCheckoutTestPage = (await import('./page')).default;

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await ConsoleCheckoutTestPage());
}

describe('PC-004 /console/checkout/test page — existing paths only, no simulator', () => {
  test('allowed roles see the server-derived environment and the existing execution paths', async () => {
    for (const audience of ['customer', 'merchant']) {
      mockedAudienceCookie = audience;
      const html = await await renderPage();
      expect(html).toContain('data-testid="console-checkout-test-environment"');
      // The environment kind is whatever the frozen server-side chain
      // resolves — one of the two allowlisted values, never client-chosen.
      expect(html.match(/Environment: (sandbox|production)/)).toBeTruthy();
      expect(html).toContain('derived by server configuration only');
      // The existing sanctioned paths.
      expect(html).toContain('href="/pay"');
      expect(html).toContain('href="/checkout"');
      expect(html).toContain('/api/protocol/commands');
      // 44px interactive targets on the path links.
      expect(html).toContain('min-h-11');
      // NO simulator controls: nothing executes from this page.
      expect(html.includes('<form')).toBe(false);
      expect(html.includes('<input')).toBe(false);
      expect(html.includes('<button')).toBe(false);
    }
  });

  test('operator is redirected (customer/merchant-only module)', async () => {
    mockedAudienceCookie = 'operator';
    let thrown: unknown;
    try {
      await renderPage();
    } catch (error) {
      thrown = error;
    }
    const digest = (thrown as { digest?: unknown })?.digest;
    expect(typeof digest).toBe('string');
    expect((digest as string).startsWith('NEXT_REDIRECT')).toBe(true);
  });
});
