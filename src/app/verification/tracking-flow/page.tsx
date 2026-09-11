import type { Metadata } from "next";
import type { NavAudience } from "@/lib/navigation";
import type { TrackedReferenceView } from "@/lib/protocol/tracking-port";
import {
  getMockTrackingAuthority,
  MOCK_REFERENCE_SUMMARIES,
} from "@/lib/protocol/mock-tracking-authority";
import { TrackingFlowHarness } from "@/components/verification/tracking-flow-harness";

/**
 * UI-005 — the tracking-flow verification harness page (the intent-flow
 * model applied to tracking).
 *
 * This page drives the REAL adapter boundary: it talks to the mock tracking
 * authority through the same port the /track surfaces use, scripts evidence
 * availability server-side (?evidence=no-answer), and hands the harness
 * component the exact views the product surfaces would render. The harness
 * then re-renders them through the same components — so what is verified
 * here is what ships.
 */

export const metadata: Metadata = {
  title: "UI-005 verification — tracking flow — PaySwap",
  description:
    "Verification harness for the track/status surface: the tracked-state matrix, evidence-trail presentation (including the UNKNOWN-record case), the role matrix, and the adapter boundary report.",
  robots: { index: false, follow: false },
};

const ROLE_MATRIX_REFERENCES: readonly string[] = [
  "PWS-9QM2",
  "PWS-7F3K",
  "PWS-6KLP",
  "STL-4419",
  "PWS-0000",
];

const ROLE_MATRIX_AUDIENCES: readonly NavAudience[] = [
  "unauthenticated",
  "customer",
  "merchant",
  "provider",
  "operator",
  "administrator",
];

export default async function TrackingFlowVerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const evidenceMode = params.evidence === "no-answer" ? "no-answer" : "recorded";

  // Script the shared server-side mock before probing. This is the mock's
  // scriptable-availability surface: the PWS-9QM2 settlement record flips
  // between 'recorded' and 'no-answer'. The fixed no-answer record on
  // PWS-5VBM never answered and can never be scripted into a recorded
  // substitute.
  const authority = getMockTrackingAuthority();
  authority.resetScripting();
  if (evidenceMode === "no-answer") {
    authority.scriptEvidenceAvailability("PWS-9QM2", "ev-9qm2-settlement", "no-answer");
  }

  // Tracked-state matrix: every mock session record, looked up through the
  // port as an operator (authorized for every reference in this session).
  const stateMatrix = await Promise.all(
    MOCK_REFERENCE_SUMMARIES.map(async (summary) => {
      const result = await authority.lookupReference(summary.referenceId, "operator");
      const view: TrackedReferenceView | null =
        result.kind === "tracked" ? result.view : null;
      return {
        referenceId: summary.referenceId,
        subjectWording: summary.subjectWording,
        note: summary.note,
        view,
      };
    })
  );

  // Evidence-trail demo: the scriptable record (PWS-9QM2, as scripted above)
  // and the fixed no-answer record (PWS-5VBM).
  const [scriptedResult, fixedResult] = await Promise.all([
    authority.lookupReference("PWS-9QM2", "operator"),
    authority.lookupReference("PWS-5VBM", "operator"),
  ]);

  // Role matrix: every audience x representative references, straight
  // through the port — exactly what the /track/[referenceId] page does on
  // direct entry.
  const roleMatrixReferences = ROLE_MATRIX_REFERENCES.map((referenceId) => {
    const summary = MOCK_REFERENCE_SUMMARIES.find(
      (candidate) => candidate.referenceId === referenceId
    );
    return {
      referenceId,
      subjectKind: summary?.subjectKind ?? "unknown reference",
      authorizedAudiences: summary?.authorizedAudiences ?? [],
    };
  });

  const roleMatrixRows = await Promise.all(
    ROLE_MATRIX_AUDIENCES.map(async (audience) => ({
      audience,
      cells: await Promise.all(
        ROLE_MATRIX_REFERENCES.map(async (referenceId) => {
          const result = await authority.lookupReference(referenceId, audience);
          return {
            referenceId,
            kind: result.kind,
            stateKind:
              result.kind === "tracked" ? result.view.currentState.state : null,
          };
        })
      ),
    }))
  );

  return (
    <TrackingFlowHarness
      stateMatrix={stateMatrix}
      evidenceDemo={{
        mode: evidenceMode,
        scriptedView: scriptedResult.kind === "tracked" ? scriptedResult.view : null,
        fixedNoAnswerView: fixedResult.kind === "tracked" ? fixedResult.view : null,
      }}
      roleMatrix={{ references: roleMatrixReferences, rows: roleMatrixRows }}
      boundary={authority.describeBoundary()}
    />
  );
}
