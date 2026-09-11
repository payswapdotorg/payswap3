"use client";

/**
 * Waiting inquiry form — UI-006 re-check request surface.
 *
 * Where the track surface lets an authorized user request a re-check of the
 * authoritative state. The wording is explicit about what happens next, and it
 * never presents an invented ETA as authoritative: no completion time is
 * estimated unless the authority reports one. A re-check request does not
 * force an outcome and does not change any financial state; it attaches to the
 * authority's reconciliation sweep.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, SearchCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InProgressState } from "@/components/state";
import {
  getWaitingPort,
  type WaitingInquiryAvailability,
  type WaitingInquiryResult,
  type WaitingViewerRole,
} from "@/lib/protocol/waiting-port";
import {
  fillWaitingAnnouncement,
  getWaitingDisplayPresentation,
} from "@/lib/protocol/waiting-state-mapping";
import { WaitingStateAnnouncer } from "@/components/track/waiting-recovery-panel";

function buildInquiryAnnouncement(result: WaitingInquiryResult): string {
  const presentation = getWaitingDisplayPresentation(result.authorityStateId);
  return fillWaitingAnnouncement(presentation.announcementTemplate, {
    reason: result.status === "rejected" ? result.reason : "",
    whatHappensNext: result.status === "accepted" ? result.whatHappensNext : "",
  });
}

function InquiryResultCard({ result }: { result: WaitingInquiryResult }) {
  const presentation = getWaitingDisplayPresentation(result.authorityStateId);
  if (result.status === "accepted") {
    return (
      <div className="grid gap-2">
        <InProgressState
          whatIsHappening={`Re-check request routed to ${result.routedTo}`}
          whatCompletesIt="The reconciliation sweep re-checks the authoritative state and publishes the result to this surface"
          reportedBy={result.routedTo}
        >
          <div className="grid gap-1 text-sm">
            <p>
              <span className="font-medium">Who re-checks:</span> {result.whoResolves}
            </p>
            <p>
              <span className="font-medium">What triggers the re-check:</span>{" "}
              {result.recheckTrigger}
            </p>
            <p>
              <span className="font-medium">What happens next:</span> {result.whatHappensNext}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">What you will see:</span> {result.whatUserSeesNext}
            </p>
            <p className="text-xs text-muted-foreground">
              No completion time is estimated. A re-check request does not force an outcome and
              does not change any financial state. Mapping record {presentation.recordId}.
            </p>
          </div>
        </InProgressState>
      </div>
    );
  }
  return (
    <Alert>
      <AlertTitle>Re-check request not accepted</AlertTitle>
      <AlertDescription>
        {result.reason}
        <span className="mt-1 block text-xs">
          Nothing was routed and nothing changed. Mapping record {presentation.recordId}.
        </span>
      </AlertDescription>
    </Alert>
  );
}

export interface WaitingInquiryFormProps {
  referenceId: string;
  viewerRole: WaitingViewerRole;
  /** Per-reference, per-role inquiry availability from the waiting snapshot. */
  inquiry: WaitingInquiryAvailability;
  /** Optional observer for announcements (verification evidence). */
  onAnnounce?: (message: string) => void;
}

export function WaitingInquiryForm({
  referenceId,
  viewerRole,
  inquiry,
  onAnnounce,
}: WaitingInquiryFormProps) {
  const [result, setResult] = useState<WaitingInquiryResult | null>(null);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const onAnnounceRef = useRef(onAnnounce);
  useEffect(() => {
    onAnnounceRef.current = onAnnounce;
  });

  // A new inquiry availability (new snapshot) resets the previous result.
  useEffect(() => {
    setResult(null);
  }, [inquiry]);

  const submit = useCallback(() => {
    setPending(true);
    try {
      const requestResult = getWaitingPort().requestRecheck({
        referenceId,
        requestedByRole: viewerRole,
      });
      setResult(requestResult);
      const message = buildInquiryAnnouncement(requestResult);
      setAnnouncement(message);
      onAnnounceRef.current?.(message);
    } finally {
      setPending(false);
    }
  }, [referenceId, viewerRole]);

  return (
    <Card className="grid gap-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>Request a re-check</span>
          <Badge variant="outline">{inquiry.available ? "available" : "not available"}</Badge>
        </CardTitle>
        <CardDescription>
          Ask the Fulfillment/Queue Authority to re-check the authoritative state of{" "}
          <span className="font-medium">{referenceId}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <WaitingStateAnnouncer message={announcement} />

        {inquiry.available ? (
          <div className="grid gap-3 text-sm">
            <p>
              <span className="font-medium">What happens next:</span> {inquiry.whatHappensNext}
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium">What you will see:</span> this page reports what the
              sweep publishes — an explicit terminal state, or explicitly-still-unknown with the
              continuing reconciliation path.
            </p>
            <p className="text-xs text-muted-foreground">
              No completion time is estimated; the authority reports timing only when it reports
              the result. A re-check request does not force an outcome and does not change any
              financial state.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={submit}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <SearchCheck aria-hidden />
                )}
                Request a re-check
              </Button>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertTitle>Re-check requests are not available here</AlertTitle>
            <AlertDescription>
              {inquiry.notAvailableReason ??
                "Your current role does not request re-checks on this reference through this surface."}
              <span className="mt-1 block text-xs">
                The state itself stays visible above, including its reconciliation path when it
                is unknown — there is no dead end.
              </span>
            </AlertDescription>
          </Alert>
        )}

        {result ? <InquiryResultCard result={result} /> : null}
      </CardContent>
    </Card>
  );
}
