'use client';

/**
 * Review + explicit submit step (UI-002, P2/P3/N3/N5).
 *
 * The complete intent and its plain-language consequences are visible
 * before the committing action — nothing decision-relevant is collapsed
 * or hidden. Only secondary technical detail is one deliberate step away.
 *
 * The submit is explicit and single-intent: one checkbox the customer
 * checks (never pre-checked), one button, one intent. Acceptance is never
 * fabricated or assumed here — after the submit, the state comes from
 * the port, and only from the port.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { ArrowLeft, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  FailedState,
  InProgressState,
  UnknownState,
} from '@/components/state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { EnvironmentReport } from '@/lib/environment';
import type {
  CompositionOptions,
  ConsequenceReportResult,
  IntentConsequenceReport,
  IntentDraft,
} from '@/lib/protocol/intent-port';
import { getIntentPort } from '@/lib/protocol/intent-port';
import { formatMoney, formatTimestamp } from '@/lib/pay-flow/money';
import { usePayDraftStore, type PayFlowDraft } from '@/lib/pay-flow/draft-store';
import { IntentBrief } from '@/components/pay/intent-brief';
import { FlowSteps } from '@/components/pay/flow-steps';
import { PayEnvironmentBanner } from '@/components/pay/pay-environment-banner';

type SubmitPhase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'refused'; reason: string; note: string };

export function ReviewIntentView({ environment }: { environment: EnvironmentReport }) {
  const router = useRouter();
  const port = useMemo(() => getIntentPort(), []);
  const draft = usePayDraftStore((state) => state.draft);
  const storedReport = usePayDraftStore((state) => state.consequenceReport);
  const setConsequenceReport = usePayDraftStore((state) => state.setConsequenceReport);
  const clearFlow = usePayDraftStore((state) => state.clearFlow);

  const compositionOptions = useMemo(() => port.getCompositionOptions(), [port]);

  const [freshTerms, setFreshTerms] = useState<ConsequenceReportResult | null>(null);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>({ kind: 'idle' });
  const [acknowledged, setAcknowledged] = useState(false);
  const focusTarget = useRef<HTMLDivElement | null>(null);

  const intentDraft: IntentDraft | null = useMemo(
    () => (draft ? buildDraftFromStore(draft, compositionOptions) : null),
    [draft, compositionOptions]
  );

  // The report shown: either freshly quoted this mount, or the port-issued
  // report stored earlier in this session for the same draft.
  const report: IntentConsequenceReport | null =
    freshTerms?.kind === 'report'
      ? freshTerms.report
      : intentDraft && storedReport && matchesStoredDraft(storedReport, intentDraft)
        ? storedReport
        : null;

  const needsQuote = intentDraft !== null && report === null && freshTerms === null;

  const requestQuote = useCallback(
    async (target: IntentDraft) => {
      const result = await port.requestConsequenceReport(target);
      setFreshTerms(result);
      if (result.kind === 'report') {
        setConsequenceReport(result.report);
      } else {
        setConsequenceReport(null);
      }
    },
    [port, setConsequenceReport]
  );

  useEffect(() => {
    if (!needsQuote || !intentDraft) return;
    let cancelled = false;
    void port
      .requestConsequenceReport(intentDraft)
      .then((result) => {
        if (cancelled) return;
        setFreshTerms(result);
        setConsequenceReport(result.kind === 'report' ? result.report : null);
      })
      .catch(() => {
        if (cancelled) return;
        setFreshTerms({ kind: 'no-answer', note: 'The request for consequence terms failed at the transport level.' });
        setConsequenceReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [needsQuote, intentDraft, port, setConsequenceReport]);

  async function onSubmit() {
    if (!intentDraft || !report || submitPhase.kind !== 'idle') return;
    setSubmitPhase({ kind: 'submitting' });
    const result = await port.submitIntent(intentDraft, {
      explicitUserSubmit: true,
      consequenceReportId: report.reportId,
      draftFingerprint: report.draftFingerprint,
    });
    if (result.kind === 'transported') {
      clearFlow();
      router.push(`/pay/${result.intentId}`);
      return;
    }
    if (result.kind === 'not-transported') {
      clearFlow();
      router.push(`/pay/${result.submissionRef}`);
      return;
    }
    // A boundary refusal is not an intent state: it is presented as an
    // explicit, actionable product-boundary failure — never as the
    // authority rejecting the intent.
    setSubmitPhase({ kind: 'refused', reason: result.reason, note: result.note });
    requestAnimationFrame(() => focusTarget.current?.focus());
  }

  if (!draft || !intentDraft) {
    return <NoDraftState />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <FlowSteps current="review" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Review the full consequences
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Everything below is part of the decision. Nothing consequential is hidden behind a
          collapsed control; only the technical payload is inspectable as secondary detail.
        </p>
      </header>

      <PayEnvironmentBanner environment={environment} />

      {report ? (
        <>
          <IntentBrief
            data={{
              amount: draft.amount,
              currency: 'USD',
              recipientName:
                compositionOptions.recipients.find((party) => party.id === draft.recipientId)
                  ?.displayName ?? '',
              sourceName:
                compositionOptions.sources.find((party) => party.id === draft.sourceId)
                  ?.displayName ?? '',
              customerReference: draft.customerReference.trim() || undefined,
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Consequences, as quoted by the authority side
              </CardTitle>
              <CardDescription>
                Quoted at {formatTimestamp(report.quotedAt)} · report{' '}
                <span className="font-mono text-xs">{report.reportId}</span> · the product did not
                compute any of this.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Amount
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold">
                    {formatMoney(report.amount, report.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Fee, as quoted
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold">
                    {formatMoney(report.feeQuoted, report.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Total if it proceeds
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold">
                    {formatMoney(report.totalQuoted, report.currency)}
                  </dd>
                </div>
              </dl>

              <ul className="flex flex-col gap-4" role="list">
                {report.terms.map((term) => (
                  <li key={term.id} className="border-l-2 border-emerald-700/40 pl-4">
                    <h3 className="text-sm font-semibold">{term.label}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {term.statement}
                    </p>
                  </li>
                ))}
              </ul>

              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <ShieldAlert aria-hidden="true" className="h-4 w-4" />
                <AlertTitle>What this is, and is not</AlertTitle>
                <AlertDescription className="text-amber-900/90">
                  {report.boundaryNote}
                </AlertDescription>
              </Alert>

              <Collapsible>
                <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  <FileText aria-hidden="true" className="h-4 w-4" />
                  Inspect the technical payload this submit will carry (secondary detail)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
                    {JSON.stringify(
                      {
                        outcomeKind: 'send-payment',
                        outcomeStatement: draft.outcomeStatement,
                        amount: draft.amount,
                        currency: report.currency,
                        recipientId: draft.recipientId,
                        sourceId: draft.sourceId,
                        customerReference: draft.customerReference.trim() || null,
                        consequenceReportId: report.reportId,
                      },
                      null,
                      2
                    )}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Separator />

          <section aria-labelledby="submit-heading" className="flex flex-col gap-4">
            <h2 id="submit-heading" className="text-lg font-semibold">
              Submit — explicitly, one intent
            </h2>

            {submitPhase.kind === 'submitting' ? (
              <div ref={focusTarget} tabIndex={-1} aria-label="Submission in progress">
                <InProgressState
                  whatIsHappening="Submitting your intent to the Intent Authority."
                  whatCompletesIt="The authority's response — an explicit state, shown on the state page that follows."
                  reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
                >
                  <p>
                    The submission transport is in flight. This is not a verdict — the intent&apos;s
                    state will be shown explicitly, from the authority&apos;s response, when it
                    arrives.
                  </p>
                </InProgressState>
              </div>
            ) : submitPhase.kind === 'refused' ? (
              <div ref={focusTarget} tabIndex={-1} aria-label="Submit refused at the adapter boundary">
                <FailedState
                  outcome="The submit was refused at the adapter boundary."
                  reportedBy="Product adapter boundary (non-authoritative transport refusal)"
                  reason={`${submitPhase.reason} — ${submitPhase.note}`}
                  nextActions={[
                    'Return to the intent, review the current consequences, and submit again. If the draft changed since review, a fresh consequence report is quoted automatically.',
                  ]}
                >
                  <p>This is a product-boundary refusal, not the authority rejecting your intent. No intent was created.</p>
                  <div className="pt-2">
                    <Link href="/pay" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
                      <ArrowLeft aria-hidden="true" className="mr-1.5 h-4 w-4" />
                      Back to composition
                    </Link>
                  </div>
                </FailedState>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <Checkbox
                    id="submit-acknowledgement"
                    checked={acknowledged}
                    onCheckedChange={(checked) => setAcknowledged(checked === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="submit-acknowledgement"
                    className="cursor-pointer text-sm font-normal leading-relaxed"
                  >
                    I have read the consequences above and I am submitting{' '}
                    <span className="font-semibold">exactly one</span> payment intent. I understand
                    this surface will show only what the Intent Authority reports — including
                    UNKNOWN when there is no answer yet.
                  </Label>
                </div>

                <Button
                  size="lg"
                  disabled={!acknowledged}
                  onClick={() => void onSubmit()}
                  className="min-h-12 w-full bg-emerald-700 text-white hover:bg-emerald-800 sm:w-auto sm:self-start"
                >
                  Submit payment intent
                </Button>
                <p className="text-xs text-muted-foreground">
                  One submit creates one intent. Nothing else is submitted, batched, or repeated
                  without another explicit, reviewed submit.
                </p>
              </>
            )}
          </section>
        </>
      ) : freshTerms?.kind === 'no-answer' ? (
        <UnknownState
          subject="The consequences of this intent are not quotable right now."
          explanation="No consequence report is reachable, so there is nothing complete to review — and without a full review there is no submit (P2/P3). What is not yet known: the fee, the total, and the full consequence terms for this exact draft."
          reconciliation={{
            whoResolves: 'The Intent Authority (runtime ARRIVING)',
            recheckTrigger:
              'Request the terms again below; the review stays closed to submission until a complete report arrives.',
          }}
        >
          <p className="text-xs text-muted-foreground">{`Boundary condition: ${freshTerms.note}`}</p>
          <div className="pt-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setFreshTerms(null);
                if (intentDraft) void requestQuote(intentDraft);
              }}
            >
              <RefreshCw aria-hidden="true" className="mr-1.5 h-4 w-4" />
              Request the terms again
            </Button>
          </div>
        </UnknownState>
      ) : (
        <InProgressState
          whatIsHappening="Requesting the consequence terms."
          whatCompletesIt="A complete consequence report for the composed draft — or an explicit UNKNOWN."
          reportedBy="Intent Authority — mock, non-authoritative (runtime ARRIVING)"
        >
          <p>Asking the authority side to quote the full consequences of this draft. This is not a verdict and not a submit.</p>
        </InProgressState>
      )}
    </div>
  );
}

function NoDraftState() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <FlowSteps current="compose" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">No intent in review</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          There is no draft in progress in this session, so there is nothing to review — this page
          never invents an intent to show.
        </p>
      </header>
      <Link href="/pay" className={buttonVariants({ variant: 'outline', className: 'min-h-11 w-fit' })}>
        <ArrowLeft aria-hidden="true" className="mr-1.5 h-4 w-4" />
        Compose a payment intent
      </Link>
    </div>
  );
}

function buildDraftFromStore(draft: PayFlowDraft, options: CompositionOptions): IntentDraft | null {
  const recipient = options.recipients.find((party) => party.id === draft.recipientId);
  const source = options.sources.find((party) => party.id === draft.sourceId);
  if (!recipient || !source) return null;
  return {
    outcomeKind: 'send-payment',
    outcomeStatement: draft.outcomeStatement,
    amount: draft.amount,
    currency: options.currency,
    recipient,
    source,
    customerReference: draft.customerReference.trim() || undefined,
  };
}

function matchesStoredDraft(
  report: IntentConsequenceReport,
  intentDraft: IntentDraft
): boolean {
  return (
    report.amount === intentDraft.amount &&
    report.currency === intentDraft.currency &&
    report.draftFingerprint.length > 0 &&
    report.terms.length > 0
  );
}
