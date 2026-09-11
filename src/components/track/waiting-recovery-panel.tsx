"use client";

/**
 * Waiting recovery panel — UI-006 waiting/queued/delayed presentation ON the
 * track surface.
 *
 * Renders the authority-reported condition through the real state primitives
 * (WaitingState for conditions, UnknownState for UNKNOWN and
 * ended-still-unknown, SucceededState/FailedState for terminal endings) with:
 * - the reason as reported by the owning authority,
 * - the expectation of what happens next,
 * - the available user actions, or the explicit "no action is available yet",
 * - recovery actions as explicit, individually authorized buttons (disabled
 *   with the reason when not authorized),
 * - reconciliation visibility whenever UNKNOWN is shown.
 *
 * Boundaries: every recovery click routes through protocol authorization via
 * the waiting port; the panel never mutates financial state itself and never
 * presents an invented time or progress estimate as authoritative.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Ban, Loader2, RefreshCw, RotateCcw } from "lucide-react";
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
import {
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from "@/components/state";
import { formatMoney } from "@/lib/pay-flow/money";
import {
  getWaitingPort,
  type WaitingRecoveryAction,
  type WaitingRecoveryActionId,
  type WaitingRecoveryAuthorization,
  type WaitingRecoveryRequestResult,
  type WaitingSnapshot,
} from "@/lib/protocol/waiting-port";
import {
  fillWaitingAnnouncement,
  getWaitingDisplayPresentation,
  WAITING_MAPPING_DOC_PATH,
} from "@/lib/protocol/waiting-state-mapping";

// ---------------------------------------------------------------------------
// Accessible announcements (existing polite live-region pattern).
// ---------------------------------------------------------------------------

export interface WaitingStateAnnouncerProps {
  message: string;
}

/**
 * Polite live-region announcer for waiting states, following the existing
 * StateAnnouncer pattern: a visually hidden role="status" region whose content
 * is set after mount and on every change so assistive technology announces
 * waiting states when they mount or change.
 */
export function WaitingStateAnnouncer({ message }: WaitingStateAnnouncerProps) {
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    setAnnounced(message);
  }, [message]);
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announced}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Announcement builders (authority-quoted tokens only).
// ---------------------------------------------------------------------------

function snapshotAnnouncementTokens(snapshot: WaitingSnapshot): Record<string, string> {
  const reportedBy = `${snapshot.reportedBy} (reported ${snapshot.reportedAt})`;
  if (snapshot.snapshotKind === "condition") {
    return {
      whatIsWaiting: snapshot.whatIsWaiting,
      reason: snapshot.reason,
      expectation: snapshot.expectation,
      reportedBy,
    };
  }
  if (snapshot.snapshotKind === "unknown") {
    return {
      subject: snapshot.subject,
      explanation: snapshot.explanation,
      whoResolves: snapshot.reconciliation.whoResolves,
      recheckTrigger: snapshot.reconciliation.recheckTrigger,
      reportedBy,
    };
  }
  if (snapshot.outcome === "still-unknown" && snapshot.reconciliation) {
    return {
      outcomeDetail: snapshot.outcomeDetail,
      whoResolves: snapshot.reconciliation.whoResolves,
      recheckTrigger: snapshot.reconciliation.recheckTrigger,
      reportedBy,
    };
  }
  return {
    outcomeDetail: snapshot.outcomeDetail,
    failureReason: snapshot.failureReason ?? "",
    reportedBy,
  };
}

function buildSnapshotAnnouncement(snapshot: WaitingSnapshot): string {
  const presentation = getWaitingDisplayPresentation(snapshot.authorityStateId);
  return fillWaitingAnnouncement(
    presentation.announcementTemplate,
    snapshotAnnouncementTokens(snapshot),
  );
}

function buildRecoveryResultAnnouncement(result: WaitingRecoveryRequestResult): string {
  const presentation = getWaitingDisplayPresentation(result.authorityStateId);
  return fillWaitingAnnouncement(presentation.announcementTemplate, {
    actionId: result.actionId,
    reason: result.status === "denied" ? result.reason : "",
    whatHappensNext: result.status === "accepted" ? result.whatHappensNext : "",
  });
}

