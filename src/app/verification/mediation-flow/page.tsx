import { resolveShellAudience } from "@/lib/shell-audience-server";
import { getMediationPort } from "@/lib/protocol/mediation-port";
import {
  DISPUTE_MAPPING_TABLE,
  FETCH_MAPPING_ROW,
  MEDIATION_MAPPING_TABLE,
  MEDIATION_AUTHORITIES,
  PROPOSAL_MAPPING_TABLE,
  RECOURSE_MAPPING_TABLE,
} from "@/lib/protocol/mediation-state-mapping";
import { MediationFlowHarness } from "@/components/verification/mediation-flow-harness";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * UI-008 — Verification harness: /verification/mediation-flow.
 *
 * Evidence surfaces:
 * - Proposal/decision workflow across outcomes including UNKNOWN (client
 *   harness drives the real views through the real API surface).
 * - Decision-authorization matrix: per decision per role, authorized vs
 *   denied with reason (server-rendered from the port).
 * - Mediation/dispute state matrix incl. UNKNOWN (mapping tables + live views).
 * - Recourse proof-trail evidence (live recourse tracker).
 * - Adapter boundary report.
 */

export const dynamic = "force-dynamic";

const PROPOSAL_DECISION_LABELS: Record<string, string> = {
  accept: "Accept",
  reject: "Reject",
  counter: "Counter",
  escalate: "Escalate",
};

const MEDIATION_ACTION_LABELS: Record<string, string> = {
  "submit-statement": "Submit statement",
  "accept-proposed-resolution": "Accept resolution",
  "decline-proposed-resolution": "Decline resolution",
};

