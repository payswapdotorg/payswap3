/**
 * UI-008 — Renders a mapped display (from mediation-state-mapping.ts) with
 * the shared state primitives from @/components/state.
 *
 * The mapping module stays pure data; this block performs the one-to-one
 * render. It is hook-free and has no "use client" directive, so it renders
 * identically inside server pages and client views.
 *
 * Additional proof links beyond the primitive's single evidence reference
 * are rendered as children (the proof trail stays visible in full).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ActionRequiredState,
  AvailabilityUnknownState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from "@/components/state";
import type { MappedDisplay } from "@/lib/protocol/mediation-state-mapping";

export function DisplayStateBlock({
  display,
  children,
}: {
  display: MappedDisplay;
  children?: ReactNode;
}) {
  switch (display.primitive) {
    case "action-required":
      return <ActionRequiredState {...display.props}>{children}</ActionRequiredState>;
    case "in-progress":
      return <InProgressState {...display.props}>{children}</InProgressState>;
    case "waiting":
      return <WaitingState {...display.props}>{children}</WaitingState>;
    case "succeeded":
      return <SucceededState {...display.props}>{children}</SucceededState>;
    case "failed":
      return <FailedState {...display.props}>{children}</FailedState>;
    case "unknown":
      return <UnknownState {...display.props}>{children}</UnknownState>;
    case "availability-unknown":
      return <AvailabilityUnknownState {...display.props} />;
    default:
      return null;
  }
}

/** All proof links for a record, used as children inside a display block. */
export function AdditionalProofLinks({
  proof,
  excludeHref,
  heading = "Additional proof on this trail",
}: {
  proof: readonly { label: string; href: string }[];
  excludeHref?: string;
  heading?: string;
}) {
  const rest = proof.filter((entry) => entry.href !== excludeHref);
  if (rest.length === 0) return null;
  return (
    <div className="text-xs">
      <p className="font-medium text-foreground">{heading}</p>
      <ul className="mt-1 space-y-1">
        {rest.map((entry) => (
          <li key={`${entry.href}-${entry.label}`}>
            <Link
              href={entry.href}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
