/**
 * RTN-004 — Rails: the Rail Adapter Authority (Area 13) command surface.
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §1 Area 13:
 *   lines 50-54 (Owning authority):
 *     "Rail Adapter Authority (protocol layer, area 13) owns adapter
 *      registry and operation lifecycle. The external rail is an untrusted
 *      reporter: its data is evidence, not protocol truth."
 *   lines 56-72 (key invariants INV-13-1 .. INV-13-4).
 *   lines 74-87 (failure and UNKNOWN semantics):
 *     "UNKNOWN, which: 1. Opens a reconciliation case (area 14)
 *      automatically. 2. Leaves the rail operation durably in UNKNOWN.
 *      3. Forbids re-submission of the same external effect (GC-2)."
 *   lines 89-95 (evidence produced: RAIL_OP_AUTHORIZED, RAIL_OP_SUBMITTED,
 *    RAIL_OP_REPORTED, ADAPTER_STATE_CHANGED).
 * spec/architecture/v0.1/README.md §3 GC-2/GC-3/GC-5.
 * rtn-plan-rulings.md Q1 / delta 1 (binding): the state machines are
 *   protocol-owned authority state; the adapter interface is
 *   transmission-and-reporting only; "reports (RailResultReport) are
 *   returned/recorded and state advances only through the authority's
 *   command surface" — THIS module is that command surface.
 *
 * Command discipline:
 *   - Every command runs in exactly one store transaction (single-writer
 *     discipline; the store is the only writer of rails state).
 *   - Every consequential transition submits its GC-5 evidence record
 *     INSIDE the transaction (A15 synchronous coupling: "an operation is
 *     not committed until its record is written. A failed write fails the
 *     operation" — a submit failure rolls the whole command back).
 *   - Domain rejections are typed values (RailsCommandResult), never
 *     thrown.
 *   - The GC-2 machine check: `submitRailOperation` requires the operation
 *     to be in AUTHORIZED — an UNKNOWN (or any non-AUTHORIZED) operation is
 *     REFUSED. No command of this authority transitions an operation out of
 *     UNKNOWN; the only such transitions are executed by the Reconciliation
 *     Authority's case resolution (INV-14-2).
 */

import { deriveProtocolId, deriveIdempotencyKey } from '../kernel/identity.ts';
import { protocolTime } from '../kernel/time.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { RailsStore } from './store.ts';
import {
  RAIL_ADAPTER_TRANSITIONS,
  RAIL_OPERATION_TRANSITIONS,
} from './types.ts';
import type {
  RailAdapterRecord,
  RailOperationPayload,
  RailOperationRecord,
  RailResultReportRecord,
  RailsCommandResult,
  RailReportClass,
  UnknownCaseOpener,
} from './types.ts';
import { hashRailPayload, validateRailOperationPayload } from './payload.ts';
import { submissionReportClass } from './adapters.ts';
import type { RailAdapterConnection, RailReportEnvelope, RailTransmissionOutcome } from './adapters.ts';

/**
 * The A13 authority name used in every evidence record's 'authority' slot.
 *
 * Source: rails-adapters-reconciliation.md lines 50-51 — "Rail Adapter
 * Authority (protocol layer, area 13)".
 */
export const RAIL_ADAPTER_AUTHORITY_ID = 'Rail Adapter Authority';

/** Constructor dependencies for the Rail Adapter Authority. */
export interface RailAdapterAuthorityDeps {
  readonly store: RailsStore;
  readonly evidence: EvidenceSubmission;
  /** The INV-14-1 auto-case opener (implemented by the Reconciliation Authority). */
  readonly caseOpener: UnknownCaseOpener;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/** The outcome of one submission command (the full picture, for the caller). */
export interface SubmitRailOperationOutcome {
  readonly operation: RailOperationRecord;
  /** The INV-13-4 report class the adapter mapped this submission to. */
  readonly submissionReportClass: RailReportClass;
  readonly transmitOutcome: RailTransmissionOutcome;
}

/**
 * The Rail Adapter Authority: adapter registry + operation lifecycle + rail
 * result report ingestion, as protocol-owned command surfaces over the
 * per-domain store.
 *
 * Source: rails-adapters-reconciliation.md lines 50-54; rtn-plan-rulings.md
 * Q1/delta 1.
 */
export class RailAdapterAuthority {
  private readonly store: RailsStore;
  private readonly evidence: EvidenceSubmission;
  private readonly caseOpener: UnknownCaseOpener;
  private readonly wallClock: () => number;

