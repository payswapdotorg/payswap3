'use client';

/**
 * State transition demonstration (UI-001 verification; P4, P9).
 *
 * Demonstrates that state transitions are announced accessibly: a
 * persistent polite live region (StateAnnouncer) carries each transition
 * message, and the primitive re-renders with the new display state. The
 * sequence uses neutral demonstration fixtures — nothing is executed and
 * no financial semantics are involved. This is verification evidence, not
 * a product flow.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  InProgressState,
  SucceededState,
  StateAnnouncer,
  WaitingState,
} from '@/components/state';

interface DemoStep {
  readonly announce: string;
  readonly node: ReactNode;
}

const STEPS: readonly DemoStep[] = [
  {
    announce:
      'Reference operation: waiting. The demonstration authority reports the request is queued.',
    node: (
      <WaitingState
        whatIsWaiting="The reference operation is waiting"
        why="The demonstration authority reports the request is queued behind prior work"
        whatHappensNext="The authority processes the queue in order and reports the next state"
        reportedBy="Demonstration authority"
      />
    ),
  },
  {
    announce:
      'Reference operation: in progress. The demonstration authority is actively processing.',
    node: (
      <InProgressState
        whatIsHappening="The demonstration authority is actively processing the reference operation"
        whatCompletesIt="Processing completes when the authority reports a terminal state"
        reportedBy="Demonstration authority"
      />
    ),
  },
  {
    announce:
      'Reference operation: succeeded, as reported by the demonstration authority.',
    node: (
      <SucceededState
        outcome="The reference operation completed, as reported by the demonstration authority."
        reportedBy="Demonstration authority"
        evidence={{
          label: 'Inspect the demonstration record (evidence)',
          href: '#state-matrix',
        }}
      />
    ),
  },
];

export function StateTransitionDemo() {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        Demonstration only — a fixture sequence. Nothing is executed and no financial
        semantics are involved. Advance the state and observe the live region below.
      </p>
      <div>{current.node}</div>
      <StateAnnouncer message={current.announce} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStep((s) => (s + 1) % STEPS.length)}
          className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
        >
          Advance state ({step + 1}/{STEPS.length})
        </button>
        <button
          type="button"
          onClick={() => setStep(0)}
          className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-100"
        >
          Restart
        </button>
      </div>
    </div>
  );
}
