/**
 * DEP-004 — Operational jobs: the netting-settlement progression duty
 * (A11 + A12) — netting-set progression AND settlement support.
 *
 * Owned surface: src/lib/operations/netting-settlement-progression.ts
 * (work order DEP-004 — the recurring operational duty the deployment
 * topology names for workers: "netting-settlement progression"; the
 * topology's netting-settlement-workers component hosts the A11/A12
 * semantics together).
 *
 * THE DUTY, in two phases per run — every command derived ONLY from the
 * authorities' public reads, submitted ONLY through the gateway:
 *
 *  PHASE A — NETTING-SET PROGRESSION (A11, conservation-proofed):
 *
 *    A1. The cycle's cohort: the obligations in CREATED that no open
 *        netting set claims (the INV-11-2 membership probe). If the cohort
 *        is non-empty and the cycle's set (label `<prefix><cycle>`) does
 *        not exist: `netting.set.open` { label, scope, inputObligationIds }
 *        — the scope minted from the cohort's own participants (exactly 2
 *        → BILATERAL; ≥3 → MULTILATERAL), never invented.
 *    A2. The full sweep of existing sets (restart-safe re-derivation of
 *        stragglers from ANY prior cycle — listNettingSets enumerates):
 *          set OPEN     → `netting.set.compute`  { nettingSetId } (INV-11-1 proof)
 *          set COMPUTED → `netting.set.commit`   { nettingSetId } (the net positions
 *                          replace the gross set, exactly once)
 *
 *  PHASE B — SETTLEMENT SUPPORT (A12, PROGRESSION ONLY — finality is
 *  A12's alone; the job NEVER asserts finality):
 *
 *    B1. Settleable subjects without a live instruction →
 *        `settlement.instruction.create` { subject, beneficiary }:
 *        obligations in CREATED (gross, un-netted) and net obligations in
 *        CREATED (the netting product). NETTED gross obligations are the
 *        net positions' inputs — the job does not settle them directly.
 *    B2. Instructions in CREATED without a live attempt →
 *        `settlement.attempt.authorize` { instructionId, adapterId }.
 *    B3. Attempts in CREATED → `settlement.attempt.submit`
 *        { instructionId } (the transmission step; the live rail
 *        connection is bound by the transition runtime).
 *    B4. Attempts in UNKNOWN → the NEVER-RETRY discipline: the job
 *        records an UNKNOWN-held audit observation (with the INV-14-1
 *        auto-case id) and submits NOTHING for that subject — the
 *        reconciliation-sweep job owns the A14 path trigger, and the
 *        authorities' own controls (LIVE_ATTEMPT_EXISTS,
 *        UNKNOWN_HELD) structurally refuse any blind retry.
 *
 *  The job NEVER submits `settlement.finality.declare` — finality is the
 *  Settlement Authority's own command (admitted like any other when the
 *  authority's state machine calls for it), never the job's judgment; the
 *  job's duty is progression + evidence (the work order's binding
 *  interpretation). The job also never submits
 *  `settlement.resolution.apply` (the A14 recovery consumer) or
 *  `settlement.attempt.railoutcome.apply` (the report mirror) — those are
 *  the authority-side consumers of external evidence, not progression.
 *
 * Command kinds emitted (COMMAND-SURFACE.md): netting.set.open /
 * netting.set.compute / netting.set.commit (A11) and
 * settlement.instruction.create / settlement.attempt.authorize /
 * settlement.attempt.submit (A12) — all six hosted with identical names
 * on the transition path, so every submission executes end-to-end in the
 * composed runtime.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md ("Finality
 * is A12's alone... the job's duty is progression + evidence, never
 * judgment"; "settlement-support work never asserts finality itself");
 * clearing-netting-settlement.md Areas 11-12 (the state machines);
 * COMMAND-SURFACE §A11/§A12; INTEGRATION-EVIDENCE.md (the composed
 * UNKNOWN-confirmed journey — the oracle).
 */

import { nettingSetIdForLabel } from '../protocol-runtime/netting/state-machine.ts';
import { operationalJobHandler } from './jobs.ts';
import type {
  OperationalJobContext,
  OperationalJobDeps,
  OperationalSettlementSubject,
  DurableJobHandler,
} from './jobs.ts';

/** The netting-settlement-progression job kind (the DEP-003 durable job identity). */
export const NETTING_SETTLEMENT_PROGRESSION_JOB_KIND = 'operations.netting-settlement-progression';

