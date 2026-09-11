/**
 * RTN-004 — Rails: the Reconciliation Authority (Area 14) command surface.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §2 Area 14:
 *   lines 143-146 (Owning authority):
 *     "Reconciliation Authority (protocol layer, area 14) owns case and
 *      cycle state and is the only authority permitted to resolve an
 *      UNKNOWN rail operation."
 *   lines 119-141 (ReconciliationCase / ReconciliationCycle /
 *    ReconciliationSource objects and state).
 *   lines 149-159 (key invariants INV-14-1 .. INV-14-4):
 *     INV-14-1: "every rail operation in UNKNOWN state has exactly one
 *      open case at all times; closure requires a terminal resolution with
 *      recorded proof."
 *     INV-14-2: "a case's terminal resolution transitions the originating
 *      rail operation exactly once; duplicate resolutions are rejected by
 *      case id."
 *     INV-14-3: "adjustments create new linked obligations or ledger
 *      entries; existing evidence and settled records are never rewritten."
 *     INV-14-4: "matching rules are pure functions of (protocol record
 *      set, external statement set, rule version); identical inputs
 *      produce identical case decisions."
 *   lines 164-179 (failure semantics + recovery paths feeding areas
 *    12/9/10).
 *   lines 181-187 (evidence produced: CASE_OPENED, CASE_RESOLVED,
 *    CYCLE_CLOSED).
 *   lines 189-195 (boundaries: "Reconciliation never re-submits external
 *    effects; it resolves them."; "Emergency manual resolutions follow the
 *    same case lifecycle and evidence requirements; there is no
 *    out-of-band path.")
 * spec/architecture/v0.1/README.md §3 GC-2 (the ONLY exit from UNKNOWN is
 *   reconciliation), GC-4 (protocol ledger stands), GC-5.
 *
 * The UNKNOWN-exit discipline (GC-2, machine-checked): the ONLY code path
 * in this entire surface that transitions an operation out of UNKNOWN is
 * `resolveCase` — a terminal case resolution with recorded proof. No
 * re-submission path exists anywhere ("Reconciliation never re-submits
 * external effects; it resolves them").
 */

import { deriveProtocolId } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { RailsStore } from './store.ts';
import { RAILS_MATCHING_RULE_VERSION, matchReconciliationRecords } from './matching.ts';
import type { MatchOutcome } from './matching.ts';
import type {
  ExternalStatementRecord,
  RailOperationRecord,
  RailsCommandResult,
  ReconciliationAdjustment,
  ReconciliationCaseRecord,
  ReconciliationCaseOrigin,
  ReconciliationCycleRecord,
  ReconciliationSourceRecord,
  RecoveryDirective,
  ResolutionProof,
} from './types.ts';

/**
 * The A14 authority name used in every evidence record's 'authority' slot.
 *
 * Source: rails-adapters-reconciliation.md lines 143-145 — "Reconciliation
 * Authority (protocol layer, area 14)".
 */
export const RECONCILIATION_AUTHORITY_ID = 'Reconciliation Authority';