  constructor(deps: RailAdapterAuthorityDeps) {
    this.store = deps.store;
    this.evidence = deps.evidence;
    this.caseOpener = deps.caseOpener;
    this.wallClock = deps.wallClock ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private now(): ProtocolTime {
    return protocolTime(this.store.nextProtocolSequence(), this.wallClock());
  }

  /**
   * Submit one evidence record INSIDE the open transaction (A15
   * synchronous coupling). A thenable return (async port implementation)
   * is unsupported here — A15's contract is synchronous with the operation
   * ("Evidence writing is internal and synchronous with the operation it
   * records"); the composed real-log integration lands in RTN-012.
   */
  private emit(record: EvidenceSubmissionRecord): void {
    const returned = this.evidence.submit(record);
    if (returned !== undefined && typeof (returned as { then?: unknown }).then === 'function') {
      throw new TypeError(
        'rails: EvidenceSubmission.submit returned a promise — the synchronous A15 coupling requires the synchronous port form (RTN-012 owns the composed integration)',
      );
    }
  }

  /**
   * One validated state write: checks the frozen transition table (the
   * command guards already reject illegal targets as typed values — this
   * is the belt-and-braces guard that makes an illegal WRITE impossible)
   * and persists the updated record. Returns the updated record.
   */
  private transitionOperation(
    from: RailOperationRecord,
    to: RailOperationRecord['status'],
    at: ProtocolTime,
    patch: {
      reasonCode?: string;
      railReferences?: readonly string[];
    } = {},
  ): RailOperationRecord {
    if (from.status !== to && !RAIL_OPERATION_TRANSITIONS[from.status].includes(to)) {
      throw new TypeError(
        `rails: illegal transition ${from.status} -> ${to} on operation ${from.operationId}`,
      );
    }
    const updated: RailOperationRecord = {
      ...from,
      status: to,
      ...(patch.reasonCode === undefined ? {} : { reasonCode: patch.reasonCode }),
      ...(patch.railReferences === undefined ? {} : { railReferences: patch.railReferences }),
      updatedAt: at,
    };
    this.store.updateOperation(updated);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Adapter registry commands (ADAPTER_STATE_CHANGED evidence)
  // -------------------------------------------------------------------------

  /**
   * Register one adapter for an external rail family. Deterministic and
   * idempotent: the adapter id is derived from (railFamily, name), so a
   * duplicate registration returns the recorded adapter unchanged (the
   * kernel idempotency discipline: "duplicate requests return the recorded
   * state").
   *
   * Source: rails-adapters-reconciliation.md lines 29-31 ("RailAdapter —
   * registered connector for one external rail family"); kernel identity.ts
   * (derived-id discipline).
   */
  registerAdapter(input: {
    readonly railFamily: string;
    readonly name: string;
  }): RailsCommandResult<RailAdapterRecord> {
    if (typeof input.railFamily !== 'string' || input.railFamily.length === 0) {
      return { ok: false, reasonCode: 'PAYLOAD_MALFORMED', detail: 'railFamily must be a non-empty string' };
    }
    if (typeof input.name !== 'string' || input.name.length === 0) {
      return { ok: false, reasonCode: 'PAYLOAD_MALFORMED', detail: 'name must be a non-empty string' };
    }
    const adapterId = deriveProtocolId('rail-adapter', input.railFamily, input.name);
    return this.store.transaction(() => {
      const existing = this.store.getAdapter(adapterId);
      if (existing !== undefined) {
        return { ok: true, value: existing };
      }
      const at = this.now();
      const record: RailAdapterRecord = {
        adapterId,
        railFamily: input.railFamily,
        name: input.name,
        status: 'REGISTERED',
        createdAt: at,
        updatedAt: at,
      };
      this.store.insertAdapter(record);
      this.emit({
        what: { operationType: 'ADAPTER_STATE_CHANGED', subjectIds: [adapterId] },
        when: at,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: { result: 'REGISTERED' },
        proof: { sequenceNumbers: [at.sequence] },
      });
      return { ok: true, value: record };
    });
  }

  /**
   * REGISTERED→ACTIVE. Illegal transitions are rejected deterministically.
   *
   * Source: rails-adapters-reconciliation.md lines 30-31 (state list);
   * lines 93-95 (ADAPTER_STATE_CHANGED evidence "with reason codes").
   */
  activateAdapter(adapterId: string): RailsCommandResult<RailAdapterRecord> {
    return this.adapterStateChange(adapterId, 'ACTIVE', undefined);
  }

  /**
   * ACTIVE→DEGRADED. "DEGRADED adapters accept no new operations; in-flight
   * operations continue to report results" — enforced by the authorize/
   * submit guards; report ingestion performs no adapter-status check.
   *
   * Source: rails-adapters-reconciliation.md lines 30-32.
   */
  degradeAdapter(adapterId: string, reasonCode?: string): RailsCommandResult<RailAdapterRecord> {
    return this.adapterStateChange(adapterId, 'DEGRADED', reasonCode);
  }

  /**
   * DEGRADED→RETIRED. The frozen lifecycle has no re-activation arrow: a
   * recovered adapter is a new registration (interpretation decision,
   * CONTRACT-REVIEW).
   *
   * Source: rails-adapters-reconciliation.md lines 30-31.
   */
  retireAdapter(adapterId: string, reasonCode?: string): RailsCommandResult<RailAdapterRecord> {
    return this.adapterStateChange(adapterId, 'RETIRED', reasonCode);
  }

  private adapterStateChange(
    adapterId: string,
    to: RailAdapterRecord['status'],
    reasonCode: string | undefined,
  ): RailsCommandResult<RailAdapterRecord> {
    return this.store.transaction(() => {
      const existing = this.store.getAdapter(adapterId);
      if (existing === undefined) {
        return {
          ok: false,
          reasonCode: 'ADAPTER_NOT_FOUND',
          detail: `adapter ${adapterId} is not registered`,
        };
      }
      if (!RAIL_ADAPTER_TRANSITIONS[existing.status].includes(to)) {
        return {
          ok: false,
          reasonCode: 'ILLEGAL_TRANSITION',
          detail: `adapter ${adapterId} is ${existing.status}; ${existing.status} -> ${to} is not a legal RailAdapter transition`,
        };
      }
      const at = this.now();
      const updated: RailAdapterRecord = {
        ...existing,
        status: to,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        updatedAt: at,
      };
      this.store.updateAdapter(updated);
      this.emit({
        what: { operationType: 'ADAPTER_STATE_CHANGED', subjectIds: [adapterId] },
        when: at,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: { result: to, ...(reasonCode === undefined ? {} : { reasonCode }) },
        proof: { sequenceNumbers: [at.sequence] },
      });
      return { ok: true, value: updated };
    });
  }

  getAdapter(adapterId: string): RailAdapterRecord | undefined {
    return this.store.getAdapter(adapterId);
  }

  listAdapters(): RailAdapterRecord[] {
    return this.store.listAdapters();
  }

  // -------------------------------------------------------------------------
  // Operation lifecycle commands
  // -------------------------------------------------------------------------

  /**
   * Create one RailOperation in AUTHORIZED, linked to its settlement
   * instruction — "this link is the explicit authorization required by
   * GC-3" — with the payload hash recorded and the deterministic rail
   * idempotency key derived from the instruction id (INV-13-3:
   * "deterministic rail idempotency key derived from the instruction id").
   *
   * Deterministic and idempotent: the operation id and key derive from the
   * instruction id, so a duplicate authorization returns the recorded
   * operation (no second external effect can ever be created for one
   * instruction through this surface — the at-most-one-attempt discipline
   * of INV-12-2 is inherited structurally).
   *
   * Guards: the adapter must exist and be ACTIVE ("DEGRADED adapters accept
   * no new operations").
   *
   * Evidence: RAIL_OP_AUTHORIZED "(instruction link, payload hash,
   * idempotency key)".
   *
   * Source: rails-adapters-reconciliation.md lines 33-40, 63-69; README.md
   * §3 GC-3 lines 51-55; clearing-netting-settlement.md §4 lines 224-233,
   * 254-257.
   */
  authorizeOperation(input: {
    readonly instructionId: string;
    readonly adapterId: string;
    readonly payload: unknown;
  }): RailsCommandResult<RailOperationRecord> {
    if (typeof input.instructionId !== 'string' || input.instructionId.length === 0) {
      return {
        ok: false,
        reasonCode: 'PAYLOAD_MALFORMED',
        detail: 'instructionId must be a non-empty string (the GC-3 authorization link)',
      };
    }
    let payload: RailOperationPayload;
    try {
      payload = validateRailOperationPayload(input.payload);
    } catch (error) {
      return {
        ok: false,
        reasonCode: 'PAYLOAD_MALFORMED',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (payload.instructionId !== input.instructionId) {
      return {
        ok: false,
        reasonCode: 'PAYLOAD_MALFORMED',
        detail: 'payload.instructionId must equal the command instructionId (the GC-3 authorization link)',
      };
    }
    const operationId = deriveProtocolId('rail-operation', input.instructionId);
    const idempotencyKey = deriveIdempotencyKey('rail.submit', input.instructionId);
    return this.store.transaction(() => {
      const existing = this.store.getOperation(operationId);
      if (existing !== undefined) {
        return { ok: true, value: existing };
      }
      const adapter = this.store.getAdapter(input.adapterId);
      if (adapter === undefined) {
        return {
          ok: false,
          reasonCode: 'ADAPTER_NOT_FOUND',
          detail: `adapter ${input.adapterId} is not registered`,
        };
      }
      if (adapter.status !== 'ACTIVE') {
        return {
          ok: false,
          reasonCode: 'ADAPTER_NOT_ACTIVE',
          detail: `adapter ${input.adapterId} is ${adapter.status}; DEGRADED adapters accept no new operations`,
        };
      }
      const at = this.now();
      const payloadHash = hashRailPayload(payload);
      const record: RailOperationRecord = {
        operationId,
        instructionId: input.instructionId,
        adapterId: input.adapterId,
        status: 'AUTHORIZED',
        payload,
        payloadHash,
        idempotencyKey,
        railReferences: [],
        authorizedAt: at,
        updatedAt: at,
      };
      this.store.insertOperation(record);
      this.emit({
        what: {
          operationType: 'RAIL_OP_AUTHORIZED',
          subjectIds: [operationId, input.instructionId, input.adapterId],
        },
        when: at,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: { result: 'AUTHORIZED' },
        proof: { hashes: [payloadHash, idempotencyKey], sequenceNumbers: [at.sequence] },
      });
      return { ok: true, value: record };
    });
  }

  /**
   * Submit one AUTHORIZED operation through the adapter connection — the
   * ONLY external-effect execution path (INV-13-1 boundary exclusivity):
   *   1. GC-2 machine check: the operation MUST be AUTHORIZED. An
   *      operation in UNKNOWN — or SUBMITTED/PENDING/terminal — is
   *      REFUSED with a deterministic reason. There is no re-submission
   *      path anywhere in this surface.
   *   2. The adapter must be ACTIVE (DEGRADED accepts no new operations).
   *   3. AUTHORIZED→SUBMITTED: "request handed to the external rail"
   *      (RAIL_OP_SUBMITTED evidence, payload hash recorded at submission —
   *      INV-13-2).
   *   4. The adapter's transmission outcome maps — through the pure
   *      INV-13-4 no-guessing mapping — to exactly one submission report
   *      class, and the operation advances:
   *        ACCEPTED → PENDING ("rail accepted but outcome not yet known")
   *        REJECTED → FAILED (adapter-local/rail rejection, reason code,
   *                   before any external effect)
   *        UNKNOWN  → UNKNOWN + automatic reconciliation case (INV-14-1)
   *   5. RAIL_OP_REPORTED evidence with the submission report class, rail
   *      references, and payload proof.
   *
   * The transmission runs inside the command transaction; the simulated
   * rail's own ledger is external to the protocol transaction (the outside
   * world does not roll back), which is exactly why INV-13-3's
   * idempotency-key collapse exists: a retried command re-transmits the
   * same key and the rail collapses the duplicate.
   *
   * Source: rails-adapters-reconciliation.md lines 33-46 (state machine),
   * 56-72 (INV-13-1/2/3/4), 74-87 (failure + UNKNOWN semantics), 89-95
   * (evidence); README.md §3 GC-2/GC-3.
   */
  submitRailOperation(
    operationId: string,
    connection: RailAdapterConnection,
  ): RailsCommandResult<SubmitRailOperationOutcome> {
    return this.store.transaction(() => {
      const operation = this.store.getOperation(operationId);
      if (operation === undefined) {
        return {
          ok: false,
          reasonCode: 'OPERATION_NOT_FOUND',
          detail: `operation ${operationId} does not exist`,
        };
      }
      if (operation.status !== 'AUTHORIZED') {
        // THE GC-2 machine check: UNKNOWN (and every non-AUTHORIZED
        // status) is refused — re-submission is impossible by construction.
        const gc2 =
          operation.status === 'UNKNOWN'
            ? ' UNKNOWN is durable; the only exit is reconciliation (GC-2) — re-submission is refused'
            : '';
        return {
          ok: false,
          reasonCode: 'OPERATION_NOT_AUTHORIZED',
          detail: `operation ${operationId} is ${operation.status}; submission requires AUTHORIZED.${gc2}`,
        };
      }
      const adapter = this.store.getAdapter(operation.adapterId);
      if (adapter === undefined) {
        return {
          ok: false,
          reasonCode: 'ADAPTER_NOT_FOUND',
          detail: `adapter ${operation.adapterId} is not registered`,
        };
      }
      if (adapter.status !== 'ACTIVE') {
        return {
          ok: false,
          reasonCode: 'ADAPTER_NOT_ACTIVE',
          detail: `adapter ${operation.adapterId} is ${adapter.status}; DEGRADED adapters accept no new operations`,
        };
      }
      const recordedHash = hashRailPayload(operation.payload);
      if (recordedHash !== operation.payloadHash) {
        return {
          ok: false,
          reasonCode: 'PAYLOAD_HASH_MISMATCH',
          detail: 'stored payload hash does not match the stored payload (INV-13-2 tamper check)',
        };
      }

      // Transmission (in-transaction; see method doc for the discipline).
      const transmitOutcome = connection.transmit({
        idempotencyKey: operation.idempotencyKey,
        payload: operation.payload,
        payloadHash: operation.payloadHash,
      });

      // AUTHORIZED→SUBMITTED: the handoff, durably recorded + evidenced.
      const submittedAt = this.now();
      const railReferences =
        transmitOutcome.class === 'ACCEPTED' ? [...transmitOutcome.railReferences] : [];
      const submitted = this.transitionOperation(operation, 'SUBMITTED', submittedAt, {
        railReferences,
      });
      this.emit({
        what: {
          operationType: 'RAIL_OP_SUBMITTED',
          subjectIds: [operationId, operation.adapterId, ...railReferences],
        },
        when: submittedAt,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: { result: 'SUBMITTED' },
        proof: {
          hashes: [operation.payloadHash, operation.idempotencyKey],
          sequenceNumbers: [submittedAt.sequence],
        },
      });

      // The INV-13-4 mapping: every submission maps to exactly one report
      // class; the operation advances to the mapped state.
      const reportClass = submissionReportClass(transmitOutcome);
      const target: RailOperationRecord['status'] =
        reportClass === 'PENDING' ? 'PENDING' : reportClass === 'FAILED' ? 'FAILED' : 'UNKNOWN';
      const reasonCode =
        transmitOutcome.class === 'REJECTED' || transmitOutcome.class === 'UNKNOWN'
          ? transmitOutcome.reasonCode
          : undefined;
      const reportedAt = this.now();
      const resolved = this.transitionOperation(submitted, target, reportedAt, {
        ...(reasonCode === undefined ? {} : { reasonCode }),
      });
      this.emit({
        what: {
          operationType: 'RAIL_OP_REPORTED',
          subjectIds: [operationId, ...resolved.railReferences],
        },
        when: reportedAt,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: { result: target, ...(reasonCode === undefined ? {} : { reasonCode }) },
        proof: { hashes: [operation.payloadHash], sequenceNumbers: [reportedAt.sequence] },
      });

      if (target === 'UNKNOWN') {
        // INV-14-1: the UNKNOWN landing automatically opens exactly one
        // reconciliation case, atomically with the UNKNOWN transition.
        this.caseOpener.openCaseForUnknownOperation(resolved);
      }

      return {
        ok: true,
        value: { operation: resolved, submissionReportClass: reportClass, transmitOutcome },
      };
    });
  }

  /**
   * Ingest one rail result report (from the adapter connection's
   * fetchReport): the report is RECORDED immutably, and state advances only
   * through THIS command surface (delta 1).
   *
   *   - INV-13-2: the report's payload hash is re-checked against the
   *     recorded hash; a mismatch REJECTS the report (it is not a report of
   *     this operation).
   *   - Reports for terminal operations (and for operations whose current
   *     state already equals the report class) are recorded (immutable
   *     evidence) with NO state change — terminal states have no outgoing
   *     edges, and same-state reports carry no new transition.
   *   - Reports for SUBMITTED/PENDING operations advance per the frozen
   *     table: CONFIRMED→CONFIRMED, FAILED→FAILED, UNKNOWN→UNKNOWN (+
   *     automatic case, INV-14-1), PENDING→PENDING.
   *   - "DEGRADED adapters ... in-flight operations continue to report
   *     results": report ingestion performs no adapter-status check.
   *
   * Evidence: RAIL_OP_REPORTED "(outcome class, rail references, payload
   * proof)".
   *
   * Source: rails-adapters-reconciliation.md lines 47-48, 63-65, 31-32,
   * 89-95; rtn-plan-rulings.md delta 1 ("reports are returned/recorded and
   * state advances only through the authority's command surface").
   */
  recordReport(
    operationId: string,
    report: RailReportEnvelope,
  ): RailsCommandResult<{
    readonly operation: RailOperationRecord;
    readonly report: RailResultReportRecord;
  }> {
    return this.store.transaction(() => {
      const operation = this.store.getOperation(operationId);
      if (operation === undefined) {
        return {
          ok: false,
          reasonCode: 'OPERATION_NOT_FOUND',
          detail: `operation ${operationId} does not exist`,
        };
      }
      if (report.payloadHash !== operation.payloadHash) {
        return {
          ok: false,
          reasonCode: 'PAYLOAD_HASH_MISMATCH',
          detail:
            'report payload hash does not match the recorded payload hash (INV-13-2 re-check on every report)',
        };
      }
      const priorReports = this.store.listReports(operationId);
      const ordinal = priorReports.length + 1;
      const reportId = deriveProtocolId('rail-report', operationId, ordinal);
      const recordedAt = this.now();
      const reportRecord: RailResultReportRecord = {
        reportId,
        operationId,
        ordinal,
        outcomeClass: report.outcomeClass,
        ...(report.reasonCode === undefined ? {} : { reasonCode: report.reasonCode }),
        railReferences: [...report.railReferences],
        payloadHash: report.payloadHash,
        reportedAtWallMs: report.reportedAtWallMs,
        recordedAt,
      };
      this.store.insertReport(reportRecord);

      const targetStatus: RailOperationRecord['status'] = report.outcomeClass;
      const legal = RAIL_OPERATION_TRANSITIONS[operation.status].includes(targetStatus);
      let updated: RailOperationRecord = operation;
      if (legal) {
        const at = this.now();
        const mergedReferences = [
          ...operation.railReferences,
          ...report.railReferences.filter((ref) => !operation.railReferences.includes(ref)),
        ];
        updated = this.transitionOperation(operation, targetStatus, at, {
          ...(report.reasonCode === undefined ? {} : { reasonCode: report.reasonCode }),
          railReferences: mergedReferences,
        });
      }
      this.emit({
        what: {
          operationType: 'RAIL_OP_REPORTED',
          subjectIds: [operationId, ...report.railReferences],
        },
        when: recordedAt,
        authority: RAIL_ADAPTER_AUTHORITY_ID,
        outcome: {
          result: report.outcomeClass,
          ...(report.reasonCode === undefined ? {} : { reasonCode: report.reasonCode }),
        },
        proof: { hashes: [report.payloadHash], sequenceNumbers: [recordedAt.sequence, ordinal] },
      });
      if (legal && targetStatus === 'UNKNOWN') {
        // INV-14-1: automatic case, atomic with the UNKNOWN landing.
        this.caseOpener.openCaseForUnknownOperation(updated);
      }
      return { ok: true, value: { operation: updated, report: reportRecord } };
    });
  }

  getOperation(operationId: string): RailOperationRecord | undefined {
    return this.store.getOperation(operationId);
  }

  getOperationByIdempotencyKey(idempotencyKey: string): RailOperationRecord | undefined {
    return this.store.getOperationByIdempotencyKey(idempotencyKey);
  }

  listOperations(): RailOperationRecord[] {
    return this.store.listOperations();
  }

  listReports(operationId: string): RailResultReportRecord[] {
    return this.store.listReports(operationId);
  }
}
