'use client';

/**
 * Intent flow verification harness (UI-002).
 *
 * Evidences the customer payment intent surface end-to-end through the
 * SAME port and the SAME presentation components the customer flow uses:
 *   A. the adapter boundary report (N1/N3 non-authoritativeness),
 *   B. a live-flow driver that scripts the mock authority's next outcome,
 *   C. the intent state matrix — all six authority states through the
 *      shared primitives, including UNKNOWN with its reconciliation path,
 *   D. the role matrix — guardSurface results for every audience, plus a
 *      live deep-link tester (P8),
 *   E. accessibility and responsive spot-evidence notes (P9/P10).
 *
 * The harness configures the MOCK only. It never fabricates state: every
 * state rendered below still originates from the port.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { InProgressState, AvailabilityUnknownState } from '@/components/state';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { guardSurface, NAV_AUDIENCES, audienceLabel } from '@/lib/navigation';
import {
  AUTHORITY_STATES,
  getIntentPort,
  isAuthorityState,
  type AuthorityState,
  type IntentQueryResult,
} from '@/lib/protocol/intent-port';
import { configureMockAuthority, readMockAuthorityScript, type MockAuthorityScript } from '@/lib/protocol/mock-intent-authority';
import { INTENT_STATE_DISPLAY_MAP, MAPPING_RECORD_IDS, BOUNDARY_MAPPING_RECORD_IDS, intentDisplayState } from '@/lib/protocol/intent-state-mapping';
import { IntentSnapshotPresentation } from '@/components/pay/intent-state-view';

const SUBMIT_OUTCOMES: readonly { value: AuthorityState | 'transport-failure'; label: string }[] = [
  { value: 'acknowledged', label: 'acknowledged → SUCCEEDED (post-submit default)' },
  { value: 'rejected', label: 'rejected → FAILED with actionable reason' },
  { value: 'unresolved', label: 'unresolved → UNKNOWN with reconciliation path' },
  { value: 'held-for-recipient', label: 'held-for-recipient → WAITING' },
  { value: 'processing', label: 'processing → IN_PROGRESS' },
  { value: 'action-requested', label: 'action-requested → ACTION_REQUIRED' },
  { value: 'transport-failure', label: 'submission not transported → UNKNOWN (boundary)' },
];

export function IntentFlowHarness() {
  const port = useMemo(() => getIntentPort(), []);
  const boundary = useMemo(() => port.boundary(), [port]);

  const [script, setScript] = useState<MockAuthorityScript>(() => readMockAuthorityScript());
  const [outcome, setOutcome] = useState<string>(script.nextSubmitState);
  const [reachable, setReachable] = useState(script.authorityReachable);

  const [matrix, setMatrix] = useState<'loading' | { [K in AuthorityState]: IntentQueryResult } | 'no-answer'>('loading');

  const loadMatrix = useCallback(async () => {
    try {
      const entries = await Promise.all(
        AUTHORITY_STATES.map(async (state) => [state, await port.getPresentationFixture(state)] as const)
      );
      setMatrix(Object.fromEntries(entries) as { [K in AuthorityState]: IntentQueryResult });
    } catch {
      setMatrix('no-answer');
    }
  }, [port]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch; setState happens after the awaited port queries
    void loadMatrix();
  }, [loadMatrix]);

  function applyScript() {
    const nextState: AuthorityState = isAuthorityState(outcome) ? outcome : 'acknowledged';
    const next: MockAuthorityScript = {
      nextSubmitState: outcome === 'transport-failure' ? 'acknowledged' : nextState,
      authorityReachable: outcome === 'transport-failure' ? false : reachable,
    };
    setScript(configureMockAuthority(next));
  }

  async function setAudienceAndOpenRoute(audience: string, route: string) {
    await fetch('/api/shell/audience', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience }),
    });
    // Direct entry semantics: a deep link is a fresh entry, so the whole
    // shell (header nav included) re-resolves against the new audience.
    window.location.assign(route);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <Badge variant="secondary" className="w-fit font-medium">
          Verification surface · UI-002
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Customer payment intent flow — verification
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Everything on this page renders through the same port, the same navigation grammar, and
          the same shared state primitives as the customer surface itself. The mock authority the
          port exposes is NON-AUTHORITATIVE and presentation-only; this harness scripts it to
          evidence every path — including UNKNOWN.
        </p>
      </header>

      {/* A. Adapter boundary report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-700" />
            A · Adapter boundary report
          </CardTitle>
          <CardDescription>
            How the boundary keeps the UI non-authoritative (N1, N3) — reported by the port itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adapter</dt>
              <dd className="mt-0.5">{boundary.adapter}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authority owner</dt>
              <dd className="mt-0.5">{boundary.authorityOwner}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime status</dt>
              <dd className="mt-0.5">{boundary.runtimeStatus}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Implementation</dt>
              <dd className="mt-0.5">
                {boundary.implementation} · <span className="font-semibold">authoritative: {String(boundary.authoritative)}</span>
              </dd>
            </div>
          </dl>
          <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {boundary.note}
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">N1 — no financial authority:</span> the
              product never computes fees, totals, or acceptance. The review&rsquo;s fee and total
              come from the port&rsquo;s consequence report; acceptance, rejection, and unresolved
              all arrive as authority-reported snapshots. The port is the only writer of intent
              records.
            </li>
            <li>
              <span className="font-medium text-foreground">N3 — no authorization bypass:</span> the
              submit must carry the explicit-user-submit shape plus the reviewed consequence
              report&rsquo;s id and draft fingerprint; the port refuses everything else (try
              removing the checkbox — the button will not even enable). There is no second write
              path: no server action, no direct store write, no client-side shortcut.
            </li>
            <li>
              <span className="font-medium text-foreground">N2 — no invented settlement:</span>{' '}
              the only success wording anywhere is the authority&rsquo;s own acknowledgement, with
              its scope restated (receipt + acceptance for processing, nothing more).
            </li>
            <li>
              <span className="font-medium text-foreground">P5 — no optimistic rendering:</span> the
              state page never renders the submit&rsquo;s in-flight hope; it re-queries the port and
              renders exactly what returns, including no-answer → UNKNOWN.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* B. Live flow driver */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">B · Live flow driver</CardTitle>
          <CardDescription>
            Script the mock authority&rsquo;s next outcome, then walk the REAL customer flow:
            compose → review full consequences → explicit submit → explicit state.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="harness-outcome">Next submit outcome (mock script)</Label>
              <Select value={outcome} onValueChange={(value) => setOutcome(value ?? 'acknowledged')}>
                <SelectTrigger id="harness-outcome" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBMIT_OUTCOMES.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="min-h-10 text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                id="harness-reachable"
                checked={outcome === 'transport-failure' ? false : reachable}
                disabled={outcome === 'transport-failure'}
                onCheckedChange={setReachable}
                aria-label="Mock authority reachable"
              />
              <Label htmlFor="harness-reachable" className="text-xs text-muted-foreground">
                Authority reachable
              </Label>
            </div>
            <Button onClick={applyScript} className="min-h-11">
              Apply script
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Active script: next submit → <span className="font-mono">{script.nextSubmitState}</span>
            {script.authorityReachable ? '' : ' · authority unreachable'} (applies to submits from
            this browser session until changed). The customer flow itself shows no scripting
            controls — it presents whatever the port reports.
          </p>
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Link href="/pay" className={buttonVariants({ className: 'min-h-11 bg-emerald-700 text-white hover:bg-emerald-800' })}>
              Open the customer flow
              <ExternalLink aria-hidden="true" className="ml-1.5 h-4 w-4" />
            </Link>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void setAudienceAndOpenRoute('customer', '/pay')}
            >
              Set audience to Customer, then open /pay
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            With the <span className="font-medium">unresolved</span> or{' '}
            <span className="font-medium">transport-failure</span> script, the post-submit state
            page shows UNKNOWN with its reconciliation path — the evidence path for P5.
          </p>
        </CardContent>
      </Card>

      {/* C. Intent state matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">C · Intent state matrix</CardTitle>
          <CardDescription>
            Every consequential authority state, rendered through the exact presentation the
            customer state page uses — one authority state resolves to exactly one display state
            (P4), each with its mapping record. Unmapped states do not ship.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {matrix === 'loading' ? (
            <InProgressState
              whatIsHappening="Requesting the demonstration snapshots."
              whatCompletesIt="One fixture snapshot per authority state, from the port."
              reportedBy="Mock intent authority via the port (non-authoritative)"
            >
              <p>Loading one fixture snapshot per authority state from the port. The matrix never renders placeholder states.</p>
            </InProgressState>
          ) : matrix === 'no-answer' ? (
            <AvailabilityUnknownState
              target="the six authority-state fixture snapshots"
              detail="the port could not be queried for the state matrix"
            />
          ) : (
            AUTHORITY_STATES.map((state) => {
              const result = matrix[state];
              return (
                <section
                  key={state}
                  aria-label={`Authority state ${state}`}
                  className="flex flex-col gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{state}</span>
                    <span aria-hidden="true" className="text-muted-foreground">→</span>
                    <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wide">
                      {intentDisplayState(state)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      mapping record {MAPPING_RECORD_IDS[state]} ·{' '}
                      {state === 'unresolved' ? 'reconciliation path included' : ''}
                    </span>
                  </div>
                  {result.kind === 'snapshot' ? (
                    <IntentSnapshotPresentation snapshot={result.snapshot} />
                  ) : (
                    <AvailabilityUnknownState
                      target={`the fixture for authority state ${state}`}
                      detail={result.note}
                    />
                  )}
                </section>
              );
            })
          )}
          <Separator />
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Boundary conditions → UNKNOWN (P5)</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Two boundary conditions render as UNKNOWN (records{' '}
              {BOUNDARY_MAPPING_RECORD_IDS.submitNotTransported} and{' '}
              {BOUNDARY_MAPPING_RECORD_IDS.queryNoAnswer}): a submission that was not transported,
              and a query with no answer. Drive them live:
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/pay/pi_sb_no_such_reference" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>
                Open a state page for an unanswerable reference
                <ExternalLink aria-hidden="true" className="ml-1.5 h-4 w-4" />
              </Link>
              <Button variant="outline" className="min-h-11" onClick={() => {
                setOutcome('transport-failure');
                setScript(configureMockAuthority({ authorityReachable: false }));
              }}>
                Script: next submit is not transported
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              (Deep links to /pay/* are role-checked: set the audience to Customer in the header
              harness first.)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* D. Role matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">D · Role matrix (P8)</CardTitle>
          <CardDescription>
            guardSurface results for every audience against the customer pay routes, plus a live
            deep-link tester. Customer surfaces are enterable by exactly one audience; unknown
            means least visibility.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Audience</TableHead>
                <TableHead>/pay</TableHead>
                <TableHead>/pay/review</TableHead>
                <TableHead>/pay/[intentId]</TableHead>
                <TableHead className="text-right">Live deep-link test</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {NAV_AUDIENCES.map((audience) => {
                const pay = guardSurface(audience, ['customer']);
                const cell = (guard: boolean) =>
                  guard ? (
                    <span className="font-medium text-emerald-700">allowed</span>
                  ) : (
                    <span className="text-muted-foreground">denied → home</span>
                  );
                return (
                  <TableRow key={audience}>
                    <TableCell className="font-medium">{audienceLabel(audience)}</TableCell>
                    <TableCell>{cell(pay)}</TableCell>
                    <TableCell>{cell(pay)}</TableCell>
                    <TableCell>{cell(pay)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        onClick={() => void setAudienceAndOpenRoute(audience, '/pay/review')}
                      >
                        Set &amp; open /pay/review
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The live test sets the session audience through the same server-side signal the shell
            reads, then enters the deep link directly. Every audience except Customer is
            redirected home with an explicit, non-leaking denial notice — the guarded content
            never renders. Navigation entries tell the same story: only the Customer audience
            resolves the “Send a payment intent” entry from the grammar&rsquo;s data.
          </p>
        </CardContent>
      </Card>

      {/* E. Accessibility & responsive spot evidence */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">E · Accessibility &amp; responsive spot evidence (P9/P10)</CardTitle>
          <CardDescription>
            What to verify on this surface, and where the guarantees live.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">State changes announce politely:</span>{' '}
              every state primitive renders a <code>role="status"</code> /{' '}
              <code>aria-live="polite"</code> announcer with the state label + headline (P4) —
              verify with a screen reader on submit and on re-check.
            </li>
            <li>
              <span className="font-medium text-foreground">Focus management:</span> after a
              refused submit and after a re-check, focus moves to the state region (tabIndex −1
              target) so keyboard users land on the answer, not the button.
            </li>
            <li>
              <span className="font-medium text-foreground">Touch targets:</span> interactive
              controls use min-h-11/min-h-12 (≥44px) with visible focus rings.
            </li>
            <li>
              <span className="font-medium text-foreground">Semantics:</span> landmarks (header,
              nav, main, footer, section + aria-label), labeled form fields with described errors,
              real checkbox + label for the explicit submit consent, skip-to-content link.
            </li>
            <li>
              <span className="font-medium text-foreground">Responsive:</span> single column on
              mobile (narrow the viewport to ~375px), multi-column summaries from sm, sticky footer
              stays pinned on short pages and is pushed down on long ones; the state matrix and
              evidence lists cap height with scroll (max-h-96).
            </li>
            <li>
              <span className="font-medium text-foreground">Color independence:</span> every state
              carries a text label and mandatory content, never color alone; UNKNOWN additionally
              uses a distinct dashed treatment.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Mapping records pointer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mapping records</CardTitle>
          <CardDescription>
            UX contract Section 8: every consequential intent state carries a complete
            nine-question mapping record; unmapped states do not ship.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-xs sm:grid-cols-2">
            {AUTHORITY_STATES.map((state) => (
              <li key={state} className="rounded-md border p-2.5">
                <span className="font-mono font-semibold">{MAPPING_RECORD_IDS[state]}</span> ·{' '}
                <span className="font-mono">{state}</span> → {INTENT_STATE_DISPLAY_MAP[state]}
              </li>
            ))}
            <li className="rounded-md border p-2.5">
              <span className="font-mono font-semibold">{BOUNDARY_MAPPING_RECORD_IDS.submitNotTransported}</span> ·
              submission not transported → UNKNOWN
            </li>
            <li className="rounded-md border p-2.5">
              <span className="font-mono font-semibold">{BOUNDARY_MAPPING_RECORD_IDS.queryNoAnswer}</span> ·
              query with no answer → UNKNOWN
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Full records: <span className="font-mono">spec/product/intent-mapping-records.md</span>{' '}
            — owner: Intent Authority (spec/architecture/v0.1), runtime boundary ARRIVING, mock
            NON-AUTHORITATIVE.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