/** Constructor dependencies for the Reconciliation Authority. */
export interface ReconciliationAuthorityDeps {
  readonly store: RailsStore;
  readonly evidence: EvidenceSubmission;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * One terminal case resolution. For UNKNOWN-origin cases:
 * RESOLVED_CONFIRMED / RESOLVED_FAILED / RESOLVED_ADJUSTED (each
 * transitions the originating operation exactly once — INV-14-2). For
 * CYCLE_DISCREPANCY-origin cases: MATCHED (records agree) or
 * RESOLVED_ADJUSTED (discrepancy corrected by new linked entries).
 *
 * `proof` is REQUIRED — "closure requires a terminal resolution with
 * recorded proof" (INV-14-1); CASE_RESOLVED's proof is "matched statement
 * references or adjustment ledger references".
 *
 * Source: rails-adapters-reconciliation.md lines 119-130, 151-157,
 * 181-185.
 */
export type CaseResolutionInput =
  | { readonly resolution: 'RESOLVED_CONFIRMED'; readonly proof: ResolutionProof }
  | { readonly resolution: 'RESOLVED_FAILED'; readonly proof: ResolutionProof }
  | {
      readonly resolution: 'RESOLVED_ADJUSTED';
      readonly operationOutcome: 'CONFIRMED' | 'FAILED';
      readonly proof: ResolutionProof;
      readonly adjustment: {
        readonly links: readonly string[];
        readonly description: string;
      };
    }
  | { readonly resolution: 'MATCHED'; readonly proof: ResolutionProof };

/** The outcome of one terminal resolution. */
export interface ResolveCaseOutcome {
  readonly case: ReconciliationCaseRecord;
  /** The transitioned operation, when the resolution transitioned one. */
  readonly operation?: RailOperationRecord;
  /** The created adjustment, when the resolution created one. */
  readonly adjustment?: ReconciliationAdjustment;
  /** The typed recovery directive feeding areas 12/9/10, when one applies. */
  readonly recovery?: RecoveryDirective;
}

/** The outcome of one cycle matching run (INV-14-4 decision included). */
export interface CycleMatchingOutcome {
  readonly cycle: ReconciliationCycleRecord;
  readonly match: MatchOutcome;
  readonly openedCases: readonly ReconciliationCaseRecord[];
}

function isTerminalResolution(status: ReconciliationCaseRecord['status']): boolean {
  return (
    status === 'MATCHED' ||
    status === 'RESOLVED_CONFIRMED' ||
    status === 'RESOLVED_FAILED' ||
    status === 'RESOLVED_ADJUSTED'
  );
}

function proofIsNonEmpty(proof: ResolutionProof): boolean {
  return (
    (proof.matchedStatementRefs !== undefined && proof.matchedStatementRefs.length > 0) ||
    (proof.adjustmentLedgerRefs !== undefined && proof.adjustmentLedgerRefs.length > 0) ||
    (proof.externalRefs !== undefined && proof.externalRefs.length > 0)
  );
}

function proofRefs(proof: ResolutionProof): readonly string[] {
  return [
    ...(proof.matchedStatementRefs ?? []),
    ...(proof.adjustmentLedgerRefs ?? []),
    ...(proof.externalRefs ?? []),
  ];
}

/**
 * The Reconciliation Authority: cases, sources, cycles, and adjustments —
 * the only authority permitted to resolve an UNKNOWN rail operation.
 *
 * Source: rails-adapters-reconciliation.md lines 143-146; README.md §3
 * GC-2.
 */
export class ReconciliationAuthority {
  private readonly store: RailsStore;
  private readonly evidence: EvidenceSubmission;
  private readonly wallClock: () => number;

