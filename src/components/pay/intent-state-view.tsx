'use client';

/**
 * Intent state presentation (UI-002, P4/P5/P6/P7).
 *
 * Every stateful thing on this page resolves to exactly one display state
 * from the shared primitives, and every displayed intent state originates
 * from the port — never from local memory, never optimistically. Absence
 * of an answer renders as UNKNOWN with its reconciliation path; a spinner
 * is never a verdict. The evidence trail is reachable from every
 * consequential outcome.
 *
 * `IntentSnapshotPresentation` is exported for the verification surface so
 * the state matrix renders through exactly the same presentation the
 * customer state page uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import {
  ActionRequiredState,
  FailedState,
  InProgressState,
  SucceededState,
  UnknownState,
  WaitingState,
} from '@/components/state';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { EnvironmentReport } from '@/lib/environment';
import type { IntentQueryResult, IntentStateSnapshot, StateReport } from '@/lib/protocol/intent-port';
import { getIntentPort } from '@/lib/protocol/intent-port';
import {
  BOUNDARY_MAPPING_RECORD_IDS,
  MAPPING_RECORD_IDS,
  intentDisplayState,
} from '@/lib/protocol/intent-state-mapping';
import { formatTimestamp } from '@/lib/pay-flow/money';
import { IntentBrief } from '@/components/pay/intent-brief';
import { EvidenceTrail } from '@/components/pay/evidence-trail';
import { FlowSteps } from '@/components/pay/flow-steps';
import { PayEnvironmentBanner } from '@/components/pay/pay-environment-banner';

type QueryPhase =
  | { kind: 'querying' }
  | { kind: 'answered'; result: IntentQueryResult }
  | { kind: 'rechecking'; previous: IntentQueryResult };

export function IntentStateView({
  intentId,
  environment,
}: {
  intentId: string;
  environment: EnvironmentReport;
}) {
  const port = useMemo(() => getIntentPort(), []);
  const [phase, setPhase] = useState<QueryPhase>({ kind: 'querying' });
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const stateFocusTarget = useRef<HTMLDivElement | null>(null);

  const query = useCallback(
    async () => {
      const result = await port.getIntentState(intentId);
      setPhase({ kind: 'answered', result });
      setLastCheckedAt(new Date().toISOString());
    },
    [intentId, port]
  );

  const recheck = useCallback(
    async () => {
      setPhase((current) =>
        current.kind === 'answered' ? { kind: 'rechecking', previous: current.result } : current
      );
      const result = await port.getIntentState(intentId);
      setPhase({ kind: 'answered', result });
      setLastCheckedAt(new Date().toISOString());
      requestAnimationFrame(() => stateFocusTarget.current?.focus());
    },
    [intentId, port]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch; setState happens after the awaited port query
    void query();
  }, [query]);

  const answered =
    phase.kind === 'answered'
      ? phase.result
      : phase.kind === 'rechecking'
        ? phase.previous
        : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <FlowSteps current="state" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Payment intent state</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reference <span className="font-mono text-xs">{intentId}</span>. This page shows exactly
          what the Intent Authority reports — acknowledged, failed, or explicitly unknown — and
          nothing else.
        </p>
      </header>

      <PayEnvironmentBanner environment={environment} />

      {phase.kind === 'querying' ? (
        <InProgressState
          whatIsHappening="Requesting the intent state from the Intent Authority."
          whatCompletesIt="The authority's response — an explicit state, or a reported UNKNOWN."
          reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
        >
          <p>
            {`Querying the (mock, non-authoritative) authority for reference ${intentId}. This is not a verdict — the state below resolves explicitly from the authority's response.`}
          </p>
        </InProgressState>
      ) : null}

      {phase.kind === 'rechecking' ? (
        <InProgressState
          whatIsHappening="Re-checking this intent with the Intent Authority."
          whatCompletesIt="Whatever the authority reports back — the same state, or another UNKNOWN."
          reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
        >
          <p>{`Re-querying reference ${intentId}. A re-check re-queries the authority and reports whatever comes back — including the same state, or another UNKNOWN.`}</p>
        </InProgressState>
      ) : null}

      {answered ? (
        <div ref={stateFocusTarget} tabIndex={-1} aria-label="Intent state, as reported">
          {answered.kind === 'snapshot' ? (
            <div className="flex flex-col gap-6">
              <IntentBrief
                data={{
                  amount: answered.snapshot.intent.amount,
                  currency: answered.snapshot.intent.currency,
                  recipientName: answered.snapshot.intent.recipientName,
                  sourceName: answered.snapshot.intent.sourceName,
                  customerReference: answered.snapshot.intent.customerReference,
                  intentRef: answered.snapshot.intent.intentId,
                  composedAt: answered.snapshot.intent.composedAt,
                }}
              />
              <IntentSnapshotPresentation
                snapshot={answered.snapshot}
                recheck={() => void recheck()}
                rechecking={phase.kind === 'rechecking'}
              />
              <LastCheckedNote
                lastCheckedAt={lastCheckedAt}
                recheck={() => void recheck()}
                rechecking={phase.kind === 'rechecking'}
              />
              <Separator />
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/pay"
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                >
                  <ArrowLeft aria-hidden="true" className="mr-1.5 h-4 w-4" />
                  Compose another intent
                </Link>
              </div>
            </div>
          ) : (
            <NoAnswerPresentation
              intentId={intentId}
              result={answered}
              lastCheckedAt={lastCheckedAt}
              recheck={() => void recheck()}
              rechecking={phase.kind === 'rechecking'}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Snapshot presentation: one authority state → one display state ────────
//
// Exported so the verification surface's state matrix renders through the
// exact same presentation the customer state page uses.

export interface IntentSnapshotPresentationProps {
  snapshot: IntentStateSnapshot;
  /** Optional protocol-authorized re-check action. */
  recheck?: () => void;
  rechecking?: boolean;
}

