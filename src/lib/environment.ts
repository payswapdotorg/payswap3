/**
 * PaySwap product shell — environment signal (UI-001).
 *
 * UX contract Section 10: a persistent, always-visible environment signal
 * distinguishes sandbox from production, derived EXCLUSIVELY from explicit
 * build-time configuration. It MUST NOT be spoofable by user content, URL
 * parameters, or client state, and the UI MUST NOT expose any control that
 * re-labels the environment.
 *
 * Derivation chain (the ONLY chain that sets the signal):
 *
 *   1. Source: the server-side environment variable PAYSWAP_ENV, set by
 *      deployment configuration before build/start. Nothing else participates.
 *   2. Validation: exact allowlist { "sandbox", "production" }.
 *   3. Fail-safe: unset or any invalid value resolves to "sandbox".
 *      Production framing (unqualified consequential wording) appears ONLY
 *      when configuration explicitly says production — so the shell can
 *      never present sandbox execution as production execution (N4).
 *   4. Resolution point: the server root layout (src/app/layout.tsx) calls
 *      getEnvironment() and passes the value to the banner as a prop.
 *   5. Presentation: the banner is a server component pinned to the top of
 *      every route. There is no client-side input path to the signal, and no
 *      control anywhere re-labels it.
 *
 * Anti-spoofing: URL parameters, user content, and client state never reach
 * this module. Raw configuration values are never echoed back into the UI
 * (only a classified summary is reported), so hostile configuration content
 * cannot inject wording into the signal.
 *
 * Server-side only: this module reads process.env and is consumed by server
 * components (the root layout and the verification surface). Client
 * components receive the resolved value as props.
 */

/** The two environments the signal can ever report. */
export type EnvironmentKind = 'sandbox' | 'production';

/** Name of the sole configuration source. */
const ENV_VARIABLE_NAME = 'PAYSWAP_ENV';

/** Classified configuration state — raw values are intentionally not echoed. */
export type ConfiguredEnvironment = 'production' | 'sandbox' | 'unset-or-invalid';

export interface EnvironmentReport {
  /** The resolved signal value that the banner renders. */
  readonly kind: EnvironmentKind;
  /** How the configuration was classified (summary only, never the raw value). */
  readonly configuredValue: ConfiguredEnvironment;
  /** Human-readable description of the sole source. */
  readonly source: string;
}

function classify(raw: string | undefined): ConfiguredEnvironment {
  if (raw === 'production') return 'production';
  if (raw === 'sandbox') return 'sandbox';
  return 'unset-or-invalid';
}

/**
 * Resolve the environment signal. Server-side only.
 * Fail-safe: anything other than an explicit "production" resolves to
 * "sandbox". The signal can never become production by accident, by
 * omission, or by client input.
 */
export function getEnvironment(): EnvironmentKind {
  return classify(process.env[ENV_VARIABLE_NAME]) === 'production'
    ? 'production'
    : 'sandbox';
}

/**
 * Full derivation report for the verification surface. Server-side only.
 * Reports a classified summary; the raw configuration value is never
 * rendered into the UI.
 */
export function describeEnvironment(): EnvironmentReport {
  return {
    kind: getEnvironment(),
    configuredValue: classify(process.env[ENV_VARIABLE_NAME]),
    source: `${ENV_VARIABLE_NAME} — server-side build/start-time configuration`,
  };
}
