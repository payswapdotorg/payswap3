/**
 * RTN-009 — Netting Authority: the composed single-writer command surface
 * for area 11 (A11).
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §3 Area 11:
 *   lines 147-153 (Purpose — "Reduce sets of obligations to net positions
 *    without changing total value ... Netting is a deterministic
 *    computation over the obligation ledger.").
 *   lines 155-170 (NettingSet / NetPosition / NettingScope — the exact
 *    objects and states; quoted in types.ts).
 *   lines 172-175 (Owning authority):
 *     "Netting Authority (protocol layer, area 11) owns netting
 *      computation and set state; obligation transitions remain owned by
 *      area 10, executed only on Netting Authority instruction."
 *   lines 177-189 (the three invariants, verbatim):
 *     "INV-11-1 (financial correctness, conservation): for every
 *      currency in the set, the integer sum of net positions equals the
 *      integer sum of gross obligations; the check is recorded in the
 *      set's proof before commit.
 *      INV-11-2 (concurrency): an obligation can belong to at most one
 *      open netting set; set membership is claimed atomically at OPEN.
 *      INV-11-3 (idempotency): computing a set is a pure function of its
 *      fixed input ids and the netting algorithm version; re-commit of a
 *      committed set id is a no-op."
 *   lines 191-197 (failure and UNKNOWN semantics):
 *     "Netting is internal and deterministic; failures are validation
 *      failures that abort the set before commit with no ledger effect.
 *      No UNKNOWN state. If a netted obligation's settlement later returns
 *      UNKNOWN, resolution follows area 12/14 rules; netting history is
 *      never recomputed after commit."
 *   lines 199-203 (evidence produced); lines 205-209 (boundaries —
 *    "Netting never settles; it only transforms obligations." / "Netting
 *    never includes obligations in DISPUTED state." / "Depends on areas
 *    10, 12, 15").
 *   §2 Area 10 lines 95-97 ("CREATED -> NETTED: replaced by net positions
 *    in a committed netting set (area 11)" — the A10 transition this
 *    authority instructs).
 *   §4 Area 12 lines 97-99, 224-225, 236-240 (the settlement-facing
 *    lifecycle of the net obligations — "a settlement instruction (area
 *    12) exists"; "for one obligation or net position"; "FINAL advances
 *    the obligation to SETTLED exactly once").
 *   spec/architecture/v0.1/README.md §3 GC-1/GC-4/GC-5.
 *
 * Command discipline (recorded in CONTRACT-REVIEW.md):
 *   - Every command runs under ONE serializer lane (the netting domain's
 *     single-writer discipline — the KeyedSerializer precedent).
 *   - Evidence FIRST (awaited), then the state write it records (A15
 *     lines 62-64: "an operation is not committed until its record is
 *     written. A failed write fails the operation") — with no sequence
 *     gap on failure.
 *   - Domain rejections are typed values (NettingCommandResult), never
 *     thrown; input-shape violations throw TypeError (kernel
 *     convention). Re-commit of a committed set id is the INV-11-3 no-op
 *     (no second evidence record).
 *   - The A10 NETTED transitions are driven ONLY on Netting Authority
 *     instruction, through the injected obligations port ("obligation
 *     transitions remain owned by area 10, executed only on Netting
 *     Authority instruction") — the port is structurally satisfied by the
 *     merged ObligationLedgerAuthority (RTN-008).
 *   - Commit ordering (the cross-domain atomicity interpretation):
 *     validate ALL (states, claims, recorded conservation proof) → drive
 *     the A10 NETTED transitions for every input obligation (each
 *     individually atomic and evidenced inside the A10 authority) →
 *     materialize the net obligations → write NETTING_COMMITTED → flip
 *     the set to COMMITTED and release the membership claims. The
 *     pre-validation closes every deterministic failure mode; the
 *     residual tear window (a concurrent cross-domain writer racing the
 *     pre-validated apply loop) is a composition-root discipline point,
 *     recorded in CONTRACT-REVIEW.md and the work-order report.
 */