  constructor(deps: ReconciliationAuthorityDeps) {
    this.store = deps.store;
    this.evidence = deps.evidence;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  private now(): ProtocolTime {
    return protocolTime(this.store.nextProtocolSequence(), this.wallClock());
  }

  /** Evidence submission inside the open transaction (A15 synchronous coupling — see authority.ts). */
  private emit(record: EvidenceSubmissionRecord): void {
    const returned = this.evidence.submit(record);
    if (returned !== undefined && typeof (returned as { then?: unknown }).then === 'function') {
      throw new TypeError(
        'rails: EvidenceSubmission.submit returned a promise — the synchronous A15 coupling requires the synchronous port form (RTN-012 owns the composed integration)',
      );
    }
  }

  // -------------------------------------------------------------------------
  // INV-14-1: the automatic UNKNOWN case
  // -------------------------------------------------------------------------

  /**
   * The auto-case opener (the UnknownCaseOpener port the Rail Adapter
   * Authority invokes inside its command transaction, atomically with the
   * UNKNOWN landing): "Every UNKNOWN rail operation automatically opens
   * exactly one case" — idempotent by origin operation id (duplicate
   * case-open attempts are no-ops), enforced additionally by the store's
   * partial UNIQUE index on origin_operation_id.
   *
   * Evidence: CASE_OPENED "(origin rail operation id)".
   *
   * Source: rails-adapters-reconciliation.md lines 80-81, 124-126, 150-152
   * (INV-14-1), 181-182.
   */
  openCaseForUnknownOperation(operation: RailOperationRecord): ReconciliationCaseRecord {
    return this.store.transaction(() => {
      const existing = this.store.getCaseByOriginOperation(operation.operationId);
      if (existing !== undefined) {
        return existing;
      }
      const caseId = deriveProtocolId('reconciliation-case', operation.operationId);
      const at = this.now();
      const record: ReconciliationCaseRecord = {
        caseId,
        status: 'OPEN',
        origin: {
          kind: 'UNKNOWN_OPERATION',
          operationId: operation.operationId,
          instructionId: operation.instructionId,
        },
        openedAt: at,
      };
      this.store.insertCase(record);
      this.emit({
        what: {
          operationType: 'CASE_OPENED',
          subjectIds: [caseId, operation.operationId],
        },
        when: at,
        authority: RECONCILIATION_AUTHORITY_ID,
        outcome: { result: 'OPEN', reasonCode: 'UNKNOWN' },
        proof: { sequenceNumbers: [at.sequence] },
      });
      return record;
    });
  }

  // -------------------------------------------------------------------------
  // Case lifecycle
  // -------------------------------------------------------------------------

  /**
   * OPEN→INVESTIGATING. No evidence record: the A14 evidence list is
   * exactly CASE_OPENED / CASE_RESOLVED / CYCLE_CLOSED, and investigation
   * is not itself a consequential operation under GC-5 (it creates,
   * mutates, or resolves no financial state and authorizes no external
   * effect) — recorded as interpretation decision in CONTRACT-REVIEW.md.
   *
   * Source: rails-adapters-reconciliation.md lines 119-122 (case state
   * machine), 181-187 (evidence produced).
   */
  investigateCase(caseId: string): RailsCommandResult<ReconciliationCaseRecord> {
    return this.store.transaction(() => {
      const existing = this.store.getCase(caseId);
      if (existing === undefined) {
        return { ok: false, reasonCode: 'CASE_NOT_FOUND', detail: `case ${caseId} does not exist` };
      }
      if (existing.status !== 'OPEN') {
        return {
          ok: false,
          reasonCode: 'CASE_NOT_OPEN',
          detail: `case ${caseId} is ${existing.status}; investigation requires OPEN`,
        };
      }
      const at = this.now();
      const updated: ReconciliationCaseRecord = { ...existing, status: 'INVESTIGATING' };
      this.store.updateCase(updated);
      return { ok: true, value: updated };
    });
  }

  /**
   * INVESTIGATING→terminal — the ONLY exit from UNKNOWN in the entire
   * surface (GC-2), and the ONLY transition of an UNKNOWN operation
   * (INV-14-2: exactly once; duplicates rejected by case id).
   *
   * Resolution semantics by origin:
   *   UNKNOWN_OPERATION:
   *     RESOLVED_CONFIRMED → operation UNKNOWN→CONFIRMED; recovery feeds
   *       AREA_12_FINALITY_ADVANCE ("area 12 marks the attempt CONFIRMED
   *       and advances finality").
   *     RESOLVED_FAILED → operation UNKNOWN→FAILED; recovery feeds
   *       AREA_12_NEW_INSTRUCTION ("a new instruction may be created,
   *       fully evidenced as a new external effect" — recovery is a NEW
   *       instruction, never a retry).
   *     RESOLVED_ADJUSTED → operation UNKNOWN→(stated true outcome) AND a
   *       NEW linked adjustment entry (INV-14-3); recovery feeds
   *       AREA_09_10_NEW_LINKED_ENTRIES.
   *     MATCHED → rejected (RESOLUTION_NOT_APPLICABLE): MATCHED is the
   *       cycle-discrepancy terminal ("protocol expectation and external
   *       statement agree"); an UNKNOWN-origin resolution must state the
   *       operation's true outcome (interpretation decision,
   *       CONTRACT-REVIEW.md).
   *   CYCLE_DISCREPANCY:
   *     MATCHED → investigation found the records agree; no operation
   *       transition (proof: matched statement references REQUIRED).
   *     RESOLVED_ADJUSTED → NEW linked adjustment entry; no operation
   *       transition.
   *     RESOLVED_CONFIRMED / RESOLVED_FAILED → rejected
   *       (RESOLUTION_NOT_APPLICABLE): there is no UNKNOWN operation to
   *       resolve.
   *
   * Guards: case must be INVESTIGATING (a terminal case is a
   * DUPLICATE_RESOLUTION — INV-14-2 verbatim: "duplicate resolutions are
   * rejected by case id"); proof must be non-empty (PROOF_REQUIRED);
   * ADJUSTED requires non-empty adjustment links (the prior entries being
   * corrected).
   *
   * Evidence: CASE_RESOLVED "(terminal class, proof: matched statement
   * references or adjustment ledger references)".
   *
   * Source: rails-adapters-reconciliation.md lines 119-130, 149-157,
   * 171-185; README.md §3 GC-2.
   */
  resolveCase(caseId: string, input: CaseResolutionInput): RailsCommandResult<ResolveCaseOutcome> {
    return this.store.transaction(() => {
      const existing = this.store.getCase(caseId);
      if (existing === undefined) {
        return { ok: false, reasonCode: 'CASE_NOT_FOUND', detail: `case ${caseId} does not exist` };
      }
      if (isTerminalResolution(existing.status)) {
        // INV-14-2 verbatim: "duplicate resolutions are rejected by case id".
        return {
          ok: false,
          reasonCode: 'DUPLICATE_RESOLUTION',
          detail: `case ${caseId} is already terminally resolved (${existing.status}); INV-14-2 rejects duplicate resolutions by case id`,
        };
      }
      if (existing.status !== 'INVESTIGATING') {
        return {
          ok: false,
          reasonCode: 'CASE_NOT_INVESTIGATING',
          detail: `case ${caseId} is ${existing.status}; terminal resolution requires INVESTIGATING (the case lifecycle: OPEN -> INVESTIGATING -> terminal)`,
        };
      }
      if (!proofIsNonEmpty(input.proof)) {
        return {
          ok: false,
          reasonCode: 'PROOF_REQUIRED',
          detail: 'closure requires a terminal resolution with recorded proof (INV-14-1)',
        };
      }
      if (input.resolution === 'MATCHED' && (input.proof.matchedStatementRefs ?? []).length === 0) {
        return {
          ok: false,
          reasonCode: 'PROOF_REQUIRED',
          detail: 'MATCHED closure requires matched statement references as proof',
        };
      }
      if (
        input.resolution === 'RESOLVED_ADJUSTED' &&
        (input.adjustment.links.length === 0 || input.adjustment.description.length === 0)
      ) {
        return {
          ok: false,
          reasonCode: 'ADJUSTMENT_NOT_POSSIBLE',
          detail: 'RESOLVED_ADJUSTED requires non-empty adjustment links (the prior entries) and a description',
        };
      }

      const isUnknownOrigin = existing.origin.kind === 'UNKNOWN_OPERATION';
      if (isUnknownOrigin && input.resolution === 'MATCHED') {
        return {
          ok: false,
          reasonCode: 'RESOLUTION_NOT_APPLICABLE',
          detail: 'MATCHED is the cycle-discrepancy terminal; an UNKNOWN-operation case must state the true outcome (RESOLVED_CONFIRMED | RESOLVED_FAILED | RESOLVED_ADJUSTED)',
        };
      }
      if (!isUnknownOrigin && (input.resolution === 'RESOLVED_CONFIRMED' || input.resolution === 'RESOLVED_FAILED')) {
        return {
          ok: false,
          reasonCode: 'RESOLUTION_NOT_APPLICABLE',
          detail: 'RESOLVED_CONFIRMED / RESOLVED_FAILED resolve an UNKNOWN rail operation; a cycle-discrepancy case resolves as MATCHED or RESOLVED_ADJUSTED',
        };
      }

      const at = this.now();
      let operation: RailOperationRecord | undefined;
      let adjustment: ReconciliationAdjustment | undefined;
      let recovery: RecoveryDirective | undefined;

      if (isUnknownOrigin) {
        const origin = existing.origin as Extract<
          ReconciliationCaseOrigin,
          { kind: 'UNKNOWN_OPERATION' }
        >;
        const operationOutcome =
          input.resolution === 'RESOLVED_CONFIRMED'
            ? 'CONFIRMED'
            : input.resolution === 'RESOLVED_FAILED'
              ? 'FAILED'
              : input.resolution === 'RESOLVED_ADJUSTED'
                ? input.operationOutcome
                : undefined;
        if (operationOutcome !== undefined) {
          // The INV-14-2 exactly-once transition: validated UNKNOWN source
          // state, written exactly once, only through this command.
          const current = this.store.getOperation(origin.operationId);
          if (current === undefined) {
            return {
              ok: false,
              reasonCode: 'OPERATION_NOT_FOUND',
              detail: `origin operation ${origin.operationId} does not exist`,
            };
          }
          if (current.status !== 'UNKNOWN') {
            return {
              ok: false,
              reasonCode: 'ILLEGAL_TRANSITION',
              detail: `origin operation ${origin.operationId} is ${current.status}; INV-14-2 resolves UNKNOWN exactly once`,
            };
          }
          operation = this.store.resolveOperationFromUnknown(
            origin.operationId,
            operationOutcome,
            undefined,
            at,
          );
        }
        if (input.resolution === 'RESOLVED_CONFIRMED') {
          recovery = {
            feed: 'AREA_12_FINALITY_ADVANCE',
            instructionId: origin.instructionId,
            operationId: origin.operationId,
            attemptOutcome: 'CONFIRMED',
          };
        } else if (input.resolution === 'RESOLVED_FAILED') {
          recovery = {
            feed: 'AREA_12_NEW_INSTRUCTION',
            instructionId: origin.instructionId,
            operationId: origin.operationId,
            note: 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY',
          };
        }
      }

      if (input.resolution === 'RESOLVED_ADJUSTED') {
        // INV-14-3: a NEW linked entry; prior entries are referenced, never
        // rewritten.
        const ordinal = this.store.listAdjustments(caseId).length + 1;
        const adjustmentId = deriveProtocolId('reconciliation-adjustment', caseId, ordinal);
        const originOperationId =
          existing.origin.kind === 'UNKNOWN_OPERATION' ? existing.origin.operationId : undefined;
        adjustment = {
          adjustmentId,
          caseId,
          ...(originOperationId === undefined ? {} : { operationId: originOperationId }),
          links: [...input.adjustment.links],
          description: input.adjustment.description,
          createdAt: at,
        };
        this.store.insertAdjustment(adjustment);
        recovery = {
          feed: 'AREA_09_10_NEW_LINKED_ENTRIES',
          caseId,
          adjustmentIds: [adjustmentId],
          linkedPriorEntries: [...input.adjustment.links],
        };
      }

      const resolved: ReconciliationCaseRecord = {
        ...existing,
        status: input.resolution,
        resolvedAt: at,
        resolution: input.resolution,
        ...(recovery === undefined ? {} : { recovery }),
      };
      this.store.updateCase(resolved);
      this.emit({
        what: {
          operationType: 'CASE_RESOLVED',
          subjectIds: [
            caseId,
            ...(existing.origin.kind === 'UNKNOWN_OPERATION'
              ? [(existing.origin as Extract<ReconciliationCaseOrigin, { kind: 'UNKNOWN_OPERATION' }>).operationId]
              : [existing.origin.cycleId]),
          ],
        },
        when: at,
        authority: RECONCILIATION_AUTHORITY_ID,
        outcome: { result: input.resolution },
        proof: {
          priorRecordIds: proofRefs(input.proof),
          ...(adjustment === undefined ? {} : { hashes: [adjustment.adjustmentId] }),
          sequenceNumbers: [at.sequence],
        },
      });
      return {
        ok: true,
        value: { case: resolved, ...(operation === undefined ? {} : { operation }), ...(adjustment === undefined ? {} : { adjustment }), ...(recovery === undefined ? {} : { recovery }) },
      };
    });
  }

  getCase(caseId: string): ReconciliationCaseRecord | undefined {
    return this.store.getCase(caseId);
  }

  getCaseByOriginOperation(operationId: string): ReconciliationCaseRecord | undefined {
    return this.store.getCaseByOriginOperation(operationId);
  }

  listCases(): ReconciliationCaseRecord[] {
    return this.store.listCases();
  }

  listAdjustments(caseId: string): ReconciliationAdjustment[] {
    return this.store.listAdjustments(caseId);
  }

  // -------------------------------------------------------------------------
  // Sources (untrusted statement providers with sequence numbers)
  // -------------------------------------------------------------------------

  /**
   * Register one external statement provider. Deterministic and
   * idempotent: the source id derives from (kind, description).
   *
   * Source: rails-adapters-reconciliation.md lines 139-141 —
   * "ReconciliationSource — registered external statement provider (rail
   * settlement report, statement file, on-chain observer), treated as
   * untrusted input with sequence numbers." (The three named kinds are
   * the spec's examples of providers, not a closed enumeration —
   * interpretation decision, CONTRACT-REVIEW.md.)
   */
  registerSource(input: {
    readonly kind: string;
    readonly description: string;
  }): RailsCommandResult<ReconciliationSourceRecord> {
    if (typeof input.kind !== 'string' || input.kind.length === 0) {
      return { ok: false, reasonCode: 'PAYLOAD_MALFORMED', detail: 'kind must be a non-empty string' };
    }
    if (typeof input.description !== 'string' || input.description.length === 0) {
      return { ok: false, reasonCode: 'PAYLOAD_MALFORMED', detail: 'description must be a non-empty string' };
    }
    const sourceId = deriveProtocolId('reconciliation-source', input.kind, input.description);
    return this.store.transaction(() => {
      const existing = this.store.getSource(sourceId);
      if (existing !== undefined) {
        return { ok: true, value: existing };
      }
      const at = this.now();
      const record: ReconciliationSourceRecord = {
        sourceId,
        kind: input.kind,
        description: input.description,
        lastSequence: 0,
        registeredAt: at,
      };
      this.store.insertSource(record);
      return { ok: true, value: record };
    });
  }

  getSource(sourceId: string): ReconciliationSourceRecord | undefined {
    return this.store.getSource(sourceId);
  }

  listSources(): ReconciliationSourceRecord[] {
    return this.store.listSources();
  }

  // -------------------------------------------------------------------------
  // Cycles (periodic matching runs)
  // -------------------------------------------------------------------------

  /**
   * Open one matching cycle over a wall-time window. Deterministic and
   * idempotent: the cycle id derives from (windowStart, windowEnd,
   * ruleVersion). All named sources must be registered.
   *
   * Source: rails-adapters-reconciliation.md lines 133-137 ("Reconciliation
   * Cycle — periodic matching run over a window of protocol records and
   * external statements"), 156-159 (INV-14-4).
   */
  openCycle(input: {
    readonly windowStartWallMs: number;
    readonly windowEndWallMs: number;
    readonly sourceIds: readonly string[];
    readonly ruleVersion?: number;
  }): RailsCommandResult<ReconciliationCycleRecord> {
    if (
      !Number.isSafeInteger(input.windowStartWallMs) ||
      !Number.isSafeInteger(input.windowEndWallMs) ||
      input.windowStartWallMs > input.windowEndWallMs
    ) {
      return {
        ok: false,
        reasonCode: 'PAYLOAD_MALFORMED',
        detail: 'window bounds must be safe integers with start <= end',
      };
    }
    const ruleVersion = input.ruleVersion ?? RAILS_MATCHING_RULE_VERSION;
    if (ruleVersion !== RAILS_MATCHING_RULE_VERSION) {
      return {
        ok: false,
        reasonCode: 'MATCHING_RULE_VERSION_UNSUPPORTED',
        detail: `rule version ${ruleVersion} is not implemented (supported: ${RAILS_MATCHING_RULE_VERSION}) — INV-14-4 fail-closed`,
      };
    }
    if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0) {
      return {
        ok: false,
        reasonCode: 'SOURCE_NOT_REGISTERED',
        detail: 'a cycle names at least one registered source',
      };
    }
    const cycleId = deriveProtocolId(
      'reconciliation-cycle',
      input.windowStartWallMs,
      input.windowEndWallMs,
      ruleVersion,
    );
    return this.store.transaction(() => {
      const existing = this.store.getCycle(cycleId);
      if (existing !== undefined) {
        return { ok: true, value: existing };
      }
      for (const sourceId of input.sourceIds) {
        const source = this.store.getSource(sourceId);
        if (source === undefined) {
          return {
            ok: false,
            reasonCode: 'SOURCE_NOT_REGISTERED',
            detail: `source ${sourceId} is not registered`,
          };
        }
      }
      const at = this.now();
      const record: ReconciliationCycleRecord = {
        cycleId,
        status: 'OPEN',
        windowStartWallMs: input.windowStartWallMs,
        windowEndWallMs: input.windowEndWallMs,
        ruleVersion,
        sourceIds: [...input.sourceIds],
        statementCount: 0,
        matchedCount: 0,
        discrepancyCount: 0,
        openCaseCount: 0,
        openedAt: at,
      };
      this.store.insertCycle(record, []);
      return { ok: true, value: record };
    });
  }

