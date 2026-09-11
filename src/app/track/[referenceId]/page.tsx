import type { Metadata } from "next";
import { getTrackingPort } from "@/lib/protocol/tracking-port";
import { resolveShellAudience } from "@/lib/shell-audience-server";
import { TrackingStatusView } from "@/components/track/tracking-status-view";
import {
  TrackNotFoundView,
  TrackNotAuthorizedView,
} from "@/components/track/lookup-result-views";

/**
 * UI-005 — the deep-linkable tracking status view.
 *
 * Deep links reproduce the full status view: everything on this page is
 * resolved server-side from the reference in the URL — nothing depends on
 * client-side state. Direct entry is role-checked:
 *
 *   1. The viewer's audience is resolved server-side via
 *      resolveShellAudience() (least-visibility fallback: 'unauthenticated').
 *   2. The resolved audience is passed to the tracking port, where the
 *      authority boundary performs the per-reference authorization.
 *   3. Only an authorized audience ever receives the tracked view; every
 *      other audience gets an explicit NOT AUTHORIZED result that reveals no
 *      state, history, or evidence. A reference that matches nothing gets an
 *      explicit NOT FOUND result.
 *
 * Per audience on direct entry (mock session records):
 *   - unauthenticated -> not authorized for every reference (no anonymous tracking)
 *   - customer        -> tracked for payment-intent references; not authorized for settlements
 *   - merchant        -> tracked for payment-intent and settlement references
 *   - provider        -> tracked for settlement references; not authorized for payment intents
 *   - operator        -> tracked for every reference
 *   - administrator   -> tracked for every reference
 */

interface TrackReferencePageProps {
  params: Promise<{ referenceId: string }>;
}

export async function generateMetadata({
  params,
}: TrackReferencePageProps): Promise<Metadata> {
  const { referenceId } = await params;
  const decoded = decodeURIComponent(referenceId);
  return {
    title: `Tracking ${decoded} — PaySwap`,
    description:
      "The explicit current state, plain-language history, and complete proof trail for a tracked reference.",
  };
}

export default async function TrackReferencePage({ params }: TrackReferencePageProps) {
  const { referenceId } = await params;
  const decodedReference = decodeURIComponent(referenceId);

  const audience = await resolveShellAudience();
  const port = getTrackingPort();
  const result = await port.lookupReference(decodedReference, audience);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      {result.kind === "tracked" ? (
        <TrackingStatusView view={result.view} boundary={port.describeBoundary()} />
      ) : result.kind === "not-found" ? (
        <TrackNotFoundView result={result} />
      ) : (
        <TrackNotAuthorizedView result={result} />
      )}
    </main>
  );
}
