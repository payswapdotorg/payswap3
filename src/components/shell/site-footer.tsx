/**
 * Shell footer (UI-001). Semantic landmark: <footer>.
 *
 * Sticks to the bottom of the viewport on short pages and is pushed down
 * naturally on long pages (root wrapper: min-h-screen flex flex-col; this
 * footer carries mt-auto). Renders the footer navigation from the ONE
 * grammar plus the standing shell facts: environment, viewer audience,
 * single grammar source, and the zero-financial-semantics constraint.
 */

import type { EnvironmentKind } from '@/lib/environment';
import type { NavAudience, NavEntry } from '@/lib/navigation';
import { NavList } from './nav-list';

export interface SiteFooterProps {
  readonly footer: readonly NavEntry[];
  readonly environment: EnvironmentKind;
  readonly audience: NavAudience;
}

export function SiteFooter({ footer, environment, audience }: SiteFooterProps) {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-6">
        <NavList label="Footer" entries={footer} />
        <p className="text-xs text-stone-500">
          PaySwap product shell — UI-001 foundation. Environment:{' '}
          {environment === 'sandbox' ? 'sandbox' : 'production'} (configuration-derived).
          Viewer: {audience}.
        </p>
        <p className="text-xs text-stone-500">
          One navigation grammar: src/lib/navigation.ts. The shell carries no financial
          semantics — no balances, no settlement or finality wording, no protocol states
          (N1, N2).
        </p>
      </div>
    </footer>
  );
}
