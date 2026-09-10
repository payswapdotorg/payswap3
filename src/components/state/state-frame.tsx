/**
 * Shared frame for the state display primitives (UI-001).
 *
 * Each display state gets a distinct visual treatment — its own icon shape,
 * border style, tint, and label word — so color never carries the
 * distinction alone (P4, P5, P9):
 *
 *   SUCCEEDED       solid border, emerald tint, circle-check icon
 *   FAILED          solid border + thick left accent, rose tint, octagon-X icon
 *   UNKNOWN         dashed border, amber tint, circle-question icon
 *   WAITING         dotted border, stone tint, clock icon
 *   IN_PROGRESS     solid border + animated progress strip, teal tint, spinning arc
 *   ACTION_REQUIRED double border, orange tint, bell icon
 *
 * The frame is internal to the state primitives; surfaces consume the six
 * state components (never the frame directly).
 */

import type { ReactNode } from 'react';
import type { DisplayState } from './display-state';
import { STATE_LABELS, UNKNOWN_DISAMBIGUATION } from './display-state';

interface StateFrameProps {
  readonly state: DisplayState;
  readonly icon: ReactNode;
  /**
   * ARIA semantics: assertive alerts for states the user must not miss
   * (FAILED, ACTION_REQUIRED); polite status for the rest. Live-region
   * behavior of these roles is what makes state transitions announceable
   * when the owning surface keeps the region mounted.
   */
  readonly role: 'status' | 'alert';
  readonly children: ReactNode;
}

const FRAME_TREATMENTS: Readonly<Record<DisplayState, string>> = {
  SUCCEEDED: 'border-2 border-solid border-emerald-400 bg-emerald-50',
  FAILED: 'border-2 border-solid border-rose-400 bg-rose-50 border-l-8 border-l-rose-600',
  UNKNOWN: 'border-2 border-dashed border-amber-400 bg-amber-50',
  WAITING: 'border-2 border-dotted border-stone-400 bg-stone-100',
  IN_PROGRESS: 'border-2 border-solid border-teal-400 bg-teal-50',
  ACTION_REQUIRED: 'border-4 border-double border-orange-500 bg-orange-50',
};

const CHIP_TREATMENTS: Readonly<Record<DisplayState, string>> = {
  SUCCEEDED: 'border-emerald-400 bg-emerald-100 text-emerald-900',
  FAILED: 'border-rose-400 bg-rose-100 text-rose-900',
  UNKNOWN: 'border-amber-400 bg-amber-100 text-amber-900',
  WAITING: 'border-stone-500 bg-stone-200 text-stone-900',
  IN_PROGRESS: 'border-teal-400 bg-teal-100 text-teal-900',
  ACTION_REQUIRED: 'border-orange-400 bg-orange-100 text-orange-900',
};

const ICON_TREATMENTS: Readonly<Record<DisplayState, string>> = {
  SUCCEEDED: 'text-emerald-700',
  FAILED: 'text-rose-700',
  UNKNOWN: 'text-amber-700',
  WAITING: 'text-stone-700',
  IN_PROGRESS: 'text-teal-700',
  ACTION_REQUIRED: 'text-orange-700',
};

export function StateFrame({ state, icon, role, children }: StateFrameProps) {
  return (
    <div
      role={role}
      className={`ps-state-frame rounded-xl p-4 sm:p-5 ${FRAME_TREATMENTS[state]}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/80 ${ICON_TREATMENTS[state]}`}
        >
          {icon}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${CHIP_TREATMENTS[state]}`}
        >
          {STATE_LABELS[state]}
        </span>
      </div>
      <div className="mt-3 space-y-2 text-sm text-stone-800">{children}</div>
      {state === 'UNKNOWN' && (
        <p className="mt-3 border-t border-dashed border-amber-300 pt-2 text-xs font-medium text-amber-900">
          {UNKNOWN_DISAMBIGUATION}
        </p>
      )}
      {state === 'IN_PROGRESS' && (
        <div className="ps-strip mt-3" aria-hidden="true" />
      )}
    </div>
  );
}
