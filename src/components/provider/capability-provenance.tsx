/**
 * UI-004 — Capability provenance.
 *
 * Presents who reports the capability truth: the reporting authority
 * service, the authority owner, the reporting source and its availability,
 * the report timestamp, the evidence anchor, the display mapping record, and
 * the adapter boundary status. Provenance is what makes the read-only
 * surface auditable: every state shown is attributable to its authority.
 */
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type {
  CapabilityBoundaryInfo,
  CapabilityItem,
} from "@/lib/protocol/capability-port";
import { resolveCapabilityDisplayState } from "@/lib/protocol/capability-state-mapping";

const AVAILABILITY_LABELS: Record<CapabilityItem["source"]["availability"], string> = {
  reachable: "reachable",
  degraded: "degraded (partial data)",
  unreachable: "unavailable",
};

function formatReportedAt(iso: string): string {
  const date = new Date(iso);
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

export function CapabilityProvenance({
  item,
  boundary,
}: {
  item: CapabilityItem;
  boundary: CapabilityBoundaryInfo;
}) {
  const { descriptor, report, source } = item;
  const display = resolveCapabilityDisplayState(item);
  const evidence =
    report?.evidence ??
    (source.recordHref
      ? { label: `${source.name} record`, href: source.recordHref }
      : null);

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reported by
        </dt>
        <dd className="text-sm">
          {report ? report.reportedBy : "— no authoritative report"}
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Authority owner
        </dt>
        <dd className="text-sm">{source.authority}</dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reporting source
        </dt>
        <dd className="flex flex-wrap items-center gap-2 text-sm">
          <span>{source.name}</span>
          <Badge
            variant="outline"
            className={
              source.availability === "reachable"
                ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                : "border-dashed border-zinc-400 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
            }
          >
            {AVAILABILITY_LABELS[source.availability]}
          </Badge>
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reported at
        </dt>
        <dd className="text-sm">
          {report ? formatReportedAt(report.reportedAt) : "—"}
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Authority state
        </dt>
        <dd className="text-sm">
          {report ? report.state : "cannot be determined (source unavailable)"}
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Display mapping
        </dt>
        <dd className="text-sm">
          {display.kind} · record {display.recordId} ·{" "}
          spec/product/capability-mapping-records.md
        </dd>

        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Evidence
        </dt>
        <dd className="text-sm">
          {evidence ? (
            <a
              href={evidence.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
            >
              {evidence.label}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            "— not available while the source is unavailable"
          )}
        </dd>
      </dl>

      <Separator />

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Adapter boundary
        </p>
        <p className="text-xs text-muted-foreground">
          Runtime: {boundary.runtime} · backing: {boundary.backing} ·{" "}
          {boundary.authoritative ? "authoritative" : "NON-AUTHORITATIVE"} ·
          authority owner: {boundary.authorityOwner}
        </p>
        <p className="text-xs text-muted-foreground">{boundary.notes}</p>
        <p className="text-xs text-muted-foreground">
          Port: src/lib/protocol/capability-port.ts · mock:{" "}
          src/lib/protocol/mock-capability-authority.ts
        </p>
      </div>

      <p className="sr-only">
        Provenance for {descriptor.name}: reported by{" "}
        {report ? report.reportedBy : "no authoritative report"} from{" "}
        {source.name}.
      </p>
    </div>
  );
}