  /**
   * OPEN→COLLECTED: ingest the window's external statements (untrusted
   * input — structurally validated, never trusted) and snapshot the
   * protocol records in the window (the two halves of the INV-14-4 pure
   * function's input). Per-source sequence numbers must be strictly
   * increasing (SEQUENCE_REGRESSION otherwise) — the untrusted-input
   * discipline. Statement sources must belong to the cycle's source set.
   *
   * Source: rails-adapters-reconciliation.md lines 133-137, 139-141,
   * 168-170 ("Reconciliation consumes external statements that may
   * themselves be incomplete or delayed").
   */
  collectStatements(
    cycleId: string,
    statements: readonly ExternalStatementRecord[],
  ): RailsCommandResult<ReconciliationCycleRecord> {
    return this.store.transaction(() => {
      const cycle = this.store.getCycle(cycleId);
      if (cycle === undefined) {
        return { ok: false, reasonCode: 'CYCLE_NOT_FOUND', detail: `cycle ${cycleId} does not exist` };
      }
      if (cycle.status !== 'OPEN') {
        return {
          ok: false,
          reasonCode: 'CYCLE_NOT_OPEN',
          detail: `cycle ${cycleId} is ${cycle.status}; collection requires OPEN`,
        };
      }
      const perSourceSequences = new Map<string, number[]>();
      for (const sourceId of cycle.sourceIds) {
        const source = this.store.getSource(sourceId);
        perSourceSequences.set(sourceId, source === undefined ? [] : [source.lastSequence]);
      }
      for (const statement of statements) {
        if (!cycle.sourceIds.includes(statement.sourceId)) {
          return {
            ok: false,
            reasonCode: 'SOURCE_NOT_REGISTERED',
            detail: `statement source ${statement.sourceId} is not a source of cycle ${cycleId}`,
          };
        }
        if (!Number.isSafeInteger(statement.sequence) || statement.sequence <= 0) {
          return {
            ok: false,
            reasonCode: 'PAYLOAD_MALFORMED',
            detail: `statement sequence must be a positive integer (got ${String(statement.sequence)})`,
          };
        }
        perSourceSequences.get(statement.sourceId)?.push(statement.sequence);
      }
      for (const [sourceId, sequences] of perSourceSequences) {
        for (let index = 1; index < sequences.length; index += 1) {
          const previous = sequences[index - 1];
          const current = sequences[index];
          if (previous !== undefined && current !== undefined && current <= previous) {
            return {
              ok: false,
              reasonCode: 'SEQUENCE_REGRESSION',
              detail: `source ${sourceId}: sequence ${current} does not advance past ${previous} (untrusted input discipline: strictly increasing per-source sequences)`,
            };
          }
        }
        const highest = Math.max(...sequences, 0);
        const source = this.store.getSource(sourceId);
        if (source !== undefined && highest > source.lastSequence) {
          this.store.updateSource({ ...source, lastSequence: highest });
        }
      }
      const operations = this.store.listOperationsInWindow(
        cycle.windowStartWallMs,
        cycle.windowEndWallMs,
      );
      const at = this.now();
      const collected: ReconciliationCycleRecord = {
        ...cycle,
        status: 'COLLECTED',
        statementCount: statements.length,
      };
      this.store.updateCycle(collected);
      this.store.snapshotCycleInputs(cycleId, statements, operations);
      return { ok: true, value: collected };
    });
  }

