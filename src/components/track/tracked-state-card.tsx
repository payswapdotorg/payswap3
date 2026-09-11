import { Badge } from "@/components/ui/badge";
import {
  ActionRequiredState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from "@/components/state";
import type { TrackedCurrentState } from "@/lib/protocol/tracking-port";
import {
  WAITING_NO_ACTIONS_NOTE,
  mappingRecordId,
  resolveDisplayState,
  waitingHasNoActions,
  type DisplayStateDescriptor,
} from "@/lib/protocol/tracking-state-mapping";
import { formatAuthorityTime } from "./history-list";
import { cn } from "@/lib/utils";

/**
 * UI-005 — the current-state card of the tracking status view.
 *
 * Renders the tracked current state through the shared state primitives,
 * exactly as resolved by the display-state mapping (one-to-one, P4). The
 * state is always explicit: SUCCEEDED, FAILED, UNKNOWN, WAITING,
 * IN_PROGRESS, or ACTION_REQUIRED. Below the state, the card surfaces the
 * protocol-object/owning-authority mapping (P7) and the mapping-record id
 * for the nine-question record in spec/product/tracking-mapping-records.md.
 */

const BADGE_TONES: Readonly<Record<DisplayStateDescriptor["kind"], string>> = {
  succeeded:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  failed:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  "in-progress":
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  waiting:
    "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100",
  unknown:
    "border-zinc-400 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100",
  "action-required":
    "border-orange-400 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100",
};

function StatePrimitive({ descriptor }: { descriptor: DisplayStateDescriptor }) {
  switch (descriptor.primitive) {
    case "SucceededState":
      return <SucceededState {...descriptor.props} />;
    case "FailedState":
      return <FailedState {...descriptor.props} />;
    case "InProgressState":
      return <InProgressState {...descriptor.props} />;
    case "WaitingState":
      return (
        <WaitingState {...descriptor.props}>
          {waitingHasNoActions(descriptor) ? (
            <p className="text-sm font-medium">{WAITING_NO_ACTIONS_NOTE}</p>
          ) : null}
        </WaitingState>
      );
    case "UnknownState":
      return <UnknownState {...descriptor.props} />;
    case "ActionRequiredState":
      return <ActionRequiredState {...descriptor.props} />;
  }
}

export function TrackedStateCard({ currentState }: { currentState: TrackedCurrentState }) {
  const descriptor = resolveDisplayState(currentState);
  const recordId = mappingRecordId(currentState.state);

  return (
    <section aria-labelledby="track-current-state-heading" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="track-current-state-heading" className="text-lg font-semibold tracking-tight">
          Current state
        </h2>
        <Badge
          variant="outline"
          aria-label={`Current state: ${descriptor.label}`}
          className={cn("font-semibold", BADGE_TONES[descriptor.kind])}
        >
          {descriptor.label}
        </Badge>
      </div>

      <StatePrimitive descriptor={descriptor} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Protocol object: {currentState.protocolObject.objectType}{" "}
        <span className="font-mono">{currentState.protocolObject.objectId}</span> · Owning
        authority: {currentState.owningAuthority} · State since{" "}
        {formatAuthorityTime(currentState.since)} UTC · Mapping record{" "}
        <span className="font-mono">{recordId}</span>
      </p>
    </section>
  );
}
