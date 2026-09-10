/**
 * PaySwap state display model (UI-001; UX contract Section 7).
 *
 * This vocabulary is UI display semantics ONLY. Protocol state naming and
 * transitions belong to the protocol; these display states map
 * authoritative truth to what the user sees. Terminality is decided by
 * protocol authorities — the UI never promotes a non-terminal state to
 * terminal or demotes a terminal one (P4, P11).
 */

/** The six explicit display states — every stateful rendering resolves to exactly one (P4). */
export const DISPLAY_STATES = [
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'WAITING',
  'IN_PROGRESS',
  'ACTION_REQUIRED',
] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

/**
 * User-facing labels. Each state carries its own word; nothing renders as
 * an ambiguous "pending" (P4).
 */
export const STATE_LABELS: Readonly<Record<DisplayState, string>> = {
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  UNKNOWN: 'Unknown',
  WAITING: 'Waiting',
  IN_PROGRESS: 'In progress',
  ACTION_REQUIRED: 'Action required',
};

/** One-line meaning per state, consumed by documentation surfaces (tooltips, legends). */
export const STATE_MEANINGS: Readonly<Record<DisplayState, string>> = {
  SUCCEEDED: 'The owning authority reports a terminal successful outcome.',
  FAILED: 'The owning authority reports a terminal failed outcome.',
  UNKNOWN: 'No authoritative answer is currently available — never success, never failure.',
  WAITING: 'Non-terminal: queued, delayed, or awaiting, per the owning authority.',
  IN_PROGRESS: 'Non-terminal: actively processing, per the owning authority.',
  ACTION_REQUIRED: 'The authority reports that user action is needed.',
};

/**
 * P5 wording rule: UNKNOWN is never styled, worded, logged, or counted as
 * success or failure. Every Unknown rendering carries this disambiguation.
 */
export const UNKNOWN_DISAMBIGUATION =
  'Unknown is not a success verdict and not a failure verdict.';

/**
 * P6: WAITING always carries the available user actions, or this explicit
 * statement when none exist. Non-terminal states never dead-end.
 */
export const NO_ACTIONS_AVAILABLE = 'No action is available yet.';
