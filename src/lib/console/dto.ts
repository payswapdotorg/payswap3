/**
 * PC-001 — Stable console DTO conventions.
 *
 * The six-status vocabulary is frozen EXACTLY as the design requires
 * (UNKNOWN | WAITING | IN_PROGRESS | FAILED | SUCCEEDED | ACTION_REQUIRED)
 * and aligned one-for-one with the existing product state-display contract
 * (`DISPLAY_STATES`, src/components/state/display-state.ts — the authority
 * for what stateful rendering resolves to, UX contract Section 7). The
 * alignment is machine-checked in dto.test.ts; console DTOs MUST NOT invent
 * states outside this vocabulary.
 *
 * The envelope rule (design §8/§9, encoded in types AND tests): a
 * transport/fetch failure is NOT a business failure. When the authoritative
 * source is unavailable, the DTO stays UNKNOWN — never FAILED, never
 * SUCCEEDED, never zero/empty standing in for an authoritative answer.
 * `consoleTransportFailure()` is the ONLY sanctioned way to record an
 * unavailable/failed read, and it structurally produces the
 * presentation-UNKNOWN branch of `ConsoleReadResult`.
 */

import type {
  ConsoleAuthorityMetadata,
  ConsoleReadResult,
  ConsoleStatus,
} from './types';

/** The frozen six-status vocabulary (design §7). Order mirrors the product contract. */
export const CONSOLE_STATUSES: readonly ConsoleStatus[] = [
  'UNKNOWN',
  'WAITING',
  'IN_PROGRESS',
  'FAILED',
  'SUCCEEDED',
  'ACTION_REQUIRED',
] as const;

/** Type guard: true only for the six frozen statuses. */
export function isConsoleStatus(value: unknown): value is ConsoleStatus {
  return (
    typeof value === 'string' &&
    (CONSOLE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Parse a status from untrusted/external input. Returns the status when it
 * is exactly one of the six frozen members; returns null for ANY invented
 * state (case variants, pending/completed synonyms, empty, non-strings).
 * Invented states are rejected — never coerced, never defaulted.
 */
export function parseConsoleStatus(value: unknown): ConsoleStatus | null {
  return isConsoleStatus(value) ? value : null;
}

/**
 * Build the value branch: the owning authority answered, so the business
 * status is exactly what the authority reported (validated — an invented
 * status throws rather than shipping).
 */
export function consoleValue<T>(
  value: T,
  status: ConsoleStatus,
  authority: ConsoleAuthorityMetadata,
): ConsoleReadResult<T> {
  if (!isConsoleStatus(status)) {
    // Defensive: ConsoleStatus is already the frozen union, but a cast
    // caller must never smuggle an invented state through this helper.
    throw new Error(`invented console status: ${String(status)}`);
  }
  return { outcome: 'value', value, status, authority };
}

/**
 * Build the unavailable branch: NO authoritative answer is available. The
 * presentation status is structurally the literal 'UNKNOWN' — never
 * FAILED/SUCCEEDED (the branch has no ConsoleStatus field at all).
 */
export function consoleUnavailable<T>(
  authority: ConsoleAuthorityMetadata,
  note: string,
): ConsoleReadResult<T> {
  return { outcome: 'unavailable', presentationStatus: 'UNKNOWN', note, authority };
}

/**
 * The transport-failure rule, made structural: a fetch/transport failure is
 * NOT a business failure (design §9). It lands in the unavailable branch
 * with presentation UNKNOWN and an honest note; there is no way for this
 * helper to produce FAILED or SUCCEEDED.
 */
export function consoleTransportFailure<T>(
  authority: ConsoleAuthorityMetadata,
  note: string,
): ConsoleReadResult<T> {
  return consoleUnavailable<T>(
    authority,
    `${note} This is a transport/infrastructure failure, not a business outcome — the DTO stays UNKNOWN.`,
  );
}

/**
 * Presentation helper for views: every read resolves to exactly one
 * presentable status. The value branch shows the authority-reported
 * business status; the unavailable branch shows UNKNOWN — unambiguous by
 * construction, so a view can never word an unavailable read as failure or
 * success (P5).
 */
export function presentationStatus(result: ConsoleReadResult<unknown>): ConsoleStatus {
  return result.outcome === 'value' ? result.status : result.presentationStatus;
}
