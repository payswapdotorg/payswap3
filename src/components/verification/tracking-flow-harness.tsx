import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { EvidenceTrail } from "@/components/track/evidence-trail";
import { TrackedStateCard } from "@/components/track/tracked-state-card";
import type { TrackedReferenceView, TrackingBoundaryReport } from "@/lib/protocol/tracking-port";
import {
  EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID,
  LOOKUP_NOT_AUTHORIZED_MAPPING_RECORD_ID,
  LOOKUP_NOT_FOUND_MAPPING_RECORD_ID,
  TRACKED_STATE_LABELS,
  TRACKING_MAPPING_RECORD_IDS,
} from "@/lib/protocol/tracking-state-mapping";
import { cn } from "@/lib/utils";

/**
 * UI-005 — the tracking-flow verification harness (the intent-flow model).
 *
 * Everything below is rendered through the SAME components the /track
 * surfaces ship (TrackedStateCard, EvidenceTrail), from views resolved by
 * the SAME adapter boundary (the tracking port and its mock backing). Four
 * verifications:
 *
 *   1. Tracked-state matrix — all six display states (WAITING carries
 *      reason, expectation, and actions-or-an-explicit-none).
 *   2. Evidence-trail presentation — including the UNKNOWN-record case
 *      (a record the authority has not answered for).
 *   3. Role matrix — what each audience gets on direct entry.
 *   4. Adapter boundary report — the mock self-description (ARRIVING).
 */

export interface TrackingFlowStateMatrixEntry {
  readonly referenceId: string;
  readonly subjectWording: string;
  readonly note: string;
  readonly view: TrackedReferenceView | null;
}

export interface TrackingFlowRoleMatrixCell {
  readonly referenceId: string;
  readonly kind: "tracked" | "not-authorized" | "not-found";
  readonly stateKind: string | null;
}

export interface TrackingFlowRoleMatrixRow {
  readonly audience: string;
  readonly cells: readonly TrackingFlowRoleMatrixCell[];
}

export interface TrackingFlowRoleMatrixReference {
  readonly referenceId: string;
  readonly subjectKind: string;
  readonly authorizedAudiences: readonly string[];
}

export interface TrackingFlowHarnessProps {
  readonly stateMatrix: readonly TrackingFlowStateMatrixEntry[];
  readonly evidenceDemo: {
    readonly mode: "recorded" | "no-answer";
    readonly scriptedView: TrackedReferenceView | null;
    readonly fixedNoAnswerView: TrackedReferenceView | null;
  };
  readonly roleMatrix: {
    readonly references: readonly TrackingFlowRoleMatrixReference[];
    readonly rows: readonly TrackingFlowRoleMatrixRow[];
  };
  readonly boundary: TrackingBoundaryReport;
}

const STATE_BADGE_TONES: Readonly<Record<string, string>> = {
  succeeded:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  failed:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  "in-progress":
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  waiting:
    "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100",
  unknown:
    "border-zinc-400 bg-zinc-50 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100",
  "action-required":
    "border-orange-400 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100",
};

