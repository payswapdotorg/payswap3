/**
 * DEP-004 — Operational jobs: the clearing batch progression duty (A09).
 *
 * Owned surface: src/lib/operations/clearing-progression.ts (work order
 * DEP-004 — the recurring operational duty the deployment topology names
 * for workers: "clearing batch progression").
 *
 * THE DUTY: advance the clearing pipeline's window batches through the
 * Clearing Authority's own state machine — OPEN → STAGED → COMMITTED →
 * FINAL — by submitting exactly ONE progression command per batch per
 * run, derived ONLY from the authority's public read surface:
 *
 *   batch absent  → `clearing.batch.open`  { batchLabel }   (the window batch genesis)
 *   batch OPEN    → `clearing.batch.stage` { batchId }     (the quarantine gate + summation)
 *   batch STAGED  → `clearing.batch.commit`{ batchId }     (the obligations flow to the A10 sink)
 *   batch COMMITTED → `clearing.batch.finalize` { batchId }(the terminal)
 *   batch FINAL   → no work
 *
 * THE LABEL DOMAIN AND THE LOOKBACK SWEEP: the batch-label domain is
 * deterministic per cycle (`<prefix><cycle>` — the scheduler-wiring
 * precedent's window-label discipline), and the A09 authority exposes no
 * batch enumeration (batches are label-addressed), so one run derives
 * work for (a) the CURRENT cycle's batch — the window batch genesis when
 * absent, its next step when present — and (b) every EXISTING batch in
 * the lookback window (the prior `clearingLookback` cycles' labels —
 * stragglers whose progression was interrupted by a crash or a paused
 * cadence; the sweep finishes them). This is the restart-safe
 * re-derivation: a re-run after a crash re-derives the same pending steps
 * and re-submits the SAME idempotency keys (the gateway returns the
 * recorded receipt; never a second effect); once a step has executed the
 * next run derives the NEXT step (a fresh key for fresh work).
 *
 * The job NEVER stages records (records arrive through the clearing
 * intake — `clearing.record.add` is the upstream surface), NEVER touches
 * the obligation ledger (the commit's sink is the authority's own), and
 * never mutates anything: progression commands only, through the one
 * admission point.
 *
 * Command kinds emitted (COMMAND-SURFACE.md, all A09): clearing.batch.open
 * / clearing.batch.stage / clearing.batch.commit /
 * clearing.batch.finalize — all four hosted with identical names on the
 * transition path, so every submission executes end-to-end in the
 * composed runtime.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md; clearing-
 * netting-settlement.md Area 9 (the batch state machine); COMMAND-SURFACE
 * §A09; hosting/scheduler-wiring.ts (the window-label discipline).
 */

import { clearingBatchId } from '../protocol-runtime/clearing/summation.ts';
import { operationalJobHandler } from './jobs.ts';
import type { OperationalJobContext, OperationalJobDeps, DurableJobHandler, JobCommandSpec } from './jobs.ts';

/** The clearing-progression job kind (the DEP-003 durable job identity). */
export const CLEARING_PROGRESSION_JOB_KIND = 'operations.clearing-progression';

/** The default window batch-label prefix (labels are `prefix + cycle`). */
export const DEFAULT_CLEARING_BATCH_LABEL_PREFIX = 'ops-clearing-';

/** The default lookback (how many prior cycles' batches the sweep covers). */
export const DEFAULT_CLEARING_LOOKBACK = 3;

/** One batch's next progression command, derived from its read state. */
function progressionStepFor(
  batchLabel: string,
  batchId: string,
  state: string,
): { readonly note: string; readonly spec: JobCommandSpec } | undefined {
  switch (state) {
    case 'OPEN':
      return {
        note: `batch ${batchLabel}: OPEN → stage`,
        spec: {
          kind: 'clearing.batch.stage',
          authority: 'Clearing Authority',
          subjectIds: [batchId],
          subject: batchId,
          body: { batchId },
        },
      };
    case 'STAGED':
      return {
        note: `batch ${batchLabel}: STAGED → commit`,
        spec: {
          kind: 'clearing.batch.commit',
          authority: 'Clearing Authority',
          subjectIds: [batchId],
          subject: batchId,
          body: { batchId },
        },
      };
    case 'COMMITTED':
      return {
        note: `batch ${batchLabel}: COMMITTED → finalize`,
        spec: {
          kind: 'clearing.batch.finalize',
          authority: 'Clearing Authority',
          subjectIds: [batchId],
          subject: batchId,
          body: { batchId },
        },
      };
    default:
      // FINAL (terminal): no work — the audit's no-work row records the visit.
      return undefined;
  }
}

/**
 * The derivation: the current cycle's window batch (genesis or next step)
 * plus the lookback sweep over the prior cycles' EXISTING batches. One
 * command per batch per run; every submission carries the (job, cycle,
 * subject) deterministic key.
 */
async function deriveClearingProgression(context: OperationalJobContext): Promise<void> {
  const { deps, payload, submit, noteDerived } = context;
  const prefix = deps.config.clearingBatchLabelPrefix ?? DEFAULT_CLEARING_BATCH_LABEL_PREFIX;
  const lookback = deps.config.clearingLookback ?? DEFAULT_CLEARING_LOOKBACK;

  // (a) the current cycle's window batch.
  const batchLabel = `${prefix}${payload.cycle}`;
  const batchId = clearingBatchId(batchLabel);
  const batch = deps.reads.clearing.batch(batchId);
  if (batch === undefined) {
    noteDerived(`batch ${batchLabel}: absent → open`);
    await submit({
      kind: 'clearing.batch.open',
      authority: 'Clearing Authority',
      subjectIds: [],
      subject: batchLabel,
      body: { batchLabel },
    });
  } else {
    const step = progressionStepFor(batchLabel, batchId, batch.state);
    if (step !== undefined) {
      noteDerived(step.note);
      await submit(step.spec);
    }
  }

  // (b) the lookback sweep: prior cycles' EXISTING batches (stragglers).
  const firstPriorCycle = Math.max(0, payload.cycle - Math.max(0, lookback));
  for (let cycle = firstPriorCycle; cycle < payload.cycle; cycle += 1) {
    const priorLabel = `${prefix}${cycle}`;
    const priorBatchId = clearingBatchId(priorLabel);
    const priorBatch = deps.reads.clearing.batch(priorBatchId);
    if (priorBatch === undefined) {
      continue; // no straggler under this label — nothing to finish
    }
    const step = progressionStepFor(priorLabel, priorBatchId, priorBatch.state);
    if (step !== undefined) {
      noteDerived(step.note);
      await submit(step.spec);
    }
  }
}

/** Build the clearing-progression durable job handler. */
export function clearingProgressionJob(deps: OperationalJobDeps): DurableJobHandler {
  return operationalJobHandler(CLEARING_PROGRESSION_JOB_KIND, deps, deriveClearingProgression);
}
