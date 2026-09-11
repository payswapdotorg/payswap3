"use client";

/**
 * UI-008 — Mediation/dispute verification harness (client).
 *
 * Drives the REAL UI-008 views (ProposalReviewView, MediationThreadView,
 * DisputeInitiationForm, RecourseTracker) through the REAL API surface
 * (/api/mediation/decision|action|dispute|record|script), so the workflow
 * evidence exercises the exact code the party surfaces use. The actor for
 * every request is resolved server-side from the shell audience cookie; this
 * harness only switches the simulated audience (POST /api/shell/audience) and
 * scripts AUTHORITY-OWNED outcomes on the mock for state coverage including
 * UNKNOWN. It never scripts a proposal decision.
 *
 * State management: zustand (announcement log + current audience), per the
 * UI-008 technology contract.
 */

import * as React from "react";
import { create } from "zustand";
import { Loader2, RefreshCw, ScrollText, Terminal, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AvailabilityUnknownState } from "@/components/state";
import type {
  AgentProposal,
  DisputableIntent,
  DisputeInitiationBriefing,
  DisputeRecord,
  MediationCase,
  MediationHarnessScript,
  PartyRole,
  PortFetch,
} from "@/lib/protocol/mediation-port";
import { ProposalReviewView } from "@/components/mediation/proposal-review-view";
import { MediationThreadView } from "@/components/mediation/mediation-thread-view";
import { DisputeInitiationForm } from "@/components/dispute/dispute-initiation-form";
import { RecourseTracker } from "@/components/dispute/recourse-tracker";

const AUDIENCES = [
  "unauthenticated",
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
] as const;

const PROPOSAL_ID = "P-001";
const MEDIATION_ID = "M-101";
const DISPUTE_ID = "D-201";

interface HarnessStore {
  audience: string;
  log: readonly { at: number; message: string }[];
  setAudience: (audience: string) => void;
  pushLog: (message: string) => void;
}

const useHarnessStore = create<HarnessStore>((set) => ({
  audience: "unauthenticated",
  log: [],
  setAudience: (audience) => set({ audience }),
  pushLog: (message) =>
    set((state) => ({
      log: [...state.log.slice(-59), { at: Date.now(), message }],
    })),
}));

type ProposalFetch = PortFetch<AgentProposal>;
type MediationFetch = PortFetch<MediationCase>;
type DisputeFetch = PortFetch<DisputeRecord>;

