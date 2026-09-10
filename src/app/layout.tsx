import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { getEnvironment } from '@/lib/environment';
import { getShellAudience, resolveNavigation } from '@/lib/navigation';
import { EnvironmentBanner } from '@/components/shell/environment-banner';
import { SiteHeader } from '@/components/shell/site-header';
import { SiteFooter } from '@/components/shell/site-footer';

export const metadata: Metadata = {
  title: {
    default: 'PaySwap — product shell',
    template: '%s · PaySwap',
  },
  description:
    'PaySwap product foundation (UI-001): application shell, one navigation grammar, six explicit display states, and a configuration-derived environment signal.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Application shell root layout (UI-001).
 *
 * Semantic landmarks: environment banner (note), header with primary nav,
 * main content, footer (P9). A skip link jumps to the main landmark.
 *
 * The environment signal is resolved HERE, on the server, from explicit
 * configuration (src/lib/environment.ts) and passed down as props — the
 * only path that sets it. The shell audience comes from the grammar's
 * authoritative-input placeholder (least visibility until identity ships).
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const environment = getEnvironment();
  const audience = getShellAudience();
  const navigation = resolveNavigation(audience);
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-white font-sans text-stone-900 antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <EnvironmentBanner environment={environment} />
        <SiteHeader audience={audience} primary={navigation.primary} />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <SiteFooter footer={navigation.footer} environment={environment} audience={audience} />
      </body>
    </html>
  );
}