/** The default cohort set-label prefix (labels are `prefix + cycle`). */
export const DEFAULT_NETTING_LABEL_PREFIX = 'ops-net-';

/** The live-instruction states (A12: an instruction in these states is live). */
const LIVE_INSTRUCTION_STATES = new Set(['CREATED', 'ISSUED']);
/** The live-attempt states (A12: an attempt in these states blocks a new one). */
const LIVE_ATTEMPT_STATES = new Set(['CREATED', 'SUBMITTED', 'PENDING', 'UNKNOWN']);

function subjectKey(subject: OperationalSettlementSubject): string {
  return subject.kind === 'OBLIGATION'
    ? (subject.obligationId ?? '')
    : (subject.netObligationId ?? '');
}

/**
 * Phase A1+A2: the netting-set progression. The cohort derivation is a
 * pure function of the obligation projection + the INV-11-2 membership
 * claims; the scope is minted from the cohort's own participants.
 *
 * Returns the cohort's obligation ids (the SAME-RUN EXCLUSION set for the
 * settlement phase: an obligation this run is submitting into a netting
 * set must not ALSO receive a settlement instruction this run — the two
 * submissions would race on the durable path (the instruction would drive
 * the obligation out of CREATED before the set-open executes, refusing
 * the netting with OBLIGATION_NOT_CREATED). The exclusion is the
 * structural double-settle guard: gross obligations net FIRST; the net
 * positions are what settle.
 */
async function deriveNettingProgression(
  context: OperationalJobContext,
): Promise<ReadonlySet<string>> {
  const { deps, payload, submit, noteDerived } = context;
  const prefix = deps.config.nettingLabelPrefix ?? DEFAULT_NETTING_LABEL_PREFIX;

  // A1: the cycle's cohort (CREATED obligations claimed by no open set).
  const obligations = deps.reads.obligations.obligations();
  const cohort = obligations.filter(
    (obligation) =>
      obligation.state === 'CREATED' &&
      deps.reads.netting.obligationClaim(obligation.obligationId) === undefined,
  );
  const cohortIds = new Set(cohort.map((obligation) => obligation.obligationId));
  const label = `${prefix}${payload.cycle}`;
  const setId = nettingSetIdForLabel(label);
  if (cohort.length > 0 && deps.reads.netting.nettingSet(setId) === undefined) {
    const participants = [...new Set(cohort.flatMap((obligation) => [
      obligation.terms.debtorParticipantId,
      obligation.terms.creditorParticipantId,
    ]))].sort();
    const scope =
      participants.length === 2
        ? { kind: 'BILATERAL', participants }
        : { kind: 'MULTILATERAL', participants };
    noteDerived(
      `netting set ${label}: ${cohort.length} unclaimed obligation(s), ${participants.length} participant(s) → open`,
    );
    await submit({
      kind: 'netting.set.open',
      authority: 'Netting Authority',
      subjectIds: [],
      subject: label,
      body: {
        label,
        scope,
        inputObligationIds: cohort.map((obligation) => obligation.obligationId),
      },
    });
  }

  // A2: the full sweep — every existing set's next step (stragglers from
  // any prior cycle included: the restart-safe re-derivation).
  for (const set of deps.reads.netting.listNettingSets()) {
    if (set.state === 'OPEN') {
      noteDerived(`netting set ${set.nettingSetId}: OPEN → compute`);
      await submit({
        kind: 'netting.set.compute',
        authority: 'Netting Authority',
        subjectIds: [set.nettingSetId],
        subject: set.nettingSetId,
        body: { nettingSetId: set.nettingSetId },
      });
    } else if (set.state === 'COMPUTED') {
      noteDerived(`netting set ${set.nettingSetId}: COMPUTED → commit`);
      await submit({
        kind: 'netting.set.commit',
        authority: 'Netting Authority',
        subjectIds: [set.nettingSetId],
        subject: set.nettingSetId,
        body: { nettingSetId: set.nettingSetId },
      });
    }
  }
  return cohortIds;
}

/**
 * Phase B: the settlement support — progression only, finality never.
 * B1 (instruction creation for settleable subjects without a live
 * instruction — EXCLUDING this run's netting cohort, the double-settle
 * guard), B2 (attempt authorization), B3 (attempt submission), B4 (the
 * UNKNOWN-held audit — the never-retry discipline).
 */
