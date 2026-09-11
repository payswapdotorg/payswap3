/**
 * Waiting flow verification page — UI-006.
 *
 * Verification surface for the waiting/queued/delayed UX with recovery,
 * mirroring the /verification/*-flow pattern of UI-002, UI-003, UI-004, and
 * UI-005. Server-rendered header plus the client harness that scripts the
 * NON-AUTHORITATIVE mock backing.
 */

import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WaitingFlowHarness } from "@/components/verification/waiting-flow-harness";
import {
  WAITING_PORT_AUTHORITY_OWNER,
  WAITING_PORT_RUNTIME_STATUS,
} from "@/lib/protocol/waiting-port";
import { WAITING_MAPPING_DOC_PATH } from "@/lib/protocol/waiting-state-mapping";

export const metadata: Metadata = {
  title: "Waiting flow verification — payswap3",
  description:
    "UI-006 verification harness: waiting/queued/delayed matrix, recovery authorization, reconciliation visibility, live-region announcements, and the adapter boundary report.",
};

export default function VerificationWaitingFlowPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Waiting flow verification
          </h1>
          <Badge variant="secondary">{WAITING_PORT_RUNTIME_STATUS}</Badge>
          <Badge variant="outline">UI-006</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Verifies the waiting, queued, and delayed fulfillment UX on the track surface:
          reason, expectation, and available actions (or the explicit none-yet) on every
          state; UNKNOWN with its reconciliation path; explicit endings including
          still-unknown; individually authorized recovery; and accessible announcements.
          Everything below runs against the mock backing.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Verification scope</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            Authority owner: {WAITING_PORT_AUTHORITY_OWNER}. Runtime:{" "}
            {WAITING_PORT_RUNTIME_STATUS} — the mock is presentation-only and
            NON-AUTHORITATIVE; sandbox data only.
          </p>
          <p>
            Mapping records for every waiting and recovery consequential state live in{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {WAITING_MAPPING_DOC_PATH}
            </code>{" "}
            (WQ-01…WQ-16); the display mapping mirrors them one-to-one in{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              src/lib/protocol/waiting-state-mapping.ts
            </code>
            .
          </p>
        </CardContent>
      </Card>

      <WaitingFlowHarness />
    </div>
  );
}
