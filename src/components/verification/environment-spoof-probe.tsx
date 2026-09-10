'use client';

/**
 * Environment anti-spoof probe (UI-001 verification; UX contract Section 10).
 *
 * This component READS URL parameters only to REPORT that they are ignored
 * — it never feeds them into the environment signal. The signal is derived
 * exclusively on the server from explicit configuration
 * (src/lib/environment.ts → src/app/layout.tsx → EnvironmentBanner prop).
 * Whatever this probe observes, the banner above still reads the value
 * resolved on the server.
 */

import { useSearchParams } from 'next/navigation';

const SPOOF_KEYS = ['env', 'environment', 'payswap_env'] as const;

interface SpoofAttempt {
  readonly key: string;
  readonly value: string;
}

export function EnvironmentSpoofProbe() {
  const params = useSearchParams();
  const attempts: SpoofAttempt[] = [];
  for (const key of SPOOF_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      attempts.push({ key, value });
    }
  }

  if (attempts.length === 0) {
    return (
      <div
        role="note"
        aria-label="Environment anti-spoof probe"
        className="rounded-xl border border-amber-300 bg-amber-50 p-4"
      >
        <h3 className="text-sm font-semibold text-amber-950">
          Anti-spoof probe — no attempt detected
        </h3>
        <p className="mt-1 text-sm text-amber-950">
          No environment parameter is present in this URL. The banner at the top reads the
          value resolved on the server from explicit configuration only.
        </p>
        <p className="mt-2 text-sm text-amber-950">
          Try to spoof it:{' '}
          <a
            href="/state-primitives?env=production"
            className="font-medium underline decoration-amber-700 underline-offset-2"
          >
            /state-primitives?env=production
          </a>
        </p>
        <p className="mt-1 text-xs text-amber-900">
          After navigating, this probe reports the ignored attempt and the banner still reads
          the configured environment.
        </p>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Environment anti-spoof probe"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h3 className="text-sm font-semibold text-amber-950">
        Anti-spoof probe — spoof attempt ignored
      </h3>
      <ul className="mt-1 space-y-1 text-sm text-amber-950">
        {attempts.map((attempt) => (
          <li key={attempt.key}>
            URL parameter{' '}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">
              {attempt.key}={attempt.value.slice(0, 40)}
            </code>{' '}
            — <strong className="font-semibold">IGNORED</strong>. It does not reach the
            derivation chain.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-amber-950">
        The environment signal still reads the value resolved on the server from explicit
        configuration. URL parameters, user content, and client state cannot set it, and no
        control re-labels it (Section 10).
      </p>
    </div>
  );
}
