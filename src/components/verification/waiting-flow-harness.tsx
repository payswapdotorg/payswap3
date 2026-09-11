"use client";

/**
 * Waiting flow verification harness — UI-006.
 *
 * Verifies, against the NON-AUTHORITATIVE mock backing:
 * 1. the waiting/queued/delayed matrix across outcomes (including
 *    still-UNKNOWN endings) — reason, expectation, actions or explicit
 *    none-yet on every cell;
 * 2. the recovery-authorization matrix — authorized vs denied per action per
 *    role, plus a probe proving the mock never accepts an unauthorized
 *    recovery (the only acceptance path is per-request authorization);
 * 3. reconciliation visibility for UNKNOWN and ended-still-unknown states;
 * 4. live-region announcements when waiting states mount or change;
 * 5. the adapter boundary report.
 *
 * Matrix cells are static evidence renders: their announcements are suppressed
 * (announce={false}) so the polite live region is not flooded; the live-flow
 * panel above exercises announcements for real.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ClipboardCheck,
  RotateCcw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WaitingRecoveryPanel } from "@/components/track/waiting-recovery-panel";
import { WaitingInquiryForm } from "@/components/track/waiting-inquiry-form";
import {
  getWaitingPort,
  WAITING_PORT_AUTHORITY_OWNER,
  type WaitingRecoveryActionId,
  type WaitingViewerRole,
} from "@/lib/protocol/waiting-port";
import {
  clearWaitingScriptting,
  getMockWaitingRequestLog,
  MOCK_WAITING_NON_AUTHORITATIVE_NOTE,
  MOCK_WAITING_REFERENCES,
  scriptWaitingOutcome,
  type MockWaitingRequestLogEntry,
  type WaitingScriptOutcome,
} from "@/lib/protocol/mock-waiting-authority";
import {
  getWaitingDisplayPresentation,
  WAITING_MAPPING_DOC_PATH,
  WAITING_NON_STATES,
} from "@/lib/protocol/waiting-state-mapping";

const LIVE_REFERENCE = "TRK-9000-WAITING-LIVE";

const ROLES: readonly WaitingViewerRole[] = [
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
];

const ACTION_IDS: readonly WaitingRecoveryActionId[] = ["retry", "cancel", "escalate"];

const MATRIX_REFERENCES: readonly string[] = [
  "TRK-4410-QUEUED-LIQ",
  "TRK-4412-WAITING-CONFIRM",
  "TRK-4413-DELAYED-LIQ-WINDOW",
  "TRK-4416-UNKNOWN-TIMEOUT",
  "TRK-4418-RESOLVED-FAILED",
  "TRK-4419-RESOLVED-STILL-UNKNOWN",
  "TRK-4420-NO-ACTION",
];

const RECONCILIATION_REFERENCES: readonly string[] = [
  "TRK-4415-UNKNOWN-RECON",
  "TRK-4416-UNKNOWN-TIMEOUT",
  "TRK-4419-RESOLVED-STILL-UNKNOWN",
];

const OUTCOME_LABEL: Readonly<Record<WaitingScriptOutcome, string>> = {
  "queued-liquidity-credit": "Queued — liquidity credit",
  "queued-provider-availability": "Queued — provider availability",
  "waiting-settlement-confirmation": "Waiting — settlement confirmation",
  "delayed-liquidity-window": "Delayed — liquidity window",
  "delayed-provider-backoff": "Delayed — provider backoff",
  "unknown-pending-reconciliation": "Unknown — pending reconciliation",
  "unknown-after-wait-timeout": "Unknown — after wait timeout",
  "resolved-completed": "Resolved — completed",
  "resolved-failed": "Resolved — failed",
  "resolved-still-unknown": "Ended — still unknown",
  "queued-minimum-wait-window": "Queued — minimum wait window (no action yet)",
};

const OUTCOME_GROUPS: readonly { label: string; outcomes: readonly WaitingScriptOutcome[] }[] = [
  {
    label: "Conditions (waiting / queued / delayed)",
    outcomes: [
      "queued-liquidity-credit",
      "queued-provider-availability",
      "waiting-settlement-confirmation",
      "delayed-liquidity-window",
      "delayed-provider-backoff",
    ],
  },
  {
    label: "UNKNOWN with reconciliation",
    outcomes: ["unknown-pending-reconciliation", "unknown-after-wait-timeout"],
  },
  {
    label: "Endings (explicit terminal / still-unknown)",
    outcomes: ["resolved-completed", "resolved-failed", "resolved-still-unknown"],
  },
  {
    label: "Explicit none-yet",
    outcomes: ["queued-minimum-wait-window"],
  },
];

interface AnnouncementLogEntry {
  readonly id: number;
  readonly text: string;
}

interface ProbeSummary {
  readonly accepted: number;
  readonly denied: number;
  readonly unauthorizedAcceptances: number;
  readonly log: readonly MockWaitingRequestLogEntry[];
}

const SCROLLABLE =
  "max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type MatrixCell =
  | { kind: "no-access" }
  | { kind: "authorized"; basis: string }
  | { kind: "not-authorized"; reason: string };

function buildMatrixRows(): readonly {
  referenceId: string;
  cells: Readonly<Record<WaitingRecoveryActionId, Readonly<Record<WaitingViewerRole, MatrixCell>>>>;
}[] {
  const port = getWaitingPort();
  return MATRIX_REFERENCES.map((referenceId) => {
    const cells = {} as Record<
      WaitingRecoveryActionId,
      Record<WaitingViewerRole, MatrixCell>
    >;
    for (const actionId of ACTION_IDS) {
      cells[actionId] = {} as Record<WaitingViewerRole, MatrixCell>;
      for (const role of ROLES) {
        const lookup = port.lookupWaiting(referenceId, role);
        if (lookup.status !== "found") {
          cells[actionId][role] = { kind: "no-access" };
          continue;
        }
        const action = lookup.snapshot.recovery.find(
          (candidate) => candidate.actionId === actionId,
        );
        if (!action) {
          cells[actionId][role] = { kind: "no-access" };
          continue;
        }
        cells[actionId][role] =
          action.authorization.status === "authorized"
            ? { kind: "authorized", basis: action.authorization.basis }
            : { kind: "not-authorized", reason: action.authorization.reason };
      }
    }
    return { referenceId, cells };
  });
}

export function WaitingFlowHarness() {
  const [viewerRole, setViewerRole] = useState<WaitingViewerRole>("customer");
  const [liveOutcome, setLiveOutcome] = useState<WaitingScriptOutcome>(
    "queued-liquidity-credit",
  );
  const [announcements, setAnnouncements] = useState<readonly AnnouncementLogEntry[]>([]);
  const [probe, setProbe] = useState<ProbeSummary | null>(null);

  const recordAnnouncement = useCallback((message: string) => {
    setAnnouncements((previous) => {
      const entry: AnnouncementLogEntry = {
        id: (previous.length > 0 ? previous[previous.length - 1].id : 0) + 1,
        text: message,
      };
      const next = [...previous, entry];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }, []);

  const scriptOutcome = useCallback((outcome: WaitingScriptOutcome) => {
    scriptWaitingOutcome(LIVE_REFERENCE, outcome);
    setLiveOutcome(outcome);
  }, []);

  const resetMock = useCallback(() => {
    clearWaitingScriptting();
    setLiveOutcome("queued-liquidity-credit");
    setAnnouncements([]);
    setProbe(null);
  }, []);

  const liveLookup = useMemo(
    () => ({
      outcome: liveOutcome,
      result: getWaitingPort().lookupWaiting(LIVE_REFERENCE, viewerRole),
    }),
    [liveOutcome, viewerRole],
  );

  const matrixCells = useMemo(
    () =>
      MOCK_WAITING_REFERENCES.filter(
        (reference) => reference.referenceId !== LIVE_REFERENCE,
      ).map((reference) => ({
        summary: reference,
        lookup: getWaitingPort().lookupWaiting(reference.referenceId, viewerRole),
      })),
    [viewerRole],
  );

  const runProbe = useCallback(() => {
    const port = getWaitingPort();
    let accepted = 0;
    let denied = 0;
    let unauthorizedAcceptances = 0;
    for (const referenceId of MATRIX_REFERENCES) {
      for (const role of ROLES) {
        const lookup = port.lookupWaiting(referenceId, role);
        if (lookup.status !== "found") continue;
        for (const actionId of ACTION_IDS) {
          const descriptor = lookup.snapshot.recovery.find(
            (candidate) => candidate.actionId === actionId,
          );
          const result = port.requestRecovery({
            referenceId,
            actionId,
            requestedByRole: role,
          });
          if (result.status === "accepted") {
            accepted += 1;
            if (descriptor?.authorization.status !== "authorized") {
              unauthorizedAcceptances += 1;
            }
          } else {
            denied += 1;
          }
        }
      }
    }
    setProbe({ accepted, denied, unauthorizedAcceptances, log: getMockWaitingRequestLog() });
  }, []);

  const matrixRows = useMemo(() => buildMatrixRows(), []);

  return (
    <div className="grid gap-6">
      {/* 1. Live flow — composes deliverables 4 + 5 exactly like the page. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>1. Live flow — waiting detail composition</span>
            <Badge variant="secondary">scriptable</Badge>
          </CardTitle>
          <CardDescription>
            {LIVE_REFERENCE} rendered through the waiting recovery panel and inquiry form, the
            same composition as /track/[referenceId]/waiting. Script a fulfillment phase or
            switch the viewer role; the panel announces every state change through the polite
            live region (log in section 4).
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select
              value={viewerRole}
              onValueChange={(value) => setViewerRole(value as WaitingViewerRole)}
            >
              <SelectTrigger className="w-44" aria-label="Viewer role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="ghost" onClick={resetMock}>
              <RotateCcw aria-hidden />
              Reset mock
            </Button>
          </div>
          <div className="grid gap-2 pt-1">
            {OUTCOME_GROUPS.map((group) => (
              <div key={group.label} className="grid gap-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.outcomes.map((outcome) => (
                    <Button
                      key={outcome}
                      type="button"
                      size="sm"
                      variant={liveOutcome === outcome ? "default" : "outline"}
                      onClick={() => scriptOutcome(outcome)}
                    >
                      {OUTCOME_LABEL[outcome]}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          {liveLookup.result.status === "found" ? (
            <>
              <WaitingRecoveryPanel
                snapshot={liveLookup.result.snapshot}
                onAnnounce={recordAnnouncement}
              />
              <WaitingInquiryForm
                referenceId={LIVE_REFERENCE}
                viewerRole={viewerRole}
                inquiry={liveLookup.result.snapshot.inquiry}
                onAnnounce={recordAnnouncement}
              />
            </>
          ) : liveLookup.result.status === "role-denied" ? (
            <p className="text-sm text-muted-foreground">
              Role-denied for {viewerRole}: roles permitted are{" "}
              {liveLookup.result.allowedViewerRoles.join(", ")}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not found in the mock backing.</p>
          )}
        </CardContent>
      </Card>

      {/* 2. Waiting matrix across outcomes. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>2. Waiting matrix — reason, expectation, actions or none-yet</span>
            <Badge variant="secondary">matrix</Badge>
          </CardTitle>
          <CardDescription>
            Every sandbox reference rendered as the selected role sees it. Each cell carries the
            authority-reported reason, the expectation of what happens next, and the available
            actions or the explicit &quot;no action is available yet&quot;. Matrix cells
            suppress announcements to avoid flooding the live region.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {matrixCells.map(({ summary, lookup }) => (
              <div key={summary.referenceId} className="grid content-start gap-1.5">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{summary.referenceId}</span> —{" "}
                  {summary.intentSummary}
                </p>
                {lookup.status === "found" ? (
                  <WaitingRecoveryPanel snapshot={lookup.snapshot} compact announce={false} />
                ) : lookup.status === "role-denied" ? (
                  <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Role-denied for {viewerRole}. Permitted:{" "}
                    {lookup.allowedViewerRoles.join(", ")}.
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Not found.
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 3. Recovery-authorization matrix + probe. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>3. Recovery authorization — per action, per role</span>
            <Badge variant="secondary">authorized vs denied</Badge>
          </CardTitle>
          <CardDescription>
            Authorization of retry / cancel / escalate for each role on representative
            references. Authorized actions render enabled in the panels; unauthorized actions
            render disabled with their reason. The probe submits every combination through
            requestRecovery() and counts acceptances that lack authorization — it must stay
            zero.
          </CardDescription>
          <div className="pt-1">
            <Button type="button" size="sm" variant="outline" onClick={runProbe}>
              <ShieldCheck aria-hidden />
              Probe all cells via requestRecovery
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Reference</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                  {ROLES.map((role) => (
                    <TableHead key={role}>{role}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixRows.flatMap((row) =>
                  ACTION_IDS.map((actionId) => (
                    <TableRow key={`${row.referenceId}-${actionId}`}>
                      <TableCell className="font-medium">{row.referenceId}</TableCell>
                      <TableCell className="text-muted-foreground">{actionId}</TableCell>
                      {ROLES.map((role) => {
                        const cell = row.cells[actionId][role];
                        return (
                          <TableCell key={`${row.referenceId}-${actionId}-${role}`} className="align-top">
                            {cell.kind === "no-access" ? (
                              <span className="text-xs text-muted-foreground">no access</span>
                            ) : cell.kind === "authorized" ? (
                              <span className="grid gap-0.5">
                                <Badge
                                  variant="outline"
                                  className="w-fit border-emerald-300 text-emerald-700"
                                >
                                  Authorized
                                </Badge>
                                <span
                                  className="text-xs text-muted-foreground"
                                  title={cell.basis}
                                >
                                  {truncate(cell.basis, 56)}
                                </span>
                              </span>
                            ) : (
                              <span className="grid gap-0.5">
                                <Badge variant="secondary" className="w-fit">
                                  Not authorized
                                </Badge>
                                <span
                                  className="text-xs text-muted-foreground"
                                  title={cell.reason}
                                >
                                  {truncate(cell.reason, 56)}
                                </span>
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>

          {probe ? (
            <div className="grid gap-2 rounded-md border p-3">
              <p className="text-sm">
                Probed {MATRIX_REFERENCES.length} references × {ROLES.length} roles ×{" "}
                {ACTION_IDS.length} actions:{" "}
                <span className="font-medium">{probe.accepted} accepted</span>,{" "}
                <span className="font-medium">{probe.denied} denied</span>, unauthorized
                acceptances:{" "}
                <span className="font-medium text-emerald-700">
                  {probe.unauthorizedAcceptances}
                </span>{" "}
                (must be 0 — the mock never scripts an unauthorized recovery; the only
                acceptance path is per-request authorization).
              </p>
              <div className={`${SCROLLABLE} rounded-md border`}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>kind</TableHead>
                      <TableHead>reference</TableHead>
                      <TableHead>action</TableHead>
                      <TableHead>role</TableHead>
                      <TableHead>result</TableHead>
                      <TableHead>reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {probe.log.map((entry) => (
                      <TableRow key={entry.index}>
                        <TableCell>{entry.index}</TableCell>
                        <TableCell>{entry.kind}</TableCell>
                        <TableCell>{entry.referenceId}</TableCell>
                        <TableCell>{entry.actionId ?? "—"}</TableCell>
                        <TableCell>{entry.requestedByRole}</TableCell>
                        <TableCell>{entry.result}</TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          title={entry.reason ?? ""}
                        >
                          {entry.reason ? truncate(entry.reason, 70) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Requests only log; they never change the fulfillment phase — requesting is not
                an outcome and never mutates financial state.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run the probe to collect per-request authorization evidence.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4. Reconciliation visibility + announcements. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>4a. UNKNOWN with reconciliation</span>
              <ClipboardCheck aria-hidden className="size-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Who re-checks, what triggers the re-check, and what the user sees next — surfaced
              with the mapping record id whenever UNKNOWN (or ended-still-unknown) is shown.
              Never rendered as failure or success.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {RECONCILIATION_REFERENCES.map((referenceId) => {
              const lookup = getWaitingPort().lookupWaiting(referenceId, "customer");
              if (lookup.status !== "found") {
                return (
                  <p key={referenceId} className="text-sm text-muted-foreground">
                    {referenceId}: not found.
                  </p>
                );
              }
              const presentation = getWaitingDisplayPresentation(
                lookup.snapshot.authorityStateId,
              );
              const snapshot = lookup.snapshot;
              const reconciliation =
                snapshot.snapshotKind === "unknown"
                  ? snapshot.reconciliation
                  : snapshot.snapshotKind === "resolution"
                    ? snapshot.reconciliation
                    : undefined;
              if (!reconciliation) {
                return (
                  <p key={referenceId} className="text-sm text-muted-foreground">
                    {referenceId}: no reconciliation path.
                  </p>
                );
              }
              return (
                <div key={referenceId} className="grid gap-1 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{referenceId}</span>
                    <Badge variant="outline">{presentation.recordId}</Badge>
                    <Badge variant="secondary">{presentation.surfaceLabel}</Badge>
                  </div>
                  <p>
                    <span className="text-muted-foreground">Who re-checks:</span>{" "}
                    {reconciliation.whoResolves}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Re-check trigger:</span>{" "}
                    {reconciliation.recheckTrigger}
                  </p>
                  <p>
                    <span className="text-muted-foreground">What you will see next:</span>{" "}
                    {reconciliation.whatUserSeesNext}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>4b. Live-region announcements</span>
              <Volume2 aria-hidden className="size-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Every announcement fired by the live-flow panel and inquiry form, in order. The
              panel announces waiting states on mount and on every state change through a
              visually hidden polite live region (role=&quot;status&quot;,
              aria-live=&quot;polite&quot;).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No announcements yet. Script a phase or switch the role in section 1.
              </p>
            ) : (
              <ol className={`${SCROLLABLE} grid gap-1.5 pr-2`}>
                {announcements
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id} className="rounded-md border p-2 text-xs">
                      <span className="font-medium">#{entry.id}</span> {entry.text}
                    </li>
                  ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* 5. Adapter boundary report. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">5. Adapter boundary report</CardTitle>
          <CardDescription>
            The waiting surface follows the port/mock/mapping pattern proven by UI-002,
            UI-003, UI-004, and UI-005.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-2 text-sm">
            {[
              ["Authority owner", WAITING_PORT_AUTHORITY_OWNER],
              ["Runtime", "ARRIVING"],
              [
                "Mock backing",
                "src/lib/protocol/mock-waiting-authority.ts — presentation-only, NON-AUTHORITATIVE, sandbox data only, scriptable fulfillment phases for this harness",
              ],
              [
                "Typed port",
                "src/lib/protocol/waiting-port.ts — getWaitingPort() returns the mock backing until the authority implementation lands",
              ],
              [
                "Display mapping",
                "src/lib/protocol/waiting-state-mapping.ts — one-to-one authority state to display presentation, record ids WQ-01…WQ-16",
              ],
              ["Mapping records", WAITING_MAPPING_DOC_PATH],
              [
                "Surfaces",
                "/track/[referenceId]/waiting (deep-linkable detail, composes the panel and inquiry form); the panel composes onto the track detail surface",
              ],
            ].map(([term, detail]) => (
              <div key={term} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {term}
                </dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">Bounds attestations</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              <li>
                No protocol semantics are defined or changed; recovery authorization is assessed
                by the (mock stand-in of the) authority, never by the UI.
              </li>
              <li>
                No financial authority and no UI-side computation: amounts are authority-quoted
                and only formatted.
              </li>
              <li>
                No recovery bypasses authorization: acceptance exists only through
                requestRecovery() with per-request checks, and the scripting API cannot script
                a recovery outcome.
              </li>
              <li>
                No durable financial state is mutated: accepted requests only log; fulfillment
                phases change only via this harness scripting mock sandbox data.
              </li>
              <li>
                No invented time or progress estimates: every timing or progress claim is
                authority-quoted, and &quot;no completion estimate&quot; is stated explicitly.
              </li>
            </ul>
          </div>
          <div className="grid gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">Explicit non-states</p>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {WAITING_NON_STATES.map((nonState) => (
                <li key={nonState}>{nonState}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{MOCK_WAITING_NON_AUTHORITATIVE_NOTE}</p>
        </CardContent>
      </Card>
    </div>
  );
}