async function deriveSettlementSupport(
  context: OperationalJobContext,
  nettingCohort: ReadonlySet<string>,
): Promise<void> {
  const { deps, submit, noteDerived, noteUnknownHeld } = context;
  const adapterId = deps.config.settlementAdapterId ?? '';
  const beneficiaryFor = deps.config.beneficiaryFor;

  // B1: settleable subjects without a live instruction. Gross obligations
  // are subjects ONLY when they are not netting-pending: not claimed by
  // any open set (the INV-11-2 probe) and not in THIS run's cohort (the
  // same-run exclusion — the structural double-settle guard above). The
  // netting product (net obligations in CREATED) is the primary subject.
  const settleableSubjects: ReadonlyArray<OperationalSettlementSubject> = [
    ...deps.reads.obligations
      .obligations()
      .filter(
        (obligation) =>
          obligation.state === 'CREATED' &&
          !nettingCohort.has(obligation.obligationId) &&
          deps.reads.netting.obligationClaim(obligation.obligationId) === undefined,
      )
      .map((obligation) => ({ kind: 'OBLIGATION' as const, obligationId: obligation.obligationId })),
    ...deps.reads.netting
      .listNetObligations()
      .filter((netObligation) => netObligation.state === 'CREATED')
      .map((netObligation) => ({ kind: 'NET_POSITION' as const, netObligationId: netObligation.netObligationId })),
  ];
  for (const subject of settleableSubjects) {
    const key = subjectKey(subject);
    const live = deps.reads.settlement
      .instructionsForSubject(subject)
      .some((instruction) => LIVE_INSTRUCTION_STATES.has(instruction.state));
    if (!live && beneficiaryFor !== undefined) {
      noteDerived(`settlement subject ${key}: settleable, no live instruction → create`);
      await submit({
        kind: 'settlement.instruction.create',
        authority: 'Settlement and Finality Authority',
        subjectIds: [key],
        subject: key,
        body: {
          subject:
            subject.kind === 'OBLIGATION'
              ? { kind: 'OBLIGATION', obligationId: subject.obligationId }
              : { kind: 'NET_POSITION', netObligationId: subject.netObligationId },
          beneficiary: beneficiaryFor(subject),
        },
      });
    }
  }

  // B2: instructions in CREATED without a live attempt → authorize.
  for (const instruction of deps.reads.settlement.listInstructions()) {
    if (instruction.state !== 'CREATED') {
      continue;
    }
    const attempt = deps.reads.settlement.attemptForInstruction(instruction.instructionId);
    const liveAttempt = attempt !== undefined && LIVE_ATTEMPT_STATES.has(attempt.state);
    if (!liveAttempt && adapterId !== '') {
      noteDerived(`instruction ${instruction.instructionId}: CREATED, no live attempt → authorize`);
      await submit({
        kind: 'settlement.attempt.authorize',
        authority: 'Settlement and Finality Authority',
        subjectIds: [instruction.instructionId],
        subject: instruction.instructionId,
        body: { instructionId: instruction.instructionId, adapterId },
      });
    }
  }

  // B3+B4: attempts — CREATED → submit; UNKNOWN → the never-retry audit.
  for (const attempt of deps.reads.settlement.listAttempts()) {
    if (attempt.state === 'CREATED') {
      noteDerived(`attempt ${attempt.attemptId}: CREATED → submit`);
      await submit({
        kind: 'settlement.attempt.submit',
        authority: 'Settlement and Finality Authority',
        subjectIds: [attempt.instructionId],
        subject: attempt.instructionId,
        body: { instructionId: attempt.instructionId },
      });
    } else if (attempt.state === 'UNKNOWN') {
      // The UNKNOWN discipline: NO submission for this subject — never a
      // blind retry. The reconciliation-sweep job owns the A14 path; the
      // authorities' LIVE_ATTEMPT_EXISTS / UNKNOWN_HELD refusals are the
      // structural controls. The audit row is the operational evidence.
      noteUnknownHeld({
        subject: attempt.instructionId,
        ...(attempt.reconciliationCaseId === undefined
          ? {}
          : { caseId: attempt.reconciliationCaseId }),
      });
    }
  }
}

/** The full derivation: Phase A (netting) then Phase B (settlement support). */
async function deriveNettingSettlementProgression(context: OperationalJobContext): Promise<void> {
  const nettingCohort = await deriveNettingProgression(context);
  await deriveSettlementSupport(context, nettingCohort);
}

/** Build the netting-settlement-progression durable job handler. */
export function nettingSettlementProgressionJob(deps: OperationalJobDeps): DurableJobHandler {
  return operationalJobHandler(NETTING_SETTLEMENT_PROGRESSION_JOB_KIND, deps, deriveNettingSettlementProgression);
}