import type { EvidenceSubmission } from '../kernel/ports.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { KeyedSerializer } from '../obligations/serializer.ts';
import type {
  NettingCommitInstruction,
  ObligationCommandResult,
  ObligationRecord,
} from '../obligations/obligations.ts';
import {
  NETTING_ALGORITHM_VERSION,
  buildConservationProof,
  computeNetPositions,
  materializeNetObligations,
  verifyConservationProof,
} from './algorithm.ts';
import {
  nettingCommittedEvidence,
  nettingComputedEvidence,
  nettingSetOpenedEvidence,
  submitNettingEvidence,
} from './evidence.ts';
import { netObligationIdFor, nettingSetIdForLabel, mintNettingScope } from './state-machine.ts';
import { NettingStore } from './store.ts';
import { deepFreeze } from './freeze.ts';
import type {
  NetObligationRecord,
  NetPosition,
  NettingCommandResult,
  NettingScope,
  NettingSetRecord,
} from './types.ts';
import { canTransitionNetObligation } from './types.ts';

/**
 * The obligations-ledger port the Netting Authority composes with: the
 * read projection ("every downstream netting or settlement fact is a
 * projection of it" — A10 lines 80-87) and the NETTED transition executed
 * only on Netting Authority instruction (A11 lines 172-175).
 * Structurally satisfied by the merged ObligationLedgerAuthority.
 *
 * Source: clearing-netting-settlement.md §2 Area 10 lines 80-87, §3 Area 11
 * lines 172-175.
 */
export interface NettingObligationLedgerPort {
  /** The obligation record by id (the ledger projection read). */
  obligation(obligationId: string): ObligationRecord | undefined;
  /** The CREATED -> NETTED transition (A10-owned, Netting-Authority-instructed). */
  applyNettingCommit(
    instruction: NettingCommitInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>>;
}

/** Constructor dependencies for the Netting Authority. */
export interface NettingAuthorityDeps {
  /** The EvidenceSubmission port — the real RTN-002 EvidenceLog. */
  readonly evidence: EvidenceSubmission;
  /** The obligations-ledger port (the merged ObligationLedgerAuthority). */
  readonly obligations: NettingObligationLedgerPort;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * The outcome of one netting commit: the committed set, the net
 * obligations created ("net obligation ids created" — the
 * NETTING_COMMITTED evidence payload), and the obligations moved to
 * NETTED.
 *
 * Source: clearing-netting-settlement.md lines 161-163, 202-203.
 */
export interface NettingCommitOutcome {
  readonly set: NettingSetRecord;
  readonly netObligations: readonly NetObligationRecord[];
  readonly nettedObligationIds: readonly string[];
  /** True when this call was the INV-11-3 re-commit no-op. */
  readonly noop: boolean;
}

const NETTING_PIPELINE_KEY = 'netting-authority.pipeline';

/**
 * The Netting Authority (protocol layer, area 11): owns netting
 * computation and set state. Obligation transitions remain owned by area
 * 10, executed only on this authority's instruction.
 *
 * Source: clearing-netting-settlement.md lines 172-175.
 */
export class NettingAuthority {
  private readonly evidence: EvidenceSubmission;
  private readonly obligations: NettingObligationLedgerPort;
  private readonly wallClock: () => number;
  private readonly pipeline = new KeyedSerializer();
  private readonly store = new NettingStore();

