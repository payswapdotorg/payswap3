/**
 * UI-004 — Capability headline status.
 *
 * The headline status line for one capability (progressive disclosure, P3):
 * the authority-reported state as a labeled badge plus its provenance note.
 * It is presentation of authority truth; it never evaluates anything.
 */
import {
  CheckCircle2,
  CloudOff,
  HelpCircle,
  ListChecks,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CapabilityItem } from "@/lib/protocol/capability-port";
import {
  describeCapabilityHeadline,
  resolveCapabilityDisplayState,
  type CapabilityDisplayStateKind,
  type CapabilityHeadlineTone,
} from "@/lib/protocol/capability-state-mapping";

const TONE_CLASSES: Record<CapabilityHeadlineTone, string> = {
  positive:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  negative:
    "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
  caution:
    "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  attention:
    "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  unknown:
    "border-dashed border-zinc-400 bg-zinc-50 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300",
};

const KIND_ICONS: Record<CapabilityDisplayStateKind, typeof CheckCircle2> = {
  succeeded: CheckCircle2,
  failed: XCircle,
  "action-required": ListChecks,
  "in-progress": Loader2,
  unknown: HelpCircle,
  "availability-unknown": CloudOff,
};

export function CapabilityHeadlineStatus({
  item,
}: {
  item: CapabilityItem;
}) {
  const headline = describeCapabilityHeadline(item);
  const display = resolveCapabilityDisplayState(item);
  const Icon = KIND_ICONS[display.kind];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Badge className={`${TONE_CLASSES[headline.tone]} gap-1`}>
        <Icon
          className={
            display.kind === "in-progress" ? "animate-spin" : undefined
          }
          aria-hidden="true"
        />
        {headline.label}
      </Badge>
      <span className="text-sm text-muted-foreground">{headline.note}</span>
    </div>
  );
}