function stateBadge(stateKind: string | null): React.ReactNode {
  if (stateKind === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const label = TRACKED_STATE_LABELS[stateKind as keyof typeof TRACKED_STATE_LABELS] ?? stateKind;
  return (
    <Badge variant="outline" className={cn("font-semibold", STATE_BADGE_TONES[stateKind] ?? "")}>
      {label}
    </Badge>
  );
}

function RoleMatrixCell({ cell }: { cell: TrackingFlowRoleMatrixCell }) {
  if (cell.kind === "tracked") {
    return stateBadge(cell.stateKind);
  }
  if (cell.kind === "not-authorized") {
    return (
      <Badge variant="outline" className="border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        NOT AUTHORIZED
      </Badge>
    );
  }
  return <span className="text-xs font-medium text-muted-foreground">NOT FOUND</span>;
}

export function TrackingFlowHarness({
  stateMatrix,
  evidenceDemo,
  roleMatrix,
  boundary,
}: TrackingFlowHarnessProps) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          UI-005 verification harness
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Tracking flow — states, evidence, roles, adapter boundary
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This harness drives the real adapter boundary (the tracking port and its
          presentation-only mock backing) and renders the results through the same components
          the /track surfaces ship. Deep links below open the real surface; they open with your
          current simulated shell audience, so switch audiences the way your environment
          provides before re-opening a link to test another role.
        </p>
      </header>

      <Separator className="my-10" />

      {/* 1. Tracked-state matrix */}
      <section aria-labelledby="vf-states-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="vf-states-heading" className="text-xl font-semibold tracking-tight">
            1. Tracked-state matrix — all six display states
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every reference below is looked up through the port as{" "}
            <Badge variant="secondary">operator</Badge> (authorized for every mock session
            record) and resolved one-to-one by the display-state mapping. There is no
            ambiguous “pending” anywhere: waiting conditions carry reason, expectation, and
            either available actions or an explicit “none yet”.
          </p>
        </div>
        <div className="space-y-6">
          {stateMatrix.map((entry) => (
            <article
              key={entry.referenceId}
              className="space-y-3 rounded-lg border p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold leading-snug">
                    {entry.subjectWording}
                  </span>
                  <Badge variant="outline" className="font-mono">
                    {entry.referenceId}
                  </Badge>
                </div>
                <Link
                  href={`/track/${entry.referenceId}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open /track/{entry.referenceId}
                </Link>
              </div>
              {entry.view ? (
                <TrackedStateCard currentState={entry.view.currentState} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The operator lookup did not return a tracked view (unexpected in this
                  harness).
                </p>
              )}
              <p className="text-xs text-muted-foreground">{entry.note}</p>
            </article>
          ))}
        </div>
      </section>

      <Separator className="my-10" />

      {/* 2. Evidence-trail presentation */}
      <section aria-labelledby="vf-evidence-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="vf-evidence-heading" className="text-xl font-semibold tracking-tight">
            2. Evidence-trail presentation — including the UNKNOWN-record case
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Records are listed with authority, time, and outcome wording — presented, never
            synthesized. A record the authority has not answered for renders UNKNOWN for that
            record (mapping record{" "}
            <span className="font-mono">{EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID}</span>).
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fixed no-answer record</CardTitle>
            <CardDescription>
              PWS-5VBM — the Evidence Authority never answered for the settlement
              confirmation. There is no recorded payload for it at all, so it can never be
              scripted into a recorded substitute.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {evidenceDemo.fixedNoAnswerView ? (
              <EvidenceTrail evidenceTrail={evidenceDemo.fixedNoAnswerView.evidenceTrail} />
            ) : (
              <p className="text-sm text-muted-foreground">Lookup did not return a view.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Scriptable record</CardTitle>
              <Badge variant="secondary">
                {evidenceDemo.mode === "no-answer" ? "SCRIPTED: NO-ANSWER" : "SCRIPTED: RECORDED"}
              </Badge>
            </div>
            <CardDescription>
              PWS-9QM2 — the settlement record&apos;s availability is scripted through the
              mock&apos;s scriptable-availability surface. This scripting is applied to the
              shared server-side mock: open{" "}
              <Link
                href="/track/PWS-9QM2"
                className="font-medium underline underline-offset-4"
              >
                /track/PWS-9QM2
              </Link>{" "}
              to see the same render on the real surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Link
                href="/verification/tracking-flow?evidence=recorded"
                className={buttonVariants({
                  variant: evidenceDemo.mode === "recorded" ? "default" : "outline",
                  size: "sm",
                })}
              >
                Script settlement record: recorded
              </Link>
              <Link
                href="/verification/tracking-flow?evidence=no-answer"
                className={buttonVariants({
                  variant: evidenceDemo.mode === "no-answer" ? "default" : "outline",
                  size: "sm",
                })}
              >
                Script settlement record: no-answer
              </Link>
            </div>
            {evidenceDemo.scriptedView ? (
              <EvidenceTrail evidenceTrail={evidenceDemo.scriptedView.evidenceTrail} />
            ) : (
              <p className="text-sm text-muted-foreground">Lookup did not return a view.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Separator className="my-10" />

      {/* 3. Role matrix */}
      <section aria-labelledby="vf-roles-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="vf-roles-heading" className="text-xl font-semibold tracking-tight">
            3. Role matrix — direct-entry lookup by viewer audience
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            What the port answers for each audience on direct entry to{" "}
            <span className="font-mono">/track/[referenceId]</span>. The page resolves the
            viewer audience server-side (resolveShellAudience, least-visibility fallback{" "}
            <span className="font-mono">unauthenticated</span>) and passes it to the port,
            which performs the per-reference authorization. NOT AUTHORIZED reveals no state,
            history, or evidence.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-32">Audience</TableHead>
                {roleMatrix.references.map((reference) => (
                  <TableHead key={reference.referenceId} className="min-w-40">
                    <span className="font-mono">{reference.referenceId}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {reference.subjectKind}
                      {reference.authorizedAudiences.length > 0
                        ? ` · ${reference.authorizedAudiences.join(", ")}`
                        : " · matches nothing"}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {roleMatrix.rows.map((row) => (
                <TableRow key={row.audience}>
                  <TableCell className="font-medium">{row.audience}</TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.referenceId}>
                      <RoleMatrixCell cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Audience visibility shown per column header is a presentation choice of the mock
          session records; the real per-reference authorization is owned by the authorities
          behind the port. Unauthenticated viewers are not authorized for any reference in
          this session (no anonymous tracking).
        </p>
      </section>

      <Separator className="my-10" />

      {/* 4. Adapter boundary report */}
      <section aria-labelledby="vf-boundary-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="vf-boundary-heading" className="text-xl font-semibold tracking-tight">
            4. Adapter boundary report
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The mock self-describes: non-authoritative, presentation-only, runtime ARRIVING,
            authority owner named. When the live tracking adapter lands, it replaces the
            backing at getTrackingPort() and only there — no surface or component changes.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-2 p-4 text-sm sm:p-6">
            <p>
              <span className="font-medium">Surface:</span> {boundary.surface}
            </p>
            <p>
              <span className="font-medium">Port:</span>{" "}
              <span className="font-mono text-xs">{boundary.portModule}</span> ·{" "}
              <span className="font-medium">Backing:</span>{" "}
              <span className="font-mono text-xs">{boundary.backingModule}</span> (
              {boundary.backingKind})
            </p>
            <p>
              <span className="font-medium">Runtime:</span>{" "}
              <Badge variant="secondary">{boundary.runtime}</Badge>{" "}
              <span className="font-medium">Authoritative:</span>{" "}
              {boundary.authoritative ? "yes" : "no"} ·{" "}
              <span className="font-medium">Presentation-only:</span>{" "}
              {boundary.presentationOnly ? "yes" : "no"}
            </p>
            <p>
              <span className="font-medium">Authority owner:</span> {boundary.authorityOwner} (
              {boundary.authorityOwnerSource})
            </p>
            <p>
              <span className="font-medium">Scriptable for verification:</span>{" "}
              {boundary.scriptable.join("; ")}
            </p>
            <p className="text-muted-foreground">{boundary.note}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mapping records (UX contract, Section 8)</CardTitle>
            <CardDescription>
              Every tracked consequential state carries a complete nine-question record in
              spec/product/tracking-mapping-records.md.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {Object.values(TRACKING_MAPPING_RECORD_IDS).map((id) => (
                <li key={id}>
                  <Badge variant="outline" className="font-mono">
                    {id}
                  </Badge>
                </li>
              ))}
              <li>
                <Badge variant="outline" className="font-mono">
                  {EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID}
                </Badge>
              </li>
              <li>
                <Badge variant="outline" className="font-mono">
                  {LOOKUP_NOT_FOUND_MAPPING_RECORD_ID}
                </Badge>
              </li>
              <li>
                <Badge variant="outline" className="font-mono">
                  {LOOKUP_NOT_AUTHORIZED_MAPPING_RECORD_ID}
                </Badge>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