export function IntentSnapshotPresentation({
  snapshot,
  recheck,
  rechecking = false,
}: IntentSnapshotPresentationProps) {
  const report = snapshot.stateReport;
  const displayState = intentDisplayState(snapshot.authorityState);
  const sourceNote = [
    `Reported by: Intent Authority (mock, non-authoritative) at ${formatTimestamp(snapshot.reportedAt)}`,
    `Authority-reported state: ${snapshot.authorityState} (fixture vocabulary)`,
    `Mapping record: ${MAPPING_RECORD_IDS[snapshot.authorityState]} · spec/product/intent-mapping-records.md`,
    `Runtime boundary: ARRIVING — the protocol runtime program will own this report`,
  ].join(' · ');
  const evidence = <EvidenceTrail records={snapshot.evidence} />;

  switch (displayState) {
    case 'SUCCEEDED':
      return <AcknowledgedPresentation report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
    case 'FAILED':
      return <RejectedPresentation report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
    case 'UNKNOWN':
      return <UnresolvedPresentation intentId={snapshot.intentId} report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
    case 'WAITING':
      return <HeldPresentation report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
    case 'IN_PROGRESS':
      return <ProcessingPresentation report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
    case 'ACTION_REQUIRED':
      return <ActionRequestedPresentation report={report} evidence={evidence} sourceNote={sourceNote} recheck={recheck} rechecking={rechecking} />;
  }
}

function AcknowledgedPresentation({
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'acknowledged') return null;
  return (
    <SucceededState
      outcome="Acknowledged by the Intent Authority."
      reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
      evidence={{
        label: 'Inspect the full evidence trail for this acknowledgement',
        href: '#evidence-trail',
      }}
    >
      <p>{report.acknowledgementNote}</p>
      {recheck ? <div className="pt-2"><RecheckButton recheck={recheck} rechecking={rechecking} /></div> : null}
      <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Scope of this acknowledgement: the authority reported receipt and acceptance for
        processing. It has not reported settlement, finality, or completion — so none is shown
        here (N2).
      </p>
      <div id="evidence-trail">{evidence}</div>
    </SucceededState>
  );
}

function RejectedPresentation({
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'rejected') return null;
  return (
    <FailedState
      outcome="Rejected by the Intent Authority."
      reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
      reason={`${report.reason.code} — ${report.reason.message}`}
      nextActions={
        report.recoveryHint
          ? [report.recoveryHint]
          : ['The authority reported no recovery hint. No recovery action is offered here.']
      }
    >
      <p>The authority reported a rejection for this intent. A rejected intent does not move money.</p>
      <div className="flex flex-wrap gap-2 pt-2">
        {recheck ? <RecheckButton recheck={recheck} rechecking={rechecking} /> : null}
        <Link href="/pay" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'min-h-11' })}>
          Compose a new intent
        </Link>
      </div>
      <div id="evidence-trail">{evidence}</div>
    </FailedState>
  );
}

function UnresolvedPresentation({
  intentId,
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  intentId: string;
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'unresolved') return null;
  return (
    <UnknownState
      subject="It is not yet known whether this intent was accepted."
      explanation={`The authority reported this intent as unresolved: ${report.whatIsNotKnown}. There is no acceptance decision to show yet. UNKNOWN is not success and not failure.`}
      reconciliation={{
        whoResolves: report.reconciliation.whoResolves,
        recheckTrigger: report.reconciliation.note,
      }}
    >
      <p className="text-xs text-muted-foreground">
        Boundary record {BOUNDARY_MAPPING_RECORD_IDS.queryNoAnswer} covers the same display
        resolution when no answer is reachable at all.
      </p>
      {report.reconciliation.recheckAvailable && recheck ? (
        <div className="pt-2">
          <RecheckButton recheck={recheck} rechecking={rechecking} />
        </div>
      ) : null}
      <div id="evidence-trail">{evidence}</div>
    </UnknownState>
  );
}

