import { AlertCircle, Lock, SearchX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { TrackingLookupResult } from "@/lib/protocol/tracking-port";
import {
  LOOKUP_NOT_AUTHORIZED_MAPPING_RECORD_ID,
  LOOKUP_NOT_FOUND_MAPPING_RECORD_ID,
} from "@/lib/protocol/tracking-state-mapping";

/**
 * UI-005 — the two non-tracked lookup outcomes.
 *
 * Neither of these is a consequential state, so neither renders a
 * consequential-state primitive: the reference either does not match any
 * tracked reference (not-found), or it is tracked but the current viewer
 * role is not authorized to see it (not-authorized — no state, history, or
 * evidence is revealed). Both are explicit, unambiguous results; the role
 * check on direct entry is enforced server-side before anything renders.
 */

export function TrackNotFoundView({ result }: { result: Extract<TrackingLookupResult, { kind: "not-found" }> }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 data-slot="card-title" className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm">
            No tracked reference matches this lookup
          </h2>
          <Badge variant="secondary">NOT FOUND</Badge>
        </div>
        <CardDescription>
          Searched for <span className="font-mono">{result.searchedReference || "(empty)"}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <SearchX aria-hidden="true" />
          <AlertTitle>Nothing was found for this reference</AlertTitle>
          <AlertDescription>{result.wording}</AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">What you can do next:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Check the reference and enter it again — references are case-insensitive.</li>
          <li>
            Ask the party who gave you the reference (the payer, the merchant, or support) to
            confirm it.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Reported by {result.reportedBy} · Mapping record{" "}
          <span className="font-mono">{LOOKUP_NOT_FOUND_MAPPING_RECORD_ID}</span>
        </p>
      </CardContent>
    </Card>
  );
}

export function TrackNotAuthorizedView({
  result,
}: {
  result: Extract<TrackingLookupResult, { kind: "not-authorized" }>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 data-slot="card-title" className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm">
            This reference is not viewable in your current role
          </h2>
          <Badge variant="secondary">NOT AUTHORIZED</Badge>
        </div>
        <CardDescription>
          Reference <span className="font-mono">{result.searchedReference}</span> · You are
          viewing as <span className="font-semibold">{result.viewerAudience}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <Lock aria-hidden="true" />
          <AlertTitle>Not authorized to view this reference</AlertTitle>
          <AlertDescription>{result.wording}</AlertDescription>
        </Alert>
        <p className="text-sm">{result.viewableBy}</p>
        <p className="text-sm text-muted-foreground">What you can do next:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Sign in with — or switch to — a role that is authorized for this reference.</li>
          <li>
            If you believe you should have access, contact PaySwap support with this reference.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Reported by {result.reportedBy} · Mapping record{" "}
          <span className="font-mono">{LOOKUP_NOT_AUTHORIZED_MAPPING_RECORD_ID}</span>
        </p>
      </CardContent>
    </Card>
  );
}
