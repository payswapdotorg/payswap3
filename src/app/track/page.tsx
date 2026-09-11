import type { Metadata } from "next";
import { Handshake, ListChecks, LockKeyhole, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TrackLookupForm } from "@/components/track/lookup-form";
import { getTrackingPort } from "@/lib/protocol/tracking-port";
import { resolveShellAudience } from "@/lib/shell-audience-server";

/**
 * UI-005 — the track entry/search surface.
 *
 * This surface tracks by reference for an authorized viewer: it is a
 * reference lookup, never a browse-all listing. The audience of the current
 * viewer is resolved server-side here and re-resolved (and role-checked at
 * the authority boundary) on every deep link to /track/[referenceId].
 */

export const metadata: Metadata = {
  title: "Track a payment — PaySwap",
  description:
    "Look up the current state, plain-language history, and proof trail of a tracked payment or settlement reference.",
};

const STATE_EXPLANATIONS: ReadonlyArray<readonly [string, string]> = [
  [
    "SUCCEEDED",
    "The outcome completed. The authority reports it, with the proof trail behind it.",
  ],
  [
    "FAILED",
    "The outcome did not complete. The reason and the next actions are reported.",
  ],
  [
    "IN_PROGRESS",
    "Something is happening right now. The page says what is happening and what completes it.",
  ],
  [
    "WAITING",
    "The outcome is waiting. The page always says why, what happens next, and which actions are available to you — or explicitly that none are available yet.",
  ],
  [
    "UNKNOWN",
    "The authority has not answered. The page says visibly that it is unknown, who resolves it, and what triggers a re-check.",
  ],
  [
    "ACTION_REQUIRED",
    "Someone must act. The page says what action, by when, and what happens if nothing is done.",
  ],
];

export default async function TrackPage() {
  const audience = await resolveShellAudience();
  const boundary = getTrackingPort().describeBoundary();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Track a payment</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Enter the reference you were given — from the payer, the merchant, or support. The
          current state, the plain-language history, and the complete proof trail for that
          reference are then shown, for viewers authorized to see them. This surface tracks by
          reference only: it never lists payments, and it shows no reference you did not look
          up.
        </p>
      </div>

      <div className="mt-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reference lookup</CardTitle>
            <CardDescription>
              The lookup itself runs server-side; the reference is resolved against the
              tracking authority, which decides what your role may see.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrackLookupForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">You are viewing as</CardTitle>
              <Badge variant="secondary">{audience}</Badge>
            </div>
            <CardDescription>
              Deep links to a reference reproduce the full status view, and are role-checked on
              direct entry: the viewer role is resolved server-side before anything renders.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-start gap-2 text-sm text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>
              If your role is not authorized for a reference, the view says so explicitly and
              shows nothing about its state, history, or evidence.
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-10" />

      <section aria-labelledby="track-states-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="track-states-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ListChecks aria-hidden="true" className="size-5 shrink-0" />
            Every tracked state is explicit
          </h2>
          <p className="text-sm text-muted-foreground">
            There is no ambiguous “pending” anywhere on this surface. A tracked outcome is
            always in exactly one of six states:
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {STATE_EXPLANATIONS.map(([state, explanation]) => (
            <li key={state}>
              <Card className="h-full">
                <CardContent className="space-y-1.5 p-4">
                  <p className="text-sm font-semibold tracking-wide">{state}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{explanation}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 space-y-4">
        <Alert>
          <ShieldQuestion aria-hidden="true" />
          <AlertTitle>What this surface does not do</AlertTitle>
          <AlertDescription>
            It does not decide outcomes, compute amounts, or produce evidence. States,
            histories, and proof records are answered by the authorities that own them and are
            only presented here. Evidence that has not been answered renders as unknown —
            never as a substitute.
          </AlertDescription>
        </Alert>
        <Alert>
          <Handshake aria-hidden="true" />
          <AlertTitle>Non-authoritative presentation</AlertTitle>
          <AlertDescription>
            Backed by a presentation-only mock while the live tracking adapter is ARRIVING
            (runtime {boundary.runtime}). Authority owner: {boundary.authorityOwner} (
            {boundary.authorityOwnerSource}).
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
