import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Flow steps indicator (UI-002). Outcome-first orientation: compose →
 * review → explicit state. Presentation only — it does not imply any
 * protocol progress, only where the customer is in the product flow.
 */
const STEPS = [
  { key: 'compose', label: 'Compose' },
  { key: 'review', label: 'Review & submit' },
  { key: 'state', label: 'Intent state' },
] as const;

export type FlowStepKey = (typeof STEPS)[number]['key'];

export function FlowSteps({ current }: { current: FlowStepKey }) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);
  return (
    <ol aria-label="Flow steps" className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium',
                active && 'border-emerald-300 bg-emerald-50 text-emerald-800',
                done && 'border-emerald-200 bg-white text-emerald-700',
                !active && !done && 'border-border bg-muted/40 text-muted-foreground'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-emerald-700 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                )}
              >
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="text-muted-foreground/60">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
