/**
 * DEP-004 — Operational jobs: the reconciliation sweep duty (A14).
 *
 * Owned surface: src/lib/operations/reconciliation-sweep.ts (work order
 * DEP-004 — the recurring operational duty the deployment topology names
 * for workers: "reconciliation sweeps").
 *
 * THE DUTY: run the A14 reconciliation machinery's sweep over the
 * authoritative state — the statement-source registry, the window's
 * matching cycle, and the OPEN reconciliation cases — submitting ONLY the
 * A14 command kinds documented on the gateway catalogue
 * (COMMAND-SURFACE.md §A14):
 *
 *   1. SOURCE REGISTRATION — for each configured statement source not yet
 *      registered: `reconciliation.source.register` { kind, description }.
 *      Deterministic source ids (deriveProtocolId('reconciliation-source',
 *      kind, description)) make the derivation idempotent per source.
 *
 *   2. THE WINDOW CYCLE PATH — the deterministic cycle id
 *      (deriveProtocolId('reconciliation-cycle', windowStart, windowEnd,
 *      ruleVersion)) addressed through the authority's cycle read:
 *        cycle absent  → `reconciliation.cycle.open` { window bounds, sourceIds, ruleVersion }
 *        cycle OPEN    → `reconciliation.cycle.statements.collect` { cycleId, statements }
 *                        (the statements come from the job's configured EXTERNAL
 *                        statement provider — job INPUT, never invented state)
 *        cycle COLLECTED → `reconciliation.cycle.matching.run` { cycleId }
 *        cycle MATCHED → `reconciliation.cycle.close` { cycleId }
 *        cycle CLOSED  → no work
 *
 *   3. THE UNKNOWN TRIGGER — for every OPEN case (the INV-14-1 auto-case
 *      of an UNKNOWN rail operation — the protocol's OWN reconciliation
 *      engagement — plus any CYCLE_DISCREPANCY case): submit
 *      `reconciliation.case.investigate` { caseId } (OPEN → INVESTIGATING).
 *      This is the work order's UNKNOWN discipline: UNKNOWN external
 *      outcomes trigger RECONCILIATION, never a blind retry. The job
 *      NEVER resolves a case (the terminal resolution states the true
 *      outcome and requires external proof — an authority/operator
 *      judgment the jobs layer does not make), and NEVER re-submits the
 *      UNKNOWN-held settlement attempt (the settlement-support job's
 *      UNKNOWN-held audit + the authorities' LIVE_ATTEMPT_EXISTS /
 *      UNKNOWN_HELD refusals are the structural never-retry controls).
 *
 * HONEST EXECUTION NOTE (the filed composition defect D-2, INTEGRATION-
 * EVIDENCE.md): of the A14 kinds above, `reconciliation.source.register`
 * and `reconciliation.cycle.close` are hosted with identical names on the
 * transition path and EXECUTE end-to-end; `reconciliation.cycle.open`,
 * `reconciliation.cycle.statements.collect`,
 * `reconciliation.cycle.matching.run` and `reconciliation.case.investigate`
 * are gateway-ADMITTED (recorded receipts, dedupe-protected) but their
 * hosted bindings carry different kind names (reconciliation.cycle.tick /
 * .collect / .match; the case lifecycle is not hosted) — those
 * submissions sit queued on the durable path until the recorded
 * vocabulary-alignment follow-up lands. The jobs' submission discipline
 * is the documented one (COMMAND-SURFACE.md is the contract the work
 * order binds the jobs to); the execution gap is a recorded property of
 * the composed runtime, not of the jobs. See OPERATIONS-EVIDENCE.md.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md (UNKNOWN →
 * reconciliation, never blind retry); rails-adapters-reconciliation.md
 * Area 14 (sources, cycles, cases; INV-14-1/14-4); COMMAND-SURFACE §A14;
 * INTEGRATION-EVIDENCE.md (the composed UNKNOWN-confirmed journey — the
 * oracle; the D-2 vocabulary gap).
 */

import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { operationalJobHandler } from './jobs.ts';
import type { OperationalJobContext, OperationalJobDeps, DurableJobHandler } from './jobs.ts';

/** The reconciliation-sweep job kind (the DEP-003 durable job identity). */
export const RECONCILIATION_SWEEP_JOB_KIND = 'operations.reconciliation-sweep';

/** The default matching rule version (A14 implements exactly 1 — INV-14-4). */
export const DEFAULT_RECONCILIATION_RULE_VERSION = 1;

/**
 * The deterministic A14 cycle id for a sweep window — the same derivation
 * the authority itself uses (openCycle: deriveProtocolId(
 * 'reconciliation-cycle', windowStartWallMs, windowEndWallMs,
 * ruleVersion)), so the job addresses exactly the cycle the authority
 * would open for this window.
 */