const SCENARIO_GROUPS: readonly {
  label: string;
  scripts: readonly { label: string; script: MediationHarnessScript }[];
}[] = [
  {
    label: "Mock reset",
    scripts: [{ label: "Reseed mock defaults", script: { type: "reset" } }],
  },
  {
    label: "Proposal P-001 (authority-owned states — decisions are never scripted)",
    scripts: [
      { label: "awaiting-decision", script: { type: "set-proposal-state", proposalId: PROPOSAL_ID, authorityState: "awaiting-decision" } },
      { label: "expired", script: { type: "set-proposal-state", proposalId: PROPOSAL_ID, authorityState: "expired" } },
      { label: "authority-unreachable (UNKNOWN)", script: { type: "set-proposal-state", proposalId: PROPOSAL_ID, authorityState: "authority-unreachable" } },
    ],
  },
  {
    label: "Mediation M-101 (authority-owned outcomes)",
    scripts: [
      { label: "open", script: { type: "set-mediation-state", caseId: MEDIATION_ID, authorityState: "open" } },
      { label: "awaiting-party", script: { type: "set-mediation-state", caseId: MEDIATION_ID, authorityState: "awaiting-party" } },
      { label: "resolved", script: { type: "set-mediation-state", caseId: MEDIATION_ID, authorityState: "resolved" } },
      { label: "failed", script: { type: "set-mediation-state", caseId: MEDIATION_ID, authorityState: "failed" } },
      { label: "authority-unreachable (UNKNOWN)", script: { type: "set-mediation-state", caseId: MEDIATION_ID, authorityState: "authority-unreachable" } },
      { label: "set proposed resolution", script: { type: "set-proposed-resolution", caseId: MEDIATION_ID } },
      { label: "clear proposed resolution", script: { type: "clear-proposed-resolution", caseId: MEDIATION_ID } },
      { label: "add authority notice", script: { type: "add-authority-notice", caseId: MEDIATION_ID, body: "The Mediation Authority notes the carrier re-confirmed the delivery scan timestamp on its own record." } },
    ],
  },
  {
    label: "Dispute D-201 (authority-owned outcomes)",
    scripts: [
      { label: "open", script: { type: "set-dispute-state", disputeId: DISPUTE_ID, authorityState: "open" } },
      { label: "in-mediation", script: { type: "set-dispute-state", disputeId: DISPUTE_ID, authorityState: "in-mediation" } },
      { label: "resolved", script: { type: "set-dispute-state", disputeId: DISPUTE_ID, authorityState: "resolved" } },
      { label: "failed", script: { type: "set-dispute-state", disputeId: DISPUTE_ID, authorityState: "failed" } },
      { label: "authority-unreachable (UNKNOWN)", script: { type: "set-dispute-state", disputeId: DISPUTE_ID, authorityState: "authority-unreachable" } },
      { label: "advance federation-escalation stage", script: { type: "advance-recourse", disputeId: DISPUTE_ID, stepId: "D-201-step-4" } },
    ],
  },
  {
    label: "Fetch availability (AvailabilityUnknown — MD-400)",
    scripts: [
      { label: "proposal fetch unreachable", script: { type: "set-fetch-availability", scope: "proposal", unreachable: true } },
      { label: "proposal fetch reachable", script: { type: "set-fetch-availability", scope: "proposal", unreachable: false } },
      { label: "mediation fetch unreachable", script: { type: "set-fetch-availability", scope: "mediation", unreachable: true } },
      { label: "mediation fetch reachable", script: { type: "set-fetch-availability", scope: "mediation", unreachable: false } },
      { label: "dispute fetch unreachable", script: { type: "set-fetch-availability", scope: "dispute", unreachable: true } },
      { label: "dispute fetch reachable", script: { type: "set-fetch-availability", scope: "dispute", unreachable: false } },
    ],
  },
];

