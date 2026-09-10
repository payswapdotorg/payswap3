'use client';

/**
 * Composition step (UI-002) — OUTCOME FIRST (P2/P3).
 *
 * The customer states the desired outcome in plain language before any
 * mechanism detail; the details the intent needs are disclosed only after
 * an outcome is chosen. Nothing on this page submits anything: the only
 * forward action is to review the full consequences.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AvailabilityUnknownState } from '@/components/state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { EnvironmentReport } from '@/lib/environment';
import type { CompositionOptions, SessionIntentListResult } from '@/lib/protocol/intent-port';
import { getIntentPort } from '@/lib/protocol/intent-port';
import { intentDisplayState } from '@/lib/protocol/intent-state-mapping';
import {
  EMPTY_DRAFT,
  isDraftComplete,
  usePayDraftStore,
  type PayFlowDraft,
} from '@/lib/pay-flow/draft-store';
import { formatMoney, formatTimestamp, isValidAmountFormat } from '@/lib/pay-flow/money';
import { FlowSteps } from '@/components/pay/flow-steps';
import { PayEnvironmentBanner } from '@/components/pay/pay-environment-banner';

export function ComposeIntentView({ environment }: { environment: EnvironmentReport }) {
  const port = useMemo(() => getIntentPort(), []);
  const draft = usePayDraftStore((state) => state.draft);
  const setDraft = usePayDraftStore((state) => state.setDraft);

  const [options, setOptions] = useState<CompositionOptions | null>(null);
  const [optionsStatus, setOptionsStatus] = useState<'loading' | 'ready' | 'no-answer'>('loading');
  const [sessionIntents, setSessionIntents] = useState<SessionIntentListResult | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);

  const current: PayFlowDraft = draft ?? EMPTY_DRAFT;

  // Fetch-only: every setState here happens after an await, so the
  // mount effect never triggers synchronous state cascades.
  const fetchDirectory = useCallback(async () => {
    const result = await port.listSessionIntents();
    setSessionIntents(result);
    setOptions(port.getCompositionOptions());
    setOptionsStatus('ready');
  }, [port]);

  const requestOptions = useCallback(async () => {
    // The composition directory is fixture data behind the port; a failed
    // fetch is presented as availability-UNKNOWN, never as an empty form.
    setOptionsStatus('loading');
    try {
      await fetchDirectory();
    } catch {
      setOptionsStatus('no-answer');
    }
  }, [fetchDirectory]);

  useEffect(() => {
    usePayDraftStore.persist.rehydrate();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch; all setState in fetchDirectory happens after await
    void fetchDirectory().catch(() => setOptionsStatus('no-answer'));
  }, [fetchDirectory]);

  const amountValid = isValidAmountFormat(current.amount);
  const outcomeChosen = current.outcomeStatement.length > 0;
  const canReview =
    optionsStatus === 'ready' &&
    options !== null &&
    isDraftComplete(current) &&
    recipientName(options, current.recipientId) !== null;

  function update(patch: Partial<PayFlowDraft>) {
    setDraft({ ...current, ...patch });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <FlowSteps current="compose" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Send a payment intent</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Outcome first: state what you want to happen. The details the intent needs come after,
          and nothing is submitted until you have reviewed the full consequences and submitted
          explicitly.
        </p>
      </header>

      <PayEnvironmentBanner environment={environment} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · What do you want to happen?</CardTitle>
          <CardDescription>The outcome you want, in your own words.</CardDescription>
        </CardHeader>
        <CardContent>
          {optionsStatus === 'loading' ? (
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : optionsStatus === 'no-answer' || options === null ? (
            <div className="flex flex-col gap-3">
              <AvailabilityUnknownState
                target="the composition directory (outcome statements, recipients, funding sources)"
                detail="the port could not provide the outcome options and parties"
              />
              <div>
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => void requestOptions()}>
                  <RefreshCw aria-hidden="true" className="mr-1.5 h-4 w-4" />
                  Request again
                </Button>
              </div>
            </div>
          ) : (
            <RadioGroup
              aria-label="Desired outcome"
              value={current.outcomeStatement}
              onValueChange={(value) => update({ outcomeStatement: value })}
              className="flex flex-col gap-2.5"
            >
              {options.outcomeStatements.map((statement, index) => {
                const planned = index > 0;
                return (
                  <label
                    key={statement}
                    className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-sm leading-relaxed transition-colors ${
                      current.outcomeStatement === statement
                        ? 'border-emerald-300 bg-emerald-50/60'
                        : 'hover:bg-muted/50'
                    } ${planned ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <RadioGroupItem value={statement} disabled={planned} className="mt-0.5" />
                    <span className="flex-1">{statement}</span>
                    {planned ? <Badge variant="outline">Planned</Badge> : null}
                  </label>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      {outcomeChosen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · The details this intent needs</CardTitle>
            <CardDescription>
              Disclosed now that an outcome is chosen — these are the parameters the authority
              needs to consider your intent.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-recipient">Recipient merchant</Label>
              <Select
                value={current.recipientId ?? undefined}
                onValueChange={(value) => update({ recipientId: value ?? undefined })}
                disabled={optionsStatus !== 'ready'}
              >
                <SelectTrigger id="pay-recipient" className="min-h-11 w-full sm:w-80">
                  <SelectValue placeholder="Choose a merchant" />
                </SelectTrigger>
                <SelectContent>
                  {options?.recipients.map((party) => (
                    <SelectItem key={party.id} value={party.id} className="min-h-10">
                      {party.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-source">Funded from</Label>
              <Select
                value={current.sourceId ?? undefined}
                onValueChange={(value) => update({ sourceId: value ?? undefined })}
                disabled={optionsStatus !== 'ready'}
              >
                <SelectTrigger id="pay-source" className="min-h-11 w-full sm:w-80">
                  <SelectValue placeholder="Choose a funding source" />
                </SelectTrigger>
                <SelectContent>
                  {options?.sources.map((party) => (
                    <SelectItem key={party.id} value={party.id} className="min-h-10">
                      {party.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {environment.kind === 'sandbox'
                  ? 'Sandbox funding sources — presentation fixtures, not real balances.'
                  : 'Funding sources as provided by the authority side.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-amount">Amount</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="25.00"
                  value={current.amount}
                  onChange={(event) => update({ amount: event.target.value.trim() })}
                  onBlur={() => setAmountTouched(true)}
                  aria-invalid={amountTouched && !amountValid}
                  aria-describedby={amountTouched && !amountValid ? 'pay-amount-error' : undefined}
                  className="min-h-11 w-32 font-mono"
                />
                <span className="text-sm font-medium text-muted-foreground">USD</span>
              </div>
              {amountTouched && !amountValid ? (
                <p id="pay-amount-error" role="alert" className="text-xs text-rose-700">
                  Enter a positive amount with up to two decimals, for example 25.00.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Any fee and total are quoted by the authority side on the next step — never
                computed by this page.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pay-reference">Your reference (optional)</Label>
              <Input
                id="pay-reference"
                autoComplete="off"
                placeholder="e.g. Order 2147"
                value={current.customerReference}
                onChange={(event) => update({ customerReference: event.target.value })}
                className="min-h-11 w-full sm:w-80"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Once you choose an outcome, the details the intent needs appear here.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {canReview ? (
          <Link
            href="/pay/review"
            className={buttonVariants({
              size: 'lg',
              className:
                'min-h-12 w-full bg-emerald-700 text-white hover:bg-emerald-800 sm:w-auto sm:self-start',
            })}
          >
            Review the full consequences
            <ArrowRight aria-hidden="true" className="ml-1.5 h-4 w-4" />
          </Link>
        ) : (
          <Button
            disabled
            size="lg"
            className="min-h-12 w-full bg-emerald-700 text-white hover:bg-emerald-800 sm:w-auto sm:self-start"
          >
            Review the full consequences
            <ArrowRight aria-hidden="true" className="ml-1.5 h-4 w-4" />
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Nothing is submitted on this page. The next step shows the complete intent and its
          consequences before any committing action.
        </p>
      </div>

      <section aria-labelledby="session-intents-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="session-intents-heading" className="text-base font-semibold">
          Intents submitted in this session
        </h2>
        <p className="text-sm text-muted-foreground">
          Held by the mock authority in this browser session&rsquo;s memory — non-authoritative,
          presentation-only. Anything not reachable here is shown as UNKNOWN, never as a
          fabricated list.
        </p>
        <SessionIntentList result={sessionIntents} />
      </section>
    </div>
  );
}

function recipientName(options: CompositionOptions, recipientId: string): string | null {
  return options.recipients.find((party) => party.id === recipientId)?.displayName ?? null;
}

function SessionIntentList({ result }: { result: SessionIntentListResult | null }) {
  if (result === null) {
    return <Skeleton className="h-20 w-full" />;
  }
  if (result.kind === 'no-answer') {
    return (
      <AvailabilityUnknownState
        target="this session’s intent listing from the port"
        detail={result.note ?? undefined}
      />
    );
  }
  return (
    <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" role="list">
      {result.records.map((record) => (
        <li key={record.intentId}>
          <Link
            href={`/pay/${record.intentId}`}
            className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{formatMoney(record.amount, record.currency)}</span>
              <span className="text-muted-foreground">to {record.recipientName}</span>
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide">
                {intentDisplayState(record.authorityState)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(record.reportedAt)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
