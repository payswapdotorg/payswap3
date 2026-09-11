/**
 * UI-004 — Capability state presentation.
 *
 * Renders the resolved display state of one capability through the shared
 * state primitives (src/components/state), exactly as the one-to-one mapping
 * (src/lib/protocol/capability-state-mapping.ts) resolves it:
 *   available            -> SucceededState
 *   unavailable          -> FailedState
 *   conditional          -> ActionRequiredState (conditions as children)
 *   pending              -> InProgressState
 *   indeterminate        -> UnknownState (with reconciliation; never success/failure)
 *   source unreachable   -> AvailabilityUnknownState (distinct from outcome failure)
 *
 * Pure presentation: no evaluation, no mutation, no fallback to a definitive
 * value when truth is unknown.
 */
import {
  ActionRequiredState,
  AvailabilityUnknownState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
} from "@/components/state";
import { CapabilityConditions } from "@/components/provider/capability-conditions";
import type { CapabilityItem } from "@/lib/protocol/capability-port";
import { resolveCapabilityDisplayState } from "@/lib/protocol/capability-state-mapping";

export function CapabilityStatePresentation({
  item,
}: {
  item: CapabilityItem;
}) {
  const display = resolveCapabilityDisplayState(item);
  const conditions = item.report?.conditions;

  return (
    <div className="space-y-2">
      {display.kind === "succeeded" ? (
        <SucceededState {...display.props} />
      ) : null}
      {display.kind === "failed" ? <FailedState {...display.props} /> : null}
      {display.kind === "action-required" ? (
        <ActionRequiredState {...display.props}>
          {conditions && conditions.length > 0 ? (
            <CapabilityConditions conditions={conditions} />
          ) : null}
        </ActionRequiredState>
      ) : null}
      {display.kind === "in-progress" ? (
        <InProgressState {...display.props} />
      ) : null}
      {display.kind === "unknown" ? <UnknownState {...display.props} /> : null}
      {display.kind === "availability-unknown" ? (
        <AvailabilityUnknownState {...display.props} />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Mapping record {display.recordId} — spec/product/capability-mapping-records.md
      </p>
    </div>
  );
}