function HeldPresentation({
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'held-for-recipient') return null;
  return (
    <WaitingState
      whatIsWaiting={report.whatIsWaiting}
      why={report.why}
      whatHappensNext={report.whatHappensNext}
      reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
      availableActions={
        report.cancelAuthorized
          ? ['Cancellation of this intent is authorized by the authority — the protocol path to exercise it ARRIVES with the runtime.']
          : undefined
      }
    >
      <p>
        The authority reported this intent is held pending the recipient. This is not terminal: it
        progresses when the authority reports the recipient&apos;s response.
      </p>
      {report.cancelAuthorized ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The authority reports cancellation of this intent is authorized — and the protocol path
          to exercise it ARRIVES with the runtime. Until that path exists, this surface offers no
          cancel control rather than bypass protocol authorization (N3).
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No action is available yet.</p>
      )}
      {recheck ? <div className="pt-2"><RecheckButton recheck={recheck} rechecking={rechecking} /></div> : null}
      <div id="evidence-trail">{evidence}</div>
    </WaitingState>
  );
}

function ProcessingPresentation({
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'processing') return null;
  return (
    <InProgressState
      whatIsHappening="The Intent Authority is processing this intent."
      whatCompletesIt="The authority's next report — an explicit state, never an inferred one."
      reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
    >
      <p>{report.activity}</p>
      <p className="text-sm text-muted-foreground">{report.asReported}</p>
      {recheck ? <div className="pt-2"><RecheckButton recheck={recheck} rechecking={rechecking} /></div> : null}
      <div id="evidence-trail">{evidence}</div>
    </InProgressState>
  );
}

function ActionRequestedPresentation({
  report,
  evidence,
  sourceNote,
  recheck,
  rechecking,
}: {
  report: StateReport;
  evidence: React.ReactNode;
  sourceNote: string;
  recheck?: () => void;
  rechecking?: boolean;
}) {
  if (report.kind !== 'action-requested') return null;
  return (
    <ActionRequiredState
      action={report.requestedAction}
      reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
      consequenceOfInaction={report.rationale}
    >
      <p>
        The Intent Authority reported that this intent needs something from you before it can
        proceed.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The requested action is exercised through the authority&rsquo;s protocol path, which
        ARRIVES with the runtime — this surface presents the request and never performs the
        action by a side channel (N3).
      </p>
      {recheck ? <div className="pt-2"><RecheckButton recheck={recheck} rechecking={rechecking} /></div> : null}
      <div id="evidence-trail">{evidence}</div>
    </ActionRequiredState>
  );
}

// ── No-answer presentation: explicit UNKNOWN with reconciliation ─────────

function NoAnswerPresentation({
  intentId,
  result,
  lastCheckedAt,
  recheck,
  rechecking,
}: {
  intentId: string;
  result: Extract<IntentQueryResult, { kind: 'no-answer' }>;
  lastCheckedAt: string | null;
  recheck: () => void;
  rechecking: boolean;
}) {
  const notYetKnown =
    result.reason === 'unreachable'
      ? 'Whether the Intent Authority holds a record for this reference — the authority cannot be reached right now.'
      : 'Whether the Intent Authority holds a record for this reference — no record is reachable in this session (the mock authority holds records in this browser session’s memory only).';
  return (
    <UnknownState
      subject="It is not yet known whether the authority holds this intent."
      explanation={`No authoritative answer is reachable for this reference. ${notYetKnown} UNKNOWN is a first-class state: never styled, worded, or counted as success or failure.`}
      reconciliation={{
        whoResolves: 'The Intent Authority (spec/architecture/v0.1, runtime ARRIVING)',
        recheckTrigger:
          'A re-check re-queries the authority and reports whatever comes back — including another UNKNOWN. Until the runtime lands, no durable record exists to fall back on, and this surface will not invent one.',
      }}
    >
      <p className="text-xs text-muted-foreground">
        {[
          `Boundary condition: ${result.reason} (mapping record ${BOUNDARY_MAPPING_RECORD_IDS.queryNoAnswer})`,
          result.note,
          `Reference: ${intentId}`,
        ].join(' · ')}
      </p>
      <div className="pt-2">
        <RecheckButton recheck={recheck} rechecking={rechecking} />
      </div>
      <LastCheckedNote lastCheckedAt={lastCheckedAt} recheck={recheck} rechecking={rechecking} embedded />
    </UnknownState>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────

function RecheckButton({ recheck, rechecking }: { recheck: () => void; rechecking?: boolean }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-11"
      onClick={recheck}
      disabled={rechecking}
    >
      <RefreshCw aria-hidden="true" className={`mr-1.5 h-4 w-4 ${rechecking ? 'animate-spin' : ''}`} />
      Re-check with the authority
    </Button>
  );
}

function LastCheckedNote({
  lastCheckedAt,
  recheck,
  rechecking,
  embedded = false,
}: {
  lastCheckedAt: string | null;
  recheck: () => void;
  rechecking: boolean;
  embedded?: boolean;
}) {
  if (!lastCheckedAt) return null;
  return (
    <p className={`text-xs text-muted-foreground ${embedded ? '' : 'pt-1'}`}>
      Last checked {formatTimestamp(lastCheckedAt)} — the authority reports the state above as of
      that query.{' '}
      <button
        type="button"
        onClick={recheck}
        disabled={rechecking}
        className="rounded font-medium text-foreground underline underline-offset-2 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Re-check now
      </button>
    </p>
  );
}
