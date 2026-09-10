import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EnvironmentReport } from '@/lib/environment';

/**
 * Environment framing for every consequential pay surface (UI-002, N4).
 * The signal is configuration-derived; this banner never decides the
 * environment, it only presents it. Sandbox money movement is never
 * presented as production financial effect.
 */
export function PayEnvironmentBanner({ environment }: { environment: EnvironmentReport }) {
  const sandbox = environment.kind === 'sandbox';
  return (
    <aside
      aria-label="Environment framing"
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-sm leading-relaxed',
        sandbox
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-emerald-300 bg-emerald-50 text-emerald-900'
      )}
    >
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {sandbox ? 'Sandbox environment — sandbox intent records only' : 'Production environment'}
        </p>
        <p className="text-xs leading-relaxed">
          {sandbox
            ? 'Submitting here creates a sandbox intent record in a non-authoritative mock of the Intent Authority. It has no production financial effect, and nothing on this surface will say it does.'
            : 'Outcomes shown reflect only what the owning protocol authority reports.'}
        </p>
        <p className="text-xs opacity-80">{environment.source}</p>
      </div>
    </aside>
  );
}