  constructor(deps: NettingAuthorityDeps) {
    this.evidence = deps.evidence;
    this.obligations = deps.obligations;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  /** The domain's state store (read access for the persistence bridge and diagnostics). */
  get stateStore(): NettingStore {
    return this.store;
  }

  private now(): ProtocolTime {
    return protocolTime(this.store.nextProtocolSequence(), this.wallClock());
  }

  private consume(): ProtocolTime {
    const at = this.now();
    this.store.consumeSequence();
    return at;
  }

  // -------------------------------------------------------------------------
  // The NettingSet lifecycle (OPEN -> COMPUTED -> COMMITTED)
  // -------------------------------------------------------------------------

  /**
   * Open one netting set — "OPEN: input obligation ids fixed". The input
   * ids are fixed here and never change (INV-11-3's pure-function input);
   * the membership is claimed ATOMICALLY at this point (INV-11-2 —
   * all-or-nothing: any conflict rejects the whole open with NO claims
   * made). Validation gates: no duplicate input ids; every obligation
   * exists in the ledger, is in CREATED state (an obligation in DISPUTED
   * state is refused with its own typed code — "Netting never includes
   * obligations in DISPUTED state" is a hard boundary, never a silent
   * skip), and both parties are within the scope's participant set.
   *
   * Evidence: NETTING_SET_OPENED "(input obligation ids)".
   *
   * Source: clearing-netting-settlement.md lines 157-162, 182-184
   * (INV-11-2), 200, 207-208.
   */
  async openNettingSet(input: {
    readonly label: string;
    readonly scope: { readonly kind: 'BILATERAL' | 'MULTILATERAL'; readonly participants: readonly string[] };
    readonly inputObligationIds: readonly string[];
  }): Promise<NettingCommandResult<NettingSetRecord>> {
    if (typeof input.label !== 'string' || input.label.length === 0) {
      throw new TypeError('netting authority: label must be a non-empty string');
    }
    const scope = mintNettingScope(input.scope);
    if (
      !Array.isArray(input.inputObligationIds) ||
      input.inputObligationIds.length === 0
    ) {
      throw new TypeError('netting authority: inputObligationIds must be a non-empty array');
    }
    for (const id of input.inputObligationIds) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('netting authority: every input obligation id must be a non-empty string');
      }
    }
    return this.pipeline.run(NETTING_PIPELINE_KEY, async () => {
      const nettingSetId = nettingSetIdForLabel(input.label);
      if (this.store.labelUsed(input.label) || this.store.nettingSet(nettingSetId) !== undefined) {
        return {
          ok: false as const,
          code: 'NETTING_SET_EXISTS' as const,
          message: `netting authority: set label ${JSON.stringify(input.label)} already opened (set ids derive from labels — INV-11-3)`,
        };
      }
      const seen = new Set<string>();
      for (const obligationId of input.inputObligationIds) {
        if (seen.has(obligationId)) {
          return {
            ok: false as const,
            code: 'DUPLICATE_INPUT' as const,
            message: `netting authority: input obligation ${obligationId} appears more than once`,
          };
        }
        seen.add(obligationId);
      }
      const participants = new Set(scope.participants);
      for (const obligationId of input.inputObligationIds) {
        const obligation = this.obligations.obligation(obligationId);
        if (obligation === undefined) {
          return {
            ok: false as const,
            code: 'OBLIGATION_NOT_FOUND' as const,
            message: `netting authority: input obligation ${obligationId} does not exist in the ledger`,
          };
        }
        if (obligation.state === 'DISPUTED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_DISPUTED' as const,
            message: `netting authority: obligation ${obligationId} is DISPUTED — netting never includes obligations in DISPUTED state`,
          };
        }
        if (obligation.state !== 'CREATED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_NOT_CREATED' as const,
            message: `netting authority: obligation ${obligationId} is ${obligation.state}; netting inputs must be CREATED (the A10 CREATED -> NETTED transition)`,
          };
        }
        if (
          !participants.has(obligation.terms.debtorParticipantId) ||
          !participants.has(obligation.terms.creditorParticipantId)
        ) {
          return {
            ok: false as const,
            code: 'PARTICIPANTS_OUT_OF_SCOPE' as const,
            message: `netting authority: obligation ${obligationId} has a party outside the ${scope.kind} participant set`,
          };
        }
      }
      // INV-11-2: the atomic membership claim — all-or-nothing.
      const claim = this.store.claimMembership(nettingSetId, input.inputObligationIds);
      if (!claim.ok) {
        return {
          ok: false as const,
          code: 'ALREADY_CLAIMED' as const,
          message: `netting authority: obligation ${claim.conflictingObligationId} is already claimed by open netting set ${claim.claimedBy} (INV-11-2: at most one open set per obligation)`,
        };
      }
      const record: NettingSetRecord = deepFreeze({
        nettingSetId,
        state: 'OPEN',
        scope,
        algorithmVersion: NETTING_ALGORITHM_VERSION,
        inputObligationIds: Object.freeze([...input.inputObligationIds]),
        openedAt: this.now(),
      });
      await submitNettingEvidence(this.evidence, nettingSetOpenedEvidence(record));
      this.store.consumeSequence();
      this.store.reserveLabel(input.label);
      this.store.insertNettingSet(record);
      return { ok: true as const, value: record };
    });
  }

  /**
   * Compute one netting set — OPEN -> COMPUTED: "net positions computed
   * and checkable". The computation is the PURE function of INV-11-3: the
   * fixed input ids (snapshotted through the immutable obligation terms —
   * INV-10-1) and the netting algorithm version. The conservation check
   * (INV-11-1) is computed and RECORDED in the set's proof here — BEFORE
   * commit — and every per-position breakdown hash is recorded with the
   * position.
   *
   * Re-validation at compute time: every input obligation must STILL be
   * CREATED (an obligation that became DISPUTED between OPEN and COMPUTE
   * aborts the computation with the typed OBLIGATION_DISPUTED rejection —
   * the set stays OPEN with no effect, "failures are validation failures
   * that abort the set before commit with no ledger effect").
   *
   * Evidence: NETTING_COMPUTED "(algorithm version, per-currency
   * conservation proof)".
   *
   * Source: clearing-netting-settlement.md lines 160-163, 180-189, 191-193,
   * 201-202.
   */
  async computeNettingSet(nettingSetId: string): Promise<NettingCommandResult<NettingSetRecord>> {
    if (typeof nettingSetId !== 'string' || nettingSetId.length === 0) {
      throw new TypeError('netting authority: nettingSetId must be a non-empty string');
    }
    return this.pipeline.run(NETTING_PIPELINE_KEY, async () => {
      const set = this.store.nettingSet(nettingSetId);
      if (set === undefined) {
        return {
          ok: false as const,
          code: 'NETTING_SET_NOT_FOUND' as const,
          message: `netting authority: netting set ${nettingSetId} does not exist`,
        };
      }
      if (set.state !== 'OPEN') {
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `netting authority: netting set ${nettingSetId} is ${set.state}; compute requires OPEN (OPEN -> COMPUTED -> COMMITTED)`,
        };
      }
      const gross = [];
      for (const obligationId of set.inputObligationIds) {
        const obligation = this.obligations.obligation(obligationId);
        if (obligation === undefined) {
          return {
            ok: false as const,
            code: 'OBLIGATION_NOT_FOUND' as const,
            message: `netting authority: input obligation ${obligationId} no longer exists in the ledger`,
          };
        }
        if (obligation.state === 'DISPUTED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_DISPUTED' as const,
            message: `netting authority: obligation ${obligationId} became DISPUTED after OPEN — netting never includes obligations in DISPUTED state`,
          };
        }
        if (obligation.state !== 'CREATED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_CHANGED' as const,
            message: `netting authority: obligation ${obligationId} is ${obligation.state} (was CREATED at OPEN); compute refuses a changed input`,
          };
        }
        gross.push({
          obligationId,
          debtorParticipantId: obligation.terms.debtorParticipantId,
          creditorParticipantId: obligation.terms.creditorParticipantId,
          amount: obligation.terms.amount,
        });
      }
      const netPositions = computeNetPositions(nettingSetId, set.scope, gross);
      const proof = buildConservationProof(set.scope, gross, netPositions);
      if (!proof.perCurrency.every((entry) => entry.conserved)) {
        return {
          ok: false as const,
          code: 'CONSERVATION_FAILED' as const,
          message: `netting authority: conservation check failed for set ${nettingSetId} (INV-11-1) — the set stays OPEN with no ledger effect`,
        };
      }
      const computedAt = this.now();
      const computed: NettingSetRecord = deepFreeze({
        ...set,
        state: 'COMPUTED',
        grossObligations: Object.freeze(gross),
        netPositions,
        conservationProof: proof,
        computedAt,
      });
      await submitNettingEvidence(this.evidence, nettingComputedEvidence(computed));
      this.store.consumeSequence();
      this.store.updateNettingSet(computed);
      return { ok: true as const, value: computed };
    });
  }

  /**
   * Commit one netting set — COMPUTED -> COMMITTED: "input obligations
   * moved to NETTED and replaced by net obligations in the ledger".
   *
   * The commit sequence (the cross-domain atomicity interpretation —
   * CONTRACT-REVIEW):
   *   1. Verify the recorded conservation proof (INV-11-1: "the check is
   *      recorded in the set's proof before commit" — it must be present
   *      and still verify against the recorded snapshot and positions)
   *      and re-validate every input obligation (still CREATED, claims
   *      still held by this set).
   *   2. Drive the A10 NETTED transition for every input obligation —
   *      "obligation transitions remain owned by area 10, executed only
   *      on Netting Authority instruction" — with the materialized net
   *      obligation ids as the replacementObligationIds (the ledger's
   *      record of the replacement; possibly empty when a pairwise net
   *      nets to zero).
   *   3. Materialize the net obligations in the netting domain
   *      ("replaced by net obligations in the ledger" — recorded in the
   *      ledger's NETTED transition, owned by the Netting Authority; see
   *      types.ts's recorded interpretation).
   *   4. Write NETTING_COMMITTED, flip the set to COMMITTED, and release
   *      the membership claims (the set is no longer open; the NETTED
   *      state structurally prevents re-netting).
   *
   * Re-commit of a committed set id is the INV-11-3 NO-OP: the recorded
   * outcome is returned, no state changes, no second evidence record.
   *
   * Evidence: NETTING_COMMITTED "(net obligation ids created)".
   *
   * Source: clearing-netting-settlement.md lines 161-163, 180-189, 193
   * ("netting history is never recomputed after commit"), 202-203.
   */
  async commitNettingSet(nettingSetId: string): Promise<NettingCommandResult<NettingCommitOutcome>> {
    if (typeof nettingSetId !== 'string' || nettingSetId.length === 0) {
      throw new TypeError('netting authority: nettingSetId must be a non-empty string');
    }
    return this.pipeline.run(NETTING_PIPELINE_KEY, async () => {
      const set = this.store.nettingSet(nettingSetId);
      if (set === undefined) {
        return {
          ok: false as const,
          code: 'NETTING_SET_NOT_FOUND' as const,
          message: `netting authority: netting set ${nettingSetId} does not exist`,
        };
      }
      if (set.state === 'COMMITTED') {
        // INV-11-3: re-commit of a committed set id is a no-op returning
        // the recorded result — no state change, no evidence record.
        const netObligations = this.store.netObligationsOfSet(nettingSetId);
        return {
          ok: true as const,
          value: {
            set,
            netObligations,
            nettedObligationIds: set.inputObligationIds,
            noop: true,
          },
        };
      }
      if (set.state !== 'COMPUTED') {
        return {
          ok: false as const,
          code: 'NOT_COMPUTED' as const,
          message: `netting authority: netting set ${nettingSetId} is ${set.state}; commit requires COMPUTED (OPEN -> COMPUTED -> COMMITTED)`,
        };
      }
      if (
        set.conservationProof === undefined ||
        set.netPositions === undefined ||
        set.grossObligations === undefined
      ) {
        return {
          ok: false as const,
          code: 'CONSERVATION_FAILED' as const,
          message: `netting authority: netting set ${nettingSetId} has no recorded conservation proof (INV-11-1: the check is recorded before commit)`,
        };
      }
      if (
        !verifyConservationProof(
          set.scope,
          set.grossObligations,
          set.netPositions,
          set.conservationProof,
        )
      ) {
        return {
          ok: false as const,
          code: 'CONSERVATION_FAILED' as const,
          message: `netting authority: the recorded conservation proof of set ${nettingSetId} does not verify against its recorded snapshot (INV-11-1) — commit refused`,
        };
      }
      // Re-validate every input obligation and claim immediately before
      // the A10 apply loop (see the commit-ordering interpretation).
      for (const obligationId of set.inputObligationIds) {
        const obligation = this.obligations.obligation(obligationId);
        if (obligation === undefined) {
          return {
            ok: false as const,
            code: 'OBLIGATION_NOT_FOUND' as const,
            message: `netting authority: input obligation ${obligationId} no longer exists in the ledger`,
          };
        }
        if (obligation.state === 'DISPUTED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_DISPUTED' as const,
            message: `netting authority: obligation ${obligationId} became DISPUTED — netting never includes obligations in DISPUTED state`,
          };
        }
        if (obligation.state !== 'CREATED') {
          return {
            ok: false as const,
            code: 'OBLIGATION_CHANGED' as const,
            message: `netting authority: obligation ${obligationId} is ${obligation.state} (was CREATED at COMPUTE); commit refuses a changed input`,
          };
        }
        const claimedBy = this.store.membershipClaim(obligationId);
        if (claimedBy !== nettingSetId) {
          return {
            ok: false as const,
            code: 'ALREADY_CLAIMED' as const,
            message: `netting authority: obligation ${obligationId}'s membership claim is held by ${claimedBy ?? 'no set'} (expected ${nettingSetId})`,
          };
        }
      }
      // The materialized net obligations (deterministic from the recorded
      // positions — INV-11-3): flows first, then their derived ids.
      const flows = materializeNetObligations(set.netPositions);
      const netObligationRecords: NetObligationRecord[] = flows.map((flow) => {
        const at = this.now();
        return deepFreeze({
          netObligationId: netObligationIdFor(
            nettingSetId,
            flow.debtorParticipantId,
            flow.creditorParticipantId,
            flow.amount.currency,
          ),
          nettingSetId,
          debtorParticipantId: flow.debtorParticipantId,
          creditorParticipantId: flow.creditorParticipantId,
          amount: flow.amount,
          state: 'CREATED' as const,
          createdAt: at,
          stateChangedAt: at,
        });
      });
      const netObligationIds = netObligationRecords.map((entry) => entry.netObligationId);
      // Drive the A10 NETTED transitions (area-10-owned, instructed here).
      for (const obligationId of set.inputObligationIds) {
        const result = await this.obligations.applyNettingCommit({
          kind: 'NETTING_COMMIT',
          obligationId,
          nettingSetId,
          replacementObligationIds: netObligationIds,
        });
        if (!result.ok) {
          return {
            ok: false as const,
            code: 'ILLEGAL_TRANSITION' as const,
            message: `netting authority: the A10 ledger refused the NETTED transition of obligation ${obligationId}: ${result.code} — ${result.message}`,
          };
        }
      }
      // Materialize the net obligations in the netting domain.
      for (const record of netObligationRecords) {
        this.store.insertNetObligation(record);
        this.store.consumeSequence();
      }
      const committedAt = this.now();
      const committed: NettingSetRecord = deepFreeze({
        ...set,
        state: 'COMMITTED',
        committedAt,
      });
      await submitNettingEvidence(
        this.evidence,
        nettingCommittedEvidence(committed, netObligationRecords),
      );
      this.store.consumeSequence();
      this.store.updateNettingSet(committed);
      this.store.releaseMembership(nettingSetId);
      return {
        ok: true as const,
        value: {
          set: committed,
          netObligations: netObligationRecords,
          nettedObligationIds: [...set.inputObligationIds],
          noop: false,
        },
      };
    });
  }

  // -------------------------------------------------------------------------
  // The settlement-facing net-obligation lifecycle (driven by area-12
  // instruction — the A10 mirror; see types.ts's recorded interpretation)
  // -------------------------------------------------------------------------

  /**
   * Apply one settlement instruction to a net obligation — CREATED ->
   * SETTLEMENT_PENDING ("a settlement instruction (area 12) exists" —
   * the A10 vocabulary applied to the net position's obligation form). A
   * second instruction while already SETTLEMENT_PENDING is the typed
   * no-op (applied: false) — the state already says an instruction
   * exists; a SETTLED net obligation refuses the transition.
   *
   * No A11 evidence record: the A11 named set is exactly the three
   * netting records; the driving operation's A12 record
   * (SETTLEMENT_INSTRUCTION_CREATED) evidences the composite operation
   * (GC-5 exactly-one) — the RTN-008 interpretation #8 precedent,
   * recorded in CONTRACT-REVIEW.md.
   *
   * Source: clearing-netting-settlement.md lines 92-99 (the vocabulary),
   * §4 Area 12 lines 224-225; the A10 applySettlementInstruction mirror.
   */
  async applyNetPositionSettlementInstruction(input: {
    readonly netObligationId: string;
    readonly settlementInstructionId: string;
  }): Promise<
    NettingCommandResult<{ readonly netObligation: NetObligationRecord; readonly applied: boolean }>
  > {
    if (typeof input.netObligationId !== 'string' || input.netObligationId.length === 0) {
      throw new TypeError('netting authority: netObligationId must be a non-empty string');
    }
    if (
      typeof input.settlementInstructionId !== 'string' ||
      input.settlementInstructionId.length === 0
    ) {
      throw new TypeError('netting authority: settlementInstructionId must be a non-empty string');
    }
    return this.pipeline.run(NETTING_PIPELINE_KEY, async () => {
      const netObligation = this.store.netObligation(input.netObligationId);
      if (netObligation === undefined) {
        return {
          ok: false as const,
          code: 'NET_OBLIGATION_NOT_FOUND' as const,
          message: `netting authority: net obligation ${input.netObligationId} does not exist`,
        };
      }
      if (netObligation.state === 'SETTLEMENT_PENDING') {
        return { ok: true as const, value: { netObligation, applied: false } };
      }
      if (!canTransitionNetObligation(netObligation.state, 'SETTLEMENT_PENDING')) {
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `netting authority: net obligation ${input.netObligationId} is ${netObligation.state}; SETTLEMENT_PENDING is unreachable from there`,
        };
      }
      const at = this.now();
      const updated: NetObligationRecord = deepFreeze({
        ...netObligation,
        state: 'SETTLEMENT_PENDING',
        stateChangedAt: at,
      });
      this.store.consumeSequence();
      this.store.updateNetObligation(updated);
      return { ok: true as const, value: { netObligation: updated, applied: true } };
    });
  }

  /**
   * Apply one settlement finality to a net obligation — SETTLEMENT_
   * PENDING -> SETTLED, exactly once ("FINAL advances the obligation to
   * SETTLED exactly once" — A12 INV-12-4, applied to the net position's
   * obligation form). SETTLED is terminal with an empty successor set:
   * a second advance is the typed ILLEGAL_TRANSITION rejection —
   * irreversibility is structural. The causeReference is the driving
   * FinalityRecord's id.
   *
   * No A11 evidence record (the driving operation's A12 record
   * FINALITY_DECLARED evidences the composite operation — GC-5
   * exactly-one; CONTRACT-REVIEW).
   *
   * Source: clearing-netting-settlement.md §4 Area 12 lines 236-240,
   * 259-262 (INV-12-4); lines 92-99 (the vocabulary).
   */
  async applyNetPositionSettlementFinality(input: {
    readonly netObligationId: string;
    readonly finalityRecordId: string;
  }): Promise<NettingCommandResult<NetObligationRecord>> {
    if (typeof input.netObligationId !== 'string' || input.netObligationId.length === 0) {
      throw new TypeError('netting authority: netObligationId must be a non-empty string');
    }
    if (typeof input.finalityRecordId !== 'string' || input.finalityRecordId.length === 0) {
      throw new TypeError('netting authority: finalityRecordId must be a non-empty string');
    }
    return this.pipeline.run(NETTING_PIPELINE_KEY, async () => {
      const netObligation = this.store.netObligation(input.netObligationId);
      if (netObligation === undefined) {
        return {
          ok: false as const,
          code: 'NET_OBLIGATION_NOT_FOUND' as const,
          message: `netting authority: net obligation ${input.netObligationId} does not exist`,
        };
      }
      if (!canTransitionNetObligation(netObligation.state, 'SETTLED')) {
        return {
          ok: false as const,
          code: 'ILLEGAL_TRANSITION' as const,
          message: `netting authority: net obligation ${input.netObligationId} is ${netObligation.state}; FINAL advances the obligation to SETTLED exactly once (INV-12-4) — ${netObligation.state} -> SETTLED is not a legal transition`,
        };
      }
      const at = this.now();
      const updated: NetObligationRecord = deepFreeze({
        ...netObligation,
        state: 'SETTLED',
        stateChangedAt: at,
      });
      this.store.consumeSequence();
      this.store.updateNetObligation(updated);
      return { ok: true as const, value: updated };
    });
  }

  // -------------------------------------------------------------------------
  // Read surface (projections — GC-4)
  // -------------------------------------------------------------------------

  /** The NettingSet record by id. */
  nettingSet(nettingSetId: string): NettingSetRecord | undefined {
    return this.store.nettingSet(nettingSetId);
  }

  /** All NettingSet records (insertion order). */
  listNettingSets(): readonly NettingSetRecord[] {
    return this.store.listNettingSets();
  }

  /** The NetObligation record by id. */
  netObligation(netObligationId: string): NetObligationRecord | undefined {
    return this.store.netObligation(netObligationId);
  }

  /** All net obligations of one netting set (insertion order). */
  netObligationsOfSet(nettingSetId: string): readonly NetObligationRecord[] {
    return this.store.netObligationsOfSet(nettingSetId);
  }

  /** All net obligations (insertion order). */
  listNetObligations(): readonly NetObligationRecord[] {
    return this.store.listNetObligations();
  }

  /**
   * The membership claim over one obligation: the open netting set's id,
   * or undefined (the INV-11-2 probe the composition root and the tests
   * read).
   *
   * Source: clearing-netting-settlement.md lines 182-184 (INV-11-2).
   */
  obligationClaim(obligationId: string): string | undefined {
    return this.store.membershipClaim(obligationId);
  }
}
