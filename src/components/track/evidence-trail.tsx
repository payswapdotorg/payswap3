import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UnknownState } from "@/components/state";
import type { EvidenceRecordView } from "@/lib/protocol/tracking-port";
import {
  EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID,
  resolveEvidenceRecordDisplay,
} from "@/lib/protocol/tracking-state-mapping";
import { formatAuthorityTime } from "./history-list";

/**
 * UI-005 — the evidence/proof-trail presentation.
 *
 * The records behind the outcome are listed with authority, time, and
 * outcome wording — presented exactly as recorded, never fabricated,
 * synthesized, or extrapolated. An evidence record the authority cannot
 * answer for renders UNKNOWN for that record (the shared UnknownState
 * primitive with its reconciliation path), never a synthesized substitute.
 * Each record is anchor-addressable (evidence-<recordId>) so evidence links
 * reproduce the record in place.
 */

export function EvidenceTrail({
  evidenceTrail,
}: {
  evidenceTrail: readonly EvidenceRecordView[];
}) {
  // UI-009: instance-unique landmark ids and accessible names — the
  // verification harness renders this section per view; repeated identical
  // landmark names break landmark uniqueness there. The visible heading text
  // is unchanged, and record-level anchors (evidence-<recordId>) are untouched.
  const firstRecordId = evidenceTrail[0]?.recordId ?? "empty";
  const sectionId = `evidence-trail-${firstRecordId}`;
  const headingId = `track-evidence-heading-${firstRecordId}`;

  return (
    <section
      id={sectionId}
      aria-label={`Proof trail — ${firstRecordId}`}
      className="space-y-3"
    >
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">
        Proof trail
      </h2>
      <p className="text-sm text-muted-foreground">
        The records behind this outcome, listed with the authority that owns each record, the
        time it was recorded, and its outcome wording — presented, never synthesized. A record
        the authority has not answered for renders as unknown for that record.
      </p>
      {evidenceTrail.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No evidence records have been listed for this outcome yet.
        </p>
      ) : (
        <ol className="space-y-4">
          {evidenceTrail.map((record) => {
            const display = resolveEvidenceRecordDisplay(record);
            return (
              <li
                key={record.recordId}
                id={`evidence-${record.recordId}`}
                className="scroll-mt-24"
              >
                {display.kind === "recorded" ? (
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{display.label}</CardTitle>
                        <Badge variant="secondary">RECORDED</Badge>
                      </div>
                      <CardDescription>
                        {display.owningAuthority} · {formatAuthorityTime(display.recordedAt)} UTC
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm leading-relaxed">{display.outcomeWording}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        record {display.recordId}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    <Badge
                      variant="outline"
                      className="border-zinc-400 bg-zinc-50 font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100"
                    >
                      RECORD: UNKNOWN
                    </Badge>
                    <UnknownState {...display.unknownProps} />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Owning authority: {display.owningAuthority} · Record{" "}
                      <span className="font-mono">{display.recordId}</span> · Mapping record{" "}
                      <span className="font-mono">{EVIDENCE_UNAVAILABLE_MAPPING_RECORD_ID}</span>
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
