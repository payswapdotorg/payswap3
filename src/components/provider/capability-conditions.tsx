/**
 * UI-004 — Capability conditions.
 *
 * Renders the authority-stated conditions of a conditional capability.
 * Conditions are presented as stated requirements — never as evaluated
 * met/unmet outcomes (that evaluation is authority-owned). Monetary
 * thresholds are authority-quoted and formatted with their explicit currency
 * via the UI-002 money module; the UI never computes them.
 */
import { CircleDashed } from "lucide-react";
import { formatMoney } from "@/lib/pay-flow/money";
import type { CapabilityCondition } from "@/lib/protocol/capability-port";

export function CapabilityConditions({
  conditions,
}: {
  conditions: readonly CapabilityCondition[];
}) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800/90 dark:text-amber-300/90">
        Authority-stated conditions
      </p>
      <ul className="space-y-2">
        {conditions.map((condition) => (
          <li
            key={condition.id}
            className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 dark:border-amber-700/40 dark:bg-amber-950/20"
          >
            <CircleDashed
              className="mt-0.5 size-4 shrink-0 opacity-60"
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm">{condition.label}</p>
              {condition.threshold ? (
                <p className="text-xs text-muted-foreground">
                  Authority-quoted threshold:{" "}
                  {condition.threshold.currency === "USD"
                    ? formatMoney(condition.threshold.amount, "USD")
                    : `${condition.threshold.amount} ${condition.threshold.currency}`}
                </p>
              ) : null}
              {condition.detail ? (
                <p className="text-xs text-muted-foreground">
                  {condition.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