export default async function MediationFlowVerificationPage() {
  const audience = await resolveShellAudience();
  const port = getMediationPort();
  const [proposalMatrix, mediationMatrix, disputeMatrix, briefing, customerDocket] =
    await Promise.all([
      port.describeProposalDecisionMatrix({ proposalId: "P-001" }),
      port.describeMediationActionMatrix({ caseId: "M-101" }),
      port.describeDisputeInitiationMatrix({ intentReference: "INTENT-2038" }),
      port.getDisputeInitiationBriefing(),
      port.getPartyDocket("customer"),
    ]);
  const intents = customerDocket.kind === "fetched" ? customerDocket.record.disputableIntents : [];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Verification — mediation &amp; dispute flow (UI-008)
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Harness evidence for the agent-proposal review/decision workflow, the per-role
          decision-authorization matrix, the mediation/dispute state matrix including UNKNOWN, and
          the recourse proof trail. All data flows through the adapter boundary
          (src/lib/protocol/mediation-port.ts) to the presentation-only mock authority — runtime
          ARRIVING, never authoritative.
        </p>
        <p className="text-xs text-muted-foreground">
          Server-resolved shell audience at load: <span className="font-medium">{audience}</span>.
          The harness can switch the simulated audience below; every request resolves the actor
          server-side from the shell audience cookie.
        </p>
      </header>

      <MediationFlowHarness
        initialAudience={audience}
        briefing={briefing}
        intents={intents}
      />

      <section aria-labelledby="authorization-matrix-heading" className="space-y-4">
        <h2 id="authorization-matrix-heading" className="text-lg font-semibold">
          Decision-authorization matrix (per decision, per role)
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Authorization is protocol-owned: the addressee decides; the counterparty, providers,
          operators, and administrators are denied with reasons. Disabled controls on the live
          surfaces carry the same reasons, and the authority re-validates every submission.
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Agent proposal P-001 — decisions × roles</CardTitle>
            <CardDescription>
              P-001 is addressed to the merchant; the customer is the counterparty.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  {["accept", "reject", "counter", "escalate"].map((decision) => (
                    <TableHead key={decision}>{PROPOSAL_DECISION_LABELS[decision]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposalMatrix.map((row) => (
                  <TableRow key={row.role}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    {row.entries.map((entry) => (
                      <TableCell key={entry.decision} className="min-w-56 align-top">
                        <AuthorizationCell authorized={entry.authorized} reason={entry.reason} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mediation M-101 — party actions × roles</CardTitle>
            <CardDescription>
              M-101 has a proposed resolution open; only its parties may act.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  {[
                    "submit-statement",
                    "accept-proposed-resolution",
                    "decline-proposed-resolution",
                  ].map((action) => (
                    <TableHead key={action}>{MEDIATION_ACTION_LABELS[action]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {mediationMatrix.map((row) => (
                  <TableRow key={row.role}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    {row.entries.map((entry) => (
                      <TableCell key={entry.action} className="min-w-56 align-top">
                        <AuthorizationCell authorized={entry.authorized} reason={entry.reason} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispute initiation on INTENT-2038 — per role</CardTitle>
            <CardDescription>
              INTENT-2038 already carries an open dispute (D-201), so even parties are denied with
              the duplicate-dispute reason — evidence that initiation is authority-gated, not
              client-gated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Initiate a dispute</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disputeMatrix.map((row) => (
                  <TableRow key={row.role}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="min-w-56 align-top">
                      <AuthorizationCell authorized={row.authorized} reason={row.reason} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="state-matrix-heading" className="space-y-4">
        <h2 id="state-matrix-heading" className="text-lg font-semibold">
          Mediation/dispute state matrix (one-to-one mapping incl. UNKNOWN)
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every authority-reported state maps to exactly one shared primitive with a mapping-record
          id (MD-*). Script the live surfaces above to observe each presentation; these tables are
          the mapping of record.
        </p>
        {(
          [
            ["Agent proposals", PROPOSAL_MAPPING_TABLE],
            ["Mediations", MEDIATION_MAPPING_TABLE],
            ["Disputes", DISPUTE_MAPPING_TABLE],
            ["Recourse stages", RECOURSE_MAPPING_TABLE],
          ] as const
        ).map(([label, table]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record id</TableHead>
                    <TableHead>Authority state</TableHead>
                    <TableHead>Display primitive</TableHead>
                    <TableHead>One-line mapping</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.map((row) => (
                    <TableRow key={row.recordId}>
                      <TableCell className="font-mono text-xs">{row.recordId}</TableCell>
                      <TableCell className="font-mono text-xs">{row.authorityState}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.primitive}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.oneLine}</TableCell>
                    </TableRow>
                  ))}
                  {label === "Recourse stages" ? (
                    <TableRow>
                      <TableCell className="font-mono text-xs">{FETCH_MAPPING_ROW.recordId}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {FETCH_MAPPING_ROW.authorityState}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{FETCH_MAPPING_ROW.primitive}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {FETCH_MAPPING_ROW.oneLine}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="boundary-report-heading" className="space-y-4">
        <h2 id="boundary-report-heading" className="text-lg font-semibold">
          Adapter boundary report
        </h2>
        <Card>
          <CardHeader>
            <CardTitle>What is presentation vs what is authority-owned</CardTitle>
            <CardDescription>
              The UI-008 surfaces sit behind a typed port; nothing here is authoritative.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <p className="font-medium">Authority-owned (never computed or rewritten UI-side)</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Mediation/dispute/proposal states, outcome wording, reasons, next actions, and
                  reconciliation paths — reported by {MEDIATION_AUTHORITIES.agentsMediation} and{" "}
                  {MEDIATION_AUTHORITIES.disputesRecourse} (runtime ARRIVING).
                </li>
                <li>
                  Decision authorization (which role may accept/reject/counter/escalate, act in a
                  mediation, or initiate a dispute) — re-validated by the authority on every
                  submission.
                </li>
                <li>
                  Money: authority-quoted strings only, displayed via formatMoney from
                  @/lib/pay-flow/money; the UI never computes totals.
                </li>
                <li>Proof/evidence references and authorization records.</li>
              </ul>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <p className="font-medium">Presentation-owned (this work order)</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  The typed port (src/lib/protocol/mediation-port.ts) declaring the surfaces&apos;
                  data needs, and the one-to-one state mapping
                  (src/lib/protocol/mediation-state-mapping.ts, MD-* records).
                </li>
                <li>
                  The views: proposal-review, mediation-thread, dispute-initiation, recourse
                  tracker, party dockets — consequence-first, explicit decisions, inline
                  confirmations, keyboard operability, polite announcements.
                </li>
                <li>
                  API routes (/api/mediation/decision|action|dispute|record) that resolve the actor
                  server-side from the shell audience cookie and forward single-intent requests to
                  the port.
                </li>
              </ul>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <p className="font-medium">Mock backing (NON-AUTHORITATIVE, runtime ARRIVING)</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  src/lib/protocol/mock-mediation-authority.ts — sandbox data only; owners named
                  per the frozen architecture; scripts authority-owned outcomes for this harness
                  and REFUSES to script proposal decisions (they only flow through
                  submitProposalDecision under per-role authorization).
                </li>
                <li>
                  The script endpoint (/api/mediation/script) exists only for this verification
                  surface and is part of no party surface.
                </li>
              </ul>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <p className="font-medium">Declared swap points</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  State primitives: @/components/state (repo-owned; imported, never modified).
                </li>
                <li>
                  Live-region announcer: src/components/mediation/live-announcements.tsx is a local
                  minimal component — swap for the shared announcer when the state-primitives team
                  ships one (interface: one polite message string).
                </li>
                <li>
                  Navigation: entries declared in spec/product/mediation-nav-entries.json;
                  src/lib/navigation.ts is untouched (READ-ONLY per work order).
                </li>
                <li>
                  Audience resolution and role guards: @/lib/shell-audience-server and
                  @/lib/shell-guard (repo-owned contracts).
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function AuthorizationCell({ authorized, reason }: { authorized: boolean; reason: string }) {
  return (
    <div className="space-y-1">
      <Badge
        variant="outline"
        className={
          authorized
            ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300"
            : "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-red-300"
        }
      >
        {authorized ? "Authorized" : "Denied"}
      </Badge>
      <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>
    </div>
  );
}