export function reconciliationCycleIdForWindow(
  windowStartWallMs: number,
  windowEndWallMs: number,
  ruleVersion: number,
): string {
  return deriveProtocolId('reconciliation-cycle', windowStartWallMs, windowEndWallMs, ruleVersion);
}

/**
 * The derivation: the three sweep phases (sources → the window cycle →
 * the OPEN-case investigation triggers), each derived ONLY from the A14
 * authority's public reads. One command per subject per run; every
 * submission carries the (job, cycle, subject) deterministic key.
 */
async function deriveReconciliationSweep(context: OperationalJobContext): Promise<void> {
  const { deps, payload, submit, noteDerived } = context;
  const ruleVersion = deps.config.reconciliationRuleVersion ?? DEFAULT_RECONCILIATION_RULE_VERSION;
  const sources = deps.config.reconciliationSources ?? [];

  // --- Phase 1: statement-source registration (the executable A14 surface) ---
  const registeredSourceIds: string[] = [];
  for (const source of sources) {
    const sourceId = deriveProtocolId('reconciliation-source', source.kind, source.description);
    registeredSourceIds.push(sourceId);
    if (deps.reads.reconciliation.getSource(sourceId) === undefined) {
      noteDerived(`source ${source.kind}/${source.description}: absent → register`);
      await submit({
        kind: 'reconciliation.source.register',
        authority: 'Reconciliation Authority',
        subjectIds: [],
        subject: sourceId,
        body: { kind: source.kind, description: source.description },
      });
    }
  }

  // --- Phase 2: the window cycle path ---
  const cycleId = reconciliationCycleIdForWindow(
    payload.windowStartWallMs,
    payload.windowEndWallMs,
    ruleVersion,
  );
  const cycle = deps.reads.reconciliation.getCycle(cycleId);
  if (cycle === undefined) {
    if (registeredSourceIds.length > 0) {
      noteDerived(`cycle ${cycleId}: absent → open (${registeredSourceIds.length} source(s))`);
      await submit({
        kind: 'reconciliation.cycle.open',
        authority: 'Reconciliation Authority',
        subjectIds: [],
        subject: cycleId,
        body: {
          windowStartWallMs: payload.windowStartWallMs,
          windowEndWallMs: payload.windowEndWallMs,
          sourceIds: registeredSourceIds,
          ruleVersion,
        },
      });
    }
  } else {
    switch (cycle.status) {
      case 'OPEN': {
        // The external statement feed is the job's INPUT port (a
        // configured provider — never invented state). Without a provider
        // the sweep waits for statements (no collect submission: an empty
        // collection would fabricate a matching run over "no statements
        // arrived", which is a statement ABOUT the external world the job
        // is not entitled to make).
        const provider = deps.config.statementProvider;
        if (provider !== undefined) {
          const statements = provider({
            windowStartWallMs: payload.windowStartWallMs,
            windowEndWallMs: payload.windowEndWallMs,
          });
          noteDerived(`cycle ${cycleId}: OPEN → collect (${statements.length} statement(s))`);
          await submit({
            kind: 'reconciliation.cycle.statements.collect',
            authority: 'Reconciliation Authority',
            subjectIds: [cycleId],
            subject: cycleId,
            body: { cycleId, statements: [...statements] },
          });
        }
        break;
      }
      case 'COLLECTED':
        noteDerived(`cycle ${cycleId}: COLLECTED → matching.run`);
        await submit({
          kind: 'reconciliation.cycle.matching.run',
          authority: 'Reconciliation Authority',
          subjectIds: [cycleId],
          subject: cycleId,
          body: { cycleId },
        });
        break;
      case 'MATCHED':
        noteDerived(`cycle ${cycleId}: MATCHED → close`);
        await submit({
          kind: 'reconciliation.cycle.close',
          authority: 'Reconciliation Authority',
          subjectIds: [cycleId],
          subject: cycleId,
          body: { cycleId },
        });
        break;
      default:
        // CLOSED (terminal): no work.
        break;
    }
  }

  // --- Phase 3: the UNKNOWN trigger — OPEN cases → investigate (never a retry) ---
  for (const caseRecord of deps.reads.reconciliation.listCases()) {
    if (caseRecord.status === 'OPEN') {
      noteDerived(`case ${caseRecord.caseId}: OPEN → investigate (the A14 path — never a blind retry)`);
      await submit({
        kind: 'reconciliation.case.investigate',
        authority: 'Reconciliation Authority',
        subjectIds: [caseRecord.caseId],
        subject: caseRecord.caseId,
        body: { caseId: caseRecord.caseId },
      });
    }
  }
}

/** Build the reconciliation-sweep durable job handler. */
export function reconciliationSweepJob(deps: OperationalJobDeps): DurableJobHandler {
  return operationalJobHandler(RECONCILIATION_SWEEP_JOB_KIND, deps, deriveReconciliationSweep);
}