  /**
   * COLLECTED→MATCHED: run the deterministic matching rules (INV-14-4) over
   * the collected inputs; "Discrepancies become cases" — each discrepancy
   * opens a CYCLE_DISCREPANCY-origin case (deterministic case ids derived
   * from the cycle and the discrepancy identity).
   *
   * Source: rails-adapters-reconciliation.md lines 133-137, 156-159;
   * matching.ts (rule version 1).
   */
  runMatching(cycleId: string): RailsCommandResult<CycleMatchingOutcome> {
    return this.store.transaction(() => {
      const cycle = this.store.getCycle(cycleId);
      if (cycle === undefined) {
        return { ok: false, reasonCode: 'CYCLE_NOT_FOUND', detail: `cycle ${cycleId} does not exist` };
      }
      if (cycle.status !== 'COLLECTED') {
        return {
          ok: false,
          reasonCode: 'CYCLE_NOT_COLLECTED',
          detail: `cycle ${cycleId} is ${cycle.status}; matching requires COLLECTED`,
        };
      }
      const statements = this.store.getCycleStatements(cycleId);
      const operations = this.store.getCycleOperationSnapshot(cycleId);
      const match = matchReconciliationRecords(operations, statements, cycle.ruleVersion);
      const openedCases: ReconciliationCaseRecord[] = [];
      for (const discrepancy of match.discrepancies) {
        const caseId = deriveProtocolId(
          'reconciliation-case',
          'cycle',
          cycleId,
          discrepancy.kind,
          discrepancy.operationId ?? '',
          discrepancy.statementRef ?? '',
        );
        const existing = this.store.getCase(caseId);
        if (existing !== undefined) {
          openedCases.push(existing);
          continue;
        }
        const at = this.now();
        const record: ReconciliationCaseRecord = {
          caseId,
          status: 'OPEN',
          origin: {
            kind: 'CYCLE_DISCREPANCY',
            cycleId,
            discrepancyKind: discrepancy.kind,
            ...(discrepancy.statementRef === undefined ? {} : { statementRef: discrepancy.statementRef }),
            ...(discrepancy.operationId === undefined ? {} : { protocolRef: discrepancy.operationId }),
          },
          openedAt: at,
        };
        this.store.insertCase(record);
        this.emit({
          what: {
            operationType: 'CASE_OPENED',
            subjectIds: [caseId, cycleId, ...(discrepancy.operationId === undefined ? [] : [discrepancy.operationId])],
          },
          when: at,
          authority: RECONCILIATION_AUTHORITY_ID,
          outcome: { result: 'OPEN', reasonCode: discrepancy.kind },
          proof: { sequenceNumbers: [at.sequence] },
        });
        openedCases.push(record);
      }
      const at = this.now();
      const matchedCycle: ReconciliationCycleRecord = {
        ...cycle,
        status: 'MATCHED',
        matchedCount: match.matched.length,
        discrepancyCount: match.discrepancies.length,
      };
      this.store.updateCycle(matchedCycle);
      return { ok: true, value: { cycle: matchedCycle, match, openedCases } };
    });
  }