export function MediationFlowHarness({
  initialAudience,
  briefing,
  intents,
}: {
  initialAudience: string;
  briefing: DisputeInitiationBriefing;
  intents: readonly DisputableIntent[];
}) {
  const audience = useHarnessStore((state) => state.audience);
  const setAudience = useHarnessStore((state) => state.setAudience);
  const pushLog = useHarnessStore((state) => state.pushLog);
  const log = useHarnessStore((state) => state.log);

  const [proposalFetch, setProposalFetch] = React.useState<ProposalFetch | null>(null);
  const [mediationFetch, setMediationFetch] = React.useState<MediationFetch | null>(null);
  const [disputeFetch, setDisputeFetch] = React.useState<DisputeFetch | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setAudience(initialAudience);
  }, [initialAudience, setAudience]);

  const onAnnounce = React.useCallback(
    (message: string) => {
      pushLog(message);
    },
    [pushLog],
  );

  const refreshAll = React.useCallback(async () => {
    setBusy(true);
    try {
      const [proposal, mediation, dispute] = await Promise.all([
        fetch(`/api/mediation/record?type=proposal&id=${PROPOSAL_ID}`).then((r) => r.json()),
        fetch(`/api/mediation/record?type=mediation&id=${MEDIATION_ID}`).then((r) => r.json()),
        fetch(`/api/mediation/record?type=dispute&id=${DISPUTE_ID}`).then((r) => r.json()),
      ]);
      setProposalFetch((proposal as ProposalFetch) ?? null);
      setMediationFetch((mediation as MediationFetch) ?? null);
      setDisputeFetch((dispute as DisputeFetch) ?? null);
      setRefreshKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function switchAudience(next: string) {
    setBusy(true);
    try {
      await fetch("/api/shell/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: next }),
      });
      setAudience(next);
      pushLog(`Shell audience switched to ${next} (server-side actor resolution from here on).`);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function runScript(script: MediationHarnessScript) {
    setBusy(true);
    try {
      const response = await fetch("/api/mediation/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(script),
      });
      const result = (await response.json()) as { applied: string; note: string };
      pushLog(`Harness script → ${result.applied}. ${result.note}`);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  const partyViewer: PartyRole | null =
    audience === "customer" || audience === "merchant" ? (audience as PartyRole) : null;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
            Harness controls
          </CardTitle>
          <CardDescription>
            Switch the simulated shell audience, script authority-owned outcomes on the mock
            (state coverage incl. UNKNOWN), and refresh the record fetches. Decisions are never
            scripted: use the live views below, which submit through the real API with the actor
            resolved server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" aria-hidden="true" />
              Simulated shell audience
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Simulated shell audience">
              {AUDIENCES.map((entry) => (
                <Button
                  key={entry}
                  type="button"
                  size="sm"
                  variant={entry === audience ? "default" : "outline"}
                  className="min-h-9"
                  aria-current={entry === audience ? "true" : undefined}
                  disabled={busy}
                  onClick={() => void switchAudience(entry)}
                >
                  {entry}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-9"
                disabled={busy}
                onClick={() => void refreshAll()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                Refresh records
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Current audience: <span className="font-medium text-foreground">{audience}</span>.
              Record fetches as non-party roles return role-checked denials — that is P8 evidence,
              not an error.
            </p>
          </div>

          {SCENARIO_GROUPS.map((group) => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.scripts.map((entry) => (
                  <Button
                    key={entry.label}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-9"
                    disabled={busy}
                    onClick={() => void runScript(entry.script)}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <section aria-labelledby="workflow-proposal-heading" className="space-y-3">
        <h2 id="workflow-proposal-heading" className="text-lg font-semibold">
          Proposal decision workflow — live evidence
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The real ProposalReviewView, fetched as the current audience. Consequence-first review,
          explicit single-intent decisions with inline consequence-restating confirmation,
          disabled-with-reason for unauthorized roles, and polite announcements on every outcome.
          Script P-001 to expired or UNKNOWN and re-observe; decide it as the merchant; counter to
          spawn a counterparty decision proposal.
        </p>
        <RecordFetchBranch
          label={`Proposal ${PROPOSAL_ID} as ${audience}`}
          fetch={proposalFetch}
          render={(record) => (
            <ProposalReviewView
              key={`proposal-${refreshKey}-${audience}`}
              initialProposal={record}
              viewer={(partyViewer ?? "provider") as PartyRole}
              viewerLabel={
                record.addressedTo.role === (partyViewer ?? "provider")
                  ? record.addressedTo.label
                  : record.counterparty.label
              }
              onAnnounce={onAnnounce}
            />
          )}
        />
      </section>

      <section aria-labelledby="workflow-mediation-heading" className="space-y-3">
        <h2 id="workflow-mediation-heading" className="text-lg font-semibold">
          Mediation participation — live evidence
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The real MediationThreadView for M-101 as the current audience: explicit states (open,
          awaiting a party, resolved with the authority&apos;s exact wording, failed, UNKNOWN with
          reconciliation), a proposed resolution requiring inline-confirmed party decisions, and a
          party statement composer. Script the mediation states above and re-observe.
        </p>
        <RecordFetchBranch
          label={`Mediation ${MEDIATION_ID} as ${audience}`}
          fetch={mediationFetch}
          render={(record) => (
            <MediationThreadView
              key={`mediation-${refreshKey}-${audience}`}
              initialCase={record}
              viewer={(partyViewer ?? "provider") as PartyRole}
              viewerLabel={
                record.parties.find((entry) => entry.party.role === (partyViewer ?? "provider"))
                  ?.party.label ?? `${audience} (harness viewer)`
              }
              onAnnounce={onAnnounce}
            />
          )}
        />
      </section>

      <section aria-labelledby="workflow-dispute-heading" className="space-y-3">
        <h2 id="workflow-dispute-heading" className="text-lg font-semibold">
          Dispute initiation + recourse tracking — live evidence
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Left: the real DisputeInitiationForm as the current audience (explicit grounds, evidence
          references, consequence wording, inline confirmation; authority denials displayed — try
          INTENT-2038, which already has an open dispute). Right: the real RecourseTracker for
          D-201 with its proof trail; advance the federation-escalation stage from the controls to
          watch a stage complete with proof.
        </p>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Dispute initiation</CardTitle>
              <CardDescription>
                Viewer: {audience}. Party roles see the reference list; the authority re-validates
                on submission.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DisputeInitiationForm
                key={`initiation-${refreshKey}-${audience}`}
                viewer={(partyViewer ?? "provider") as PartyRole}
                viewerLabel={`${audience} (harness viewer)`}
                briefing={briefing}
                intents={intents}
                onAnnounce={onAnnounce}
              />
            </CardContent>
          </Card>
          <RecordFetchBranch
            label={`Dispute ${DISPUTE_ID} as ${audience}`}
            fetch={disputeFetch}
            render={(record) => (
              <RecourseTracker
                key={`dispute-${refreshKey}-${audience}`}
                initialDispute={record}
                viewer={(partyViewer ?? "provider") as PartyRole}
                viewerLabel={
                  record.openedBy.role === (partyViewer ?? "provider")
                    ? record.openedBy.label
                    : record.against.label
                }
                onAnnounce={onAnnounce}
              />
            )}
          />
        </div>
      </section>

      <section aria-labelledby="announcement-log-heading" className="space-y-3">
        <h2 id="announcement-log-heading" className="text-lg font-semibold">
          Accessibility evidence — announcements, live regions, keyboard operability
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-muted-foreground" aria-hidden="true" />
              Announcement log (what the live regions say)
            </CardTitle>
            <CardDescription>
              Every entry below is ALSO rendered into a real sr-only role=&quot;status&quot;
              aria-live=&quot;polite&quot; region inside the operating view (see
              data-announcement-region in the DOM), set after mount and on change. Decision
              controls are native buttons: reachable by Tab, activated by Enter/Space, confirmable
              inline, cancellable with Escape.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No announcements yet. Decide, act, script, or recheck above — every outcome will be
                logged here exactly as announced.
              </p>
            ) : (
              <ol className="max-h-96 space-y-2 overflow-y-auto pr-2 [scrollbar-width:thin]">
                {log
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li
                      key={`${entry.at}-${entry.message.slice(0, 24)}`}
                      className="rounded-lg border bg-card p-3 text-xs leading-relaxed"
                    >
                      <span className="mr-2 font-mono text-muted-foreground">
                        {new Date(entry.at).toISOString().slice(11, 23)}
                      </span>
                      {entry.message}
                    </li>
                  ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function RecordFetchBranch<T>({
  label,
  fetch,
  render,
}: {
  label: string;
  fetch: PortFetch<T> | null;
  render: (record: T) => React.ReactNode;
}) {
  if (!fetch) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Fetching {label} from the authority…
          </p>
        </CardContent>
      </Card>
    );
  }
  if (fetch.kind === "fetched") {
    return <div className="space-y-4">{render(fetch.record)}</div>;
  }
  if (fetch.kind === "not-visible") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label} — role-checked denial</CardTitle>
          <CardDescription>Deep links and record queries are role-checked (P8).</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert role="alert">
            <AlertTitle>Not visible to your role</AlertTitle>
            <AlertDescription>{fetch.reason}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label} — availability UNKNOWN</CardTitle>
      </CardHeader>
      <CardContent>
        <AvailabilityUnknownState target={fetch.target} detail={fetch.detail} />
      </CardContent>
    </Card>
  );
}
