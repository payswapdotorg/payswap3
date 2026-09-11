import Link from "next/link";
import { ArrowLeft, FileSearch, Landmark, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { AvailabilityUnknownState } from "@/components/state";
import type { TrackedReferenceView, TrackingBoundaryReport } from "@/lib/protocol/tracking-port";
import { EvidenceTrail } from "./evidence-trail";
import { TrackHistoryList } from "./history-list";
import { TrackedStateCard } from "./tracked-state-card";

/**
 * UI-005 — the full tracking status view for a tracked reference.
 *
 * Deep-linkable and role-checked on direct entry: the page that renders
 * this component resolved the viewer audience server-side and asked the
 * port (the authority boundary) to authorize the lookup before anything
 * rendered. This component only ever receives an authorized view.
 *
 * Composition: explicit current state (shared primitives, one-to-one from
 * the mapping), plain-language history (authority, time, wording), the
 * complete visible proof trail (records with authority/time/outcome
 * wording; no-answer records render UNKNOWN for the record), and an
 * honest adapter-boundary note — the backing is a presentation-only mock
 * while the live tracking adapter is ARRIVING.
 */

export function TrackingStatusView({
  view,
  boundary,
}: {
  view: TrackedReferenceView;
  boundary: TrackingBoundaryReport;
}) {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-xl leading-snug tracking-tight">{view.subjectWording}</CardTitle>
            <Badge variant="outline" className="font-mono">
              {view.referenceId}
            </Badge>
          </div>
          <CardDescription>
            Tracked {view.subjectKind} · You are viewing as{" "}
            <span className="font-semibold">{view.viewerAudience}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Landmark aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              Protocol object: {view.protocolObject.objectType}{" "}
              <span className="font-mono">{view.protocolObject.objectId}</span> · Owning
              authority: {view.owningAuthority}
            </span>
          </p>
          <Alert>
            <FileSearch aria-hidden="true" />
            <AlertTitle>Non-authoritative presentation</AlertTitle>
            <AlertDescription>
              This view is served by a presentation-only mock while the live tracking adapter
              is ARRIVING. Authority owner: {boundary.authorityOwner} (
              {boundary.authorityOwnerSource}). No value on this page is authoritative.
            </AlertDescription>
          </Alert>
          <Link
            href="/track"
            className={buttonVariants({ variant: "outline", className: "min-h-11" })}
          >
            <ArrowLeft aria-hidden="true" />
            Look up another reference
          </Link>
        </CardContent>
      </Card>

      <TrackedStateCard currentState={view.currentState} />

      <Separator />

      <TrackHistoryList history={view.history} />

      <Separator />

      <EvidenceTrail evidenceTrail={view.evidenceTrail} />

      <Separator />

      <section aria-labelledby="track-about-heading" className="space-y-3">
        <h2 id="track-about-heading" className="text-lg font-semibold tracking-tight">
          About this view
        </h2>
        <AvailabilityUnknownState
          target="the authoritative tracking answer behind this reference"
          detail="The live tracking adapter is ARRIVING. Until it lands, this reference is answered by a presentation-only mock; the availability of the authoritative answer is unknown, and nothing on this page is authoritative."
        />
        <Collapsible>
          <CollapsibleTrigger className="min-h-11 rounded-md text-sm font-medium text-underline-offset-4 underline decoration-muted-foreground/40 hover:decoration-current">
            Adapter boundary report
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              Surface: {boundary.surface} · Port: {boundary.portModule} · Backing:{" "}
              {boundary.backingModule} ({boundary.backingKind}, runtime {boundary.runtime}).
            </p>
            <p>
              Authority owner: {boundary.authorityOwner} ({boundary.authorityOwnerSource}).
              Presentation-only: {boundary.presentationOnly ? "yes" : "no"} · Authoritative:{" "}
              {boundary.authoritative ? "yes" : "no"}.
            </p>
            <p>Scriptable for verification: {boundary.scriptable.join("; ")}.</p>
            <p>{boundary.note}</p>
          </CollapsibleContent>
        </Collapsible>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldQuestion aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Every tracked state on this page carries a complete nine-question mapping record —
          see spec/product/tracking-mapping-records.md.
        </p>
      </section>
    </div>
  );
}