  /**
   * MATCHED→CLOSED. Evidence: CYCLE_CLOSED "(window bounds, matched
   * counts, open case count)" — the open-case count is this cycle's own
   * still-open cases ("the case stays open until a terminal resolution",
   * INV-14-1); interpretation decision recorded in CONTRACT-REVIEW.md.
   *
   * Source: rails-adapters-reconciliation.md lines 133-137, 186-187.
   */
  closeCycle(cycleId: string): RailsCommandResult<ReconciliationCycleRecord> {
    return this.store.transaction(() => {
      const cycle = this.store.getCycle(cycleId);
      if (cycle === undefined) {
        return { ok: false, reasonCode: 'CYCLE_NOT_FOUND', detail: `cycle ${cycleId} does not exist` };
      }
      if (cycle.status !== 'MATCHED') {
        return {
          ok: false,
          reasonCode: 'CYCLE_NOT_MATCHED',
          detail: `cycle ${cycleId} is ${cycle.status}; closure requires MATCHED`,
        };
      }
      const openCases = this.store
        .listCasesByCycle(cycleId)
        .filter((record) => record.status === 'OPEN' || record.status === 'INVESTIGATING');
      const at = this.now();
      const closed: ReconciliationCycleRecord = {
        ...cycle,
        status: 'CLOSED',
        openCaseCount: openCases.length,
      };
      this.store.updateCycle(closed);
      this.emit({
        what: { operationType: 'CYCLE_CLOSED', subjectIds: [cycleId] },
        when: at,
        authority: RECONCILIATION_AUTHORITY_ID,
        outcome: { result: 'CLOSED' },
        proof: {
          sequenceNumbers: [
            closed.windowStartWallMs,
            closed.windowEndWallMs,
            closed.matchedCount,
            closed.discrepancyCount,
            closed.openCaseCount,
          ],
        },
      });
      return { ok: true, value: closed };
    });
  }

  getCycle(cycleId: string): ReconciliationCycleRecord | undefined {
    return this.store.getCycle(cycleId);
  }
}
