/**
 * Environment signal banner (UI-001; UX contract Section 10; N4).
 *
 * Persistent and always visible, pinned to the top of every route. The
 * value arrives as a prop resolved in the server root layout from explicit
 * configuration (src/lib/environment.ts) — the only path that sets it. No
 * URL parameter, user content, or client state reaches this component,
 * and no control anywhere re-labels the environment.
 *
 * This is a server component on purpose: there is no client-side input
 * path to the signal at all.
 */

import type { EnvironmentKind } from '@/lib/environment';

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9.5V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 6h.01" />
      <path d="M6 18h.01" />
    </svg>
  );
}

export interface EnvironmentBannerProps {
  /** Resolved by the server root layout from explicit configuration. */
  readonly environment: EnvironmentKind;
}

export function EnvironmentBanner({ environment }: EnvironmentBannerProps) {
  const sandbox = environment === 'sandbox';
  return (
    // Landmark wrapper (UI-009): the persistent signal is a named region so
    // its content is contained by a landmark on every route. The note
    // semantics and all wording are unchanged.
    <div role="region" aria-label="Environment signal">
      <div
        role="note"
        aria-label={`Environment: ${sandbox ? 'sandbox' : 'production'}`}
        className={`sticky top-0 z-50 border-b ${
          sandbox
            ? 'border-amber-300 bg-amber-100 text-amber-950'
            : 'border-stone-700 bg-stone-900 text-stone-50'
        }`}
      >
        <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm">
          {sandbox ? (
            <FlaskIcon className="h-4 w-4 shrink-0" />
          ) : (
            <ServerIcon className="h-4 w-4 shrink-0" />
          )}
          <strong className="font-semibold">
            {sandbox ? 'Sandbox environment' : 'Production environment'}
          </strong>
          <span
            className={`hidden text-xs sm:inline ${sandbox ? 'text-amber-900' : 'text-stone-300'}`}
          >
            {sandbox
              ? 'Configuration-derived signal. Outcomes in this session are sandbox outcomes — never production effects.'
              : 'Configuration-derived signal. Unqualified consequential wording appears only because configuration says production.'}
          </span>
        </p>
      </div>
    </div>
  );
}