// ---------------------------------------------------------------------------
// Recovery result rendering.
// ---------------------------------------------------------------------------

const RECOVERY_ACTION_ICON: Readonly<Record<WaitingRecoveryActionId, ReactNode>> = {
  retry: <RotateCcw aria-hidden />,
  cancel: <Ban aria-hidden />,
  escalate: <ArrowUpRight aria-hidden />,
};

function RecoveryResultCard({ result }: { result: WaitingRecoveryRequestResult }) {
  const presentation = getWaitingDisplayPresentation(result.authorityStateId);
  if (result.status === "accepted") {
    return (
      <div className="grid gap-2">
        <InProgressState
          whatIsHappening={`${result.actionId} request routed to ${result.routedTo}`}
          whatCompletesIt="The authority completes the evaluation and publishes the outcome to this surface"
          reportedBy={result.routedTo}
        >
          <p className="text-sm">{result.whatHappensNext}</p>
          <p className="text-sm text-muted-foreground">
            What you will see next: {result.whatUserSeesNext}
          </p>
          <p className="text-xs text-muted-foreground">
            Requesting did not change any financial state; only the authority&apos;s decision
            does, and it is reported here. Mapping record {presentation.recordId} (
            {WAITING_MAPPING_DOC_PATH}).
          </p>
        </InProgressState>
      </div>
    );
  }
  return (
    <Alert>
      <AlertTitle>Not authorized — no request was routed</AlertTitle>
      <AlertDescription>
        {result.reason}
        <span className="mt-1 block text-xs">
          The denial is itself an authorized outcome: no recovery happens silently. Mapping
          record {presentation.recordId}.
        </span>
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// The panel.
// ---------------------------------------------------------------------------

export interface WaitingRecoveryPanelProps {
  /** Authority-reported waiting snapshot for the current viewer. */
  snapshot: WaitingSnapshot;
  /** Compact rendering for matrix cells. */
  compact?: boolean;
  /** Whether waiting states are announced via the polite live region. */
  announce?: boolean;
  /** Optional observer for announcements (verification evidence). */
  onAnnounce?: (message: string) => void;
}

type RecoveryResults = Partial<Record<WaitingRecoveryActionId, WaitingRecoveryRequestResult>>;

const NONE_YET_LABEL = "No action is available yet";

export function WaitingRecoveryPanel({
  snapshot,
  compact = false,
  announce = true,
  onAnnounce,
}: WaitingRecoveryPanelProps) {
  const [localSnapshot, setLocalSnapshot] = useState<WaitingSnapshot>(snapshot);
  const [results, setResults] = useState<RecoveryResults>({});
  const [pendingAction, setPendingAction] = useState<WaitingRecoveryActionId | null>(null);
  const [announcement, setAnnouncement] = useState<string>(
    buildSnapshotAnnouncement(snapshot),
  );
  const instanceId = useId();

  // Adopt prop changes (server re-render or harness scripting).
  useEffect(() => {
    setLocalSnapshot(snapshot);
    setResults({});
  }, [snapshot]);

  const onAnnounceRef = useRef(onAnnounce);
  useEffect(() => {
    onAnnounceRef.current = onAnnounce;
  });

  const snapshotAnnouncement = useMemo(
    () => buildSnapshotAnnouncement(localSnapshot),
    [localSnapshot],
  );

  // Announce on mount and whenever the waiting state changes.
  useEffect(() => {
    setAnnouncement(snapshotAnnouncement);
    if (announce) {
      onAnnounceRef.current?.(snapshotAnnouncement);
    }
  }, [snapshotAnnouncement, announce]);

  const requery = useCallback(() => {
    const lookup = getWaitingPort().lookupWaiting(
      localSnapshot.referenceId,
      localSnapshot.viewerRole,
    );
    if (lookup.status === "found") {
      setLocalSnapshot(lookup.snapshot);
    }
  }, [localSnapshot.referenceId, localSnapshot.viewerRole]);

  const requestRecoveryFor = useCallback(
    (action: WaitingRecoveryAction) => {
      setPendingAction(action.actionId);
      try {
        const result = getWaitingPort().requestRecovery({
          referenceId: localSnapshot.referenceId,
          actionId: action.actionId,
          requestedByRole: localSnapshot.viewerRole,
        });
        setResults((previous) => ({ ...previous, [action.actionId]: result }));
        const resultAnnouncement = buildRecoveryResultAnnouncement(result);
        setAnnouncement(resultAnnouncement);
        if (announce) {
          onAnnounceRef.current?.(resultAnnouncement);
        }
      } finally {
        setPendingAction(null);
      }
    },
    [announce, localSnapshot.referenceId, localSnapshot.viewerRole],
  );

  const presentation = getWaitingDisplayPresentation(localSnapshot.authorityStateId);
  const s = localSnapshot;

  const authorizedLabels = s.recovery
    .filter((action) => action.authorization.status === "authorized")
    .map((action) => action.label);
  const inquiryLabel = s.inquiry.available ? ["Request a re-check"] : [];
  const availableActions =
    authorizedLabels.length + inquiryLabel.length > 0
      ? [...authorizedLabels, ...inquiryLabel]
      : [NONE_YET_LABEL];
  const noActionYet =
    authorizedLabels.length === 0 && !s.inquiry.available;
  const notAuthorizedReason = s.recovery
    .map((action) => action.authorization)
    .find(
      (authorization): authorization is Extract<
        WaitingRecoveryAuthorization,
        { status: "not-authorized" }
      > => authorization.status === "not-authorized",
    )?.reason;
  const noneYetExplanation = s.authorityNote ?? notAuthorizedReason ?? "";

  const reportedByLine = `${s.reportedBy} — reported ${s.reportedAt}`;

  const recoveryArea = (
    <div className={compact ? "grid gap-2" : "grid gap-3"}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recovery actions
      </p>
      {!compact ? (
        <p className="text-xs text-muted-foreground">
          Each action is individually authorized per protocol. Requesting routes through
          protocol authorization and never silently changes financial state; the
          authority&apos;s decision is reported here.
        </p>
      ) : null}
      {s.recovery.map((action) => {
        const authorized = action.authorization.status === "authorized";
        const result = results[action.actionId];
        return (
          <div key={action.actionId} className="grid gap-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!authorized || pendingAction === action.actionId}
                onClick={() => requestRecoveryFor(action)}
                aria-describedby={`${instanceId}-${action.actionId}-reason`}
              >
                {pendingAction === action.actionId ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  RECOVERY_ACTION_ICON[action.actionId]
                )}
                {action.label}
              </Button>
              {authorized ? (
                <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                  Authorized
                </Badge>
              ) : (
                <Badge variant="secondary">Not authorized</Badge>
              )}
              <span className="text-xs text-muted-foreground">{action.requestedEffect}</span>
            </div>
            {!compact ? (
              <p className="text-xs text-muted-foreground">{action.description}</p>
            ) : null}
            <p id={`${instanceId}-${action.actionId}-reason`} className="text-xs">
              {authorized
                ? `Authorization: ${action.authorization.basis}`
                : `Not authorized: ${action.authorization.reason}`}
            </p>
            {result ? <RecoveryResultCard result={result} /> : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <Card className="grid gap-0">
      <CardHeader className={compact ? "pb-2" : "pb-4"}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>Waiting detail</span>
          <Badge variant="secondary">{presentation.surfaceLabel}</Badge>
          <Badge variant="outline">{presentation.recordId}</Badge>
          <Badge variant="outline">{s.snapshotKind === "condition" ? s.conditionKind : presentation.displayKind}</Badge>
          <Badge variant="secondary" className="ml-auto">
            mock ARRIVING
          </Badge>
        </CardTitle>
        <CardDescription>
          Reference <span className="font-medium">{s.referenceId}</span> — {s.intentSummary}.
          Amount (authority-quoted): {formatMoney(s.amount.value, s.amount.currency)}.
        </CardDescription>
        {!compact ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              Authority: {s.reportedBy} (reported {s.reportedAt})
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={requery}
              className="ml-auto"
            >
              <RefreshCw aria-hidden />
              Re-query waiting state
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <WaitingStateAnnouncer message={announce ? announcement : ""} />

        {s.snapshotKind === "condition" ? (
          <WaitingState
            whatIsWaiting={s.whatIsWaiting}
            why={s.reason}
            whatHappensNext={s.expectation}
            reportedBy={reportedByLine}
            availableActions={availableActions}
          >
            {s.authorityNote ? (
              <p className="text-xs text-muted-foreground">{s.authorityNote}</p>
            ) : null}
            {noActionYet ? (
              <p className="text-sm font-medium">{NONE_YET_LABEL}</p>
            ) : null}
            {noActionYet && noneYetExplanation ? (
              <p className="text-xs text-muted-foreground">{noneYetExplanation}</p>
            ) : null}
            {recoveryArea}
          </WaitingState>
        ) : null}

        {s.snapshotKind === "unknown" ? (
          <UnknownState
            subject={s.subject}
            explanation={s.explanation}
            reconciliation={{
              whoResolves: s.reconciliation.whoResolves,
              recheckTrigger: s.reconciliation.recheckTrigger,
            }}
          >
            <div className="grid gap-0.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What you will see next
              </p>
              <p className="text-sm">{s.reconciliation.whatUserSeesNext}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              This is UNKNOWN, not failure and not success. The preceding wait: {s.waitedFor}
            </p>
            {recoveryArea}
          </UnknownState>
        ) : null}

        {s.snapshotKind === "resolution" && s.outcome === "succeeded" ? (
          <SucceededState
            outcome={s.outcomeDetail}
            reportedBy={reportedByLine}
            evidence={
              s.evidence && s.evidence.length > 0
                ? s.evidence[0]
                : { label: "Authority record (mock)", href: `/track/${s.referenceId}` }
            }
          >
            {s.evidence && s.evidence.length > 1 ? (
              <ul className="list-disc space-y-0.5 pl-4 text-sm">
                {s.evidence.slice(1).map((ref) => (
                  <li key={ref.href}>
                    <a href={ref.href} className="underline underline-offset-4">
                      {ref.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {recoveryArea}
          </SucceededState>
        ) : null}

        {s.snapshotKind === "resolution" && s.outcome === "failed" ? (
          <FailedState
            outcome={s.outcomeDetail}
            reportedBy={reportedByLine}
            reason={s.failureReason}
            nextActions={s.nextActions}
          >
            {recoveryArea}
          </FailedState>
        ) : null}

        {s.snapshotKind === "resolution" && s.outcome === "still-unknown" ? (
          <UnknownState
            subject={s.subject ?? "The outcome of this fulfillment"}
            explanation={s.outcomeDetail}
            reconciliation={
              s.reconciliation
                ? {
                    whoResolves: s.reconciliation.whoResolves,
                    recheckTrigger: s.reconciliation.recheckTrigger,
                  }
                : undefined
            }
          >
            {s.reconciliation ? (
              <div className="grid gap-0.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  What you will see next
                </p>
                <p className="text-sm">{s.reconciliation.whatUserSeesNext}</p>
              </div>
            ) : null}
            {s.authorityNote ? (
              <p className="text-xs text-muted-foreground">{s.authorityNote}</p>
            ) : null}
            {recoveryArea}
          </UnknownState>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Mapping record {presentation.recordId} of {WAITING_MAPPING_DOC_PATH}. Mock backing —
          presentation-only, NON-AUTHORITATIVE; the Fulfillment/Queue Authority implementation
          is ARRIVING. No completion time is estimated unless the authority reports one.
        </p>
      </CardContent>
    </Card>
  );
}
