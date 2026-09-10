/**
 * Availability-unknown helper (UI-001; P4, P5).
 *
 * Render conditions are distinct from outcomes. When the authoritative
 * state cannot be retrieved — a failed fetch, an unreachable authority —
 * the display state is UNKNOWN (availability unknown), never FAILED, and
 * never a cached or guessed verdict. This helper wraps UnknownState with
 * the standing fetch-failure framing so the two cases stay visually and
 * semantically distinct everywhere the product retrieves state.
 */

import { UnknownState } from './unknown-state';

export interface AvailabilityUnknownStateProps {
  /** What could not be reached (the authoritative source that was asked). */
  readonly target: string;
  /** Transport-level detail of the render condition (not an outcome). */
  readonly detail?: string;
}

export function AvailabilityUnknownState({
  target,
  detail,
}: AvailabilityUnknownStateProps) {
  return (
    <UnknownState
      subject={`Current state of ${target}: unknown`}
      explanation={`The authoritative state for ${target} could not be retrieved${
        detail ? ` (${detail})` : ''
      }. This is an availability problem, not an outcome: it does not mean the operation failed, and it does not mean it succeeded.`}
      reconciliation={{
        whoResolves: `The owning authority for ${target}, once reachable`,
        recheckTrigger:
          'Re-attempt retrieval; the display stays Unknown until an authoritative answer arrives.',
      }}
    />
  );
}
