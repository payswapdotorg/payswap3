/**
 * RTN-009 — Settlement and Finality Authority: the owned in-surface A13/A14
 * test double.
 *
 * The wave's evidence discipline (spec/protocol-runtime-work-orders/
 * README.md): where a merged sibling's real authority cannot run in the bun
 * suite (the RTN-004 RailsStore requires node:sqlite, which Bun does not
 * implement), the item tests against an owned in-surface test double of
 * the port — and the REAL composition is proven in the node harness
 * (scripts/test_protocol_netting_settlement.mjs), exactly the split
 * RTN-004 itself used for its evidence port and RTN-008 used for the
 * rails composition.
 *
 * This double is FAITHFUL to the A13/A14 command semantics the Settlement
 * Authority composes with (the frozen machines, the INV-13-4 no-guessing
 * mapping, the INV-14-1 exactly-one auto-case, the INV-14-2 exactly-once
 * resolution, the A14 recovery directives) — re-implemented over the REAL
 * SimulatedRail adapter (rails/adapters.ts — pure, bun-loadable), so the
 * end-to-end journey tests run against simulated rails (the work order's
 * required evidence) with only the two SQLite-backed authorities doubled.
 *
 * Spec sources mirrored (binding):
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *   lines 33-46 (the RailOperation machine), lines 70-72 (INV-13-4),
 *   lines 74-87 (failure and UNKNOWN semantics); §2 Area 14 lines 119-131
 *   (the case model), lines 149-157 (INV-14-1/2/3), lines 171-179 (the
 *   recovery paths).
 */

import { deriveProtocolId, deriveIdempotencyKey } from '../kernel/identity.ts';
import type { RailsCommandResult } from '../rails/index.ts';
import type {
  RailOperationRecord,
  RailOperationStatus,
  ReconciliationCaseRecord,
  ReconciliationCaseStatus,
  RecoveryDirective,
  ResolutionProof,
  CaseTerminalResolution,
} from '../rails/index.ts';
import type { SubmitRailOperationOutcome } from '../rails/index.ts';
import { submissionReportClass } from '../rails/adapters.ts';
import type {
  RailAdapterConnection,
  RailTransmissionRequest,
  RailReportEnvelope,
} from '../rails/adapters.ts';
import { validateRailOperationPayload, hashRailPayload } from '../rails/payload.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { SettlementRailsPort } from './ports.ts';
import type { SettlementSubject } from './types.ts';

/**
 * The in-memory A13/A14 double: the SettlementRailsPort plus the adapter
 * registry and the case lifecycle the journey tests drive. Every mutation
 * follows the frozen machines; the auto-case and exactly-once resolution
 * mirror the merged authorities' guards.
 */
export class InMemoryRailsDouble implements SettlementRailsPort {
  private readonly adapters = new Map<string, { adapterId: string; status: string }>();
  private readonly operations = new Map<string, RailOperationRecord>();
  private readonly cases = new Map<string, ReconciliationCaseRecord>();
  private readonly casesByOperation = new Map<string, string>();
  private sequence = 0;
  private readonly wallClock: () => number;

  constructor(wallClock: () => number = () => 0) {
    this.wallClock = wallClock;
  }

  private now(): ProtocolTime {
    return protocolTime(this.sequence, this.wallClock());
  }

  private consume(): ProtocolTime {
    const at = this.now();
    this.sequence += 1;
    return at;
  }

  // --- Adapter registry --------------------------------------------------

  registerAndActivateAdapter(railFamily: string, name: string): string {
    const adapterId = deriveProtocolId('rail-adapter', railFamily, name);
    this.adapters.set(adapterId, { adapterId, status: 'ACTIVE' });
    return adapterId;
  }

  // --- The SettlementRailsPort (the A13 commands + the A14 query) ---------

  authorizeOperation(input: {
    readonly instructionId: string;
    readonly adapterId: string;
    readonly payload: unknown;
  }): RailsCommandResult<RailOperationRecord> {
    let payload;
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
    const existing = this.operations.get(operationId);
    if (existing !== undefined) {
      return { ok: true, value: existing };
    }
    const adapter = this.adapters.get(input.adapterId);
    if (adapter === undefined) {
      return { ok: false, reasonCode: 'ADAPTER_NOT_FOUND', detail: `adapter ${input.adapterId} is not registered` };
    }
    if (adapter.status !== 'ACTIVE') {
      return {
        ok: false,
        reasonCode: 'ADAPTER_NOT_ACTIVE',
        detail: `adapter ${input.adapterId} is ${adapter.status}`,
      };
    }
    const at = this.consume();
    const record: RailOperationRecord = {
      operationId,
      instructionId: input.instructionId,
      adapterId: input.adapterId,
      status: 'AUTHORIZED',
      payload,
      payloadHash: hashRailPayload(payload),
      idempotencyKey,
      railReferences: [],
      authorizedAt: at,
      updatedAt: at,
    };
    this.operations.set(operationId, record);
    return { ok: true, value: record };
  }

  submitRailOperation(
    operationId: string,
    connection: RailAdapterConnection,
  ): RailsCommandResult<SubmitRailOperationOutcome> {
    const operation = this.operations.get(operationId);
    if (operation === undefined) {
      return { ok: false, reasonCode: 'OPERATION_NOT_FOUND', detail: `operation ${operationId} does not exist` };
    }
    if (operation.status !== 'AUTHORIZED') {
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
    const request: RailTransmissionRequest = {
      idempotencyKey: operation.idempotencyKey,
      payload: operation.payload,
      payloadHash: operation.payloadHash,
    };
    const transmitOutcome = connection.transmit(request);
    const railReferences =
      transmitOutcome.class === 'ACCEPTED' ? [...transmitOutcome.railReferences] : [];
    const submitted: RailOperationRecord = {
      ...operation,
      status: 'SUBMITTED',
      railReferences,
      updatedAt: this.consume(),
    };
    this.operations.set(operationId, submitted);
    const reportClass = submissionReportClass(transmitOutcome);
    const target: RailOperationStatus =
      reportClass === 'PENDING' ? 'PENDING' : reportClass === 'FAILED' ? 'FAILED' : 'UNKNOWN';
    const reasonCode =
      transmitOutcome.class === 'REJECTED' || transmitOutcome.class === 'UNKNOWN'
        ? transmitOutcome.reasonCode
        : undefined;
    const resolved: RailOperationRecord = {
      ...submitted,
      status: target,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      updatedAt: this.consume(),
    };
    this.operations.set(operationId, resolved);
    if (target === 'UNKNOWN') {
      this.openCaseForUnknownOperation(resolved);
    }
    return {
      ok: true,
      value: { operation: resolved, submissionReportClass: reportClass, transmitOutcome },
    };
  }

  recordReport(
    operationId: string,
    report: RailReportEnvelope,
  ): RailsCommandResult<{ readonly operation: RailOperationRecord }> {
    const operation = this.operations.get(operationId);
    if (operation === undefined) {
      return { ok: false, reasonCode: 'OPERATION_NOT_FOUND', detail: `operation ${operationId} does not exist` };
    }
    if (report.payloadHash !== operation.payloadHash) {
      return {
        ok: false,
        reasonCode: 'PAYLOAD_HASH_MISMATCH',
        detail: 'report payload hash does not match the recorded payload hash (INV-13-2)',
      };
    }
    const legal = this.transitionTargets(operation.status).includes(report.outcomeClass);
    let updated = operation;
    if (legal) {
      updated = {
        ...operation,
        status: report.outcomeClass,
        ...(report.reasonCode === undefined ? {} : { reasonCode: report.reasonCode }),
        railReferences: [...operation.railReferences, ...report.railReferences],
        updatedAt: this.consume(),
      };
      this.operations.set(operationId, updated);
    }
    if (legal && report.outcomeClass === 'UNKNOWN') {
      this.openCaseForUnknownOperation(updated);
    }
    return { ok: true, value: { operation: updated } };
  }

  getOperation(operationId: string): RailOperationRecord | undefined {
    return this.operations.get(operationId);
  }

  caseForOperation(operationId: string): ReconciliationCaseRecord | undefined {
    const caseId = this.casesByOperation.get(operationId);
    return caseId === undefined ? undefined : this.cases.get(caseId);
  }

  // --- The A14 case lifecycle (the journey driver) -------------------------

  /** INV-14-1: every UNKNOWN operation opens exactly one case, atomically. */
  openCaseForUnknownOperation(operation: RailOperationRecord): ReconciliationCaseRecord {
    const existing = this.casesByOperation.get(operation.operationId);
    if (existing !== undefined) {
      return this.cases.get(existing) as ReconciliationCaseRecord;
    }
    const caseId = deriveProtocolId('reconciliation-case', operation.operationId);
    const record: ReconciliationCaseRecord = {
      caseId,
      status: 'OPEN',
      origin: {
        kind: 'UNKNOWN_OPERATION',
        operationId: operation.operationId,
        instructionId: operation.instructionId,
      },
      openedAt: this.consume(),
    };
    this.cases.set(caseId, record);
    this.casesByOperation.set(operation.operationId, caseId);
    return record;
  }

  investigateCase(caseId: string): RailsCommandResult<ReconciliationCaseRecord> {
    const existing = this.cases.get(caseId);
    if (existing === undefined) {
      return { ok: false, reasonCode: 'CASE_NOT_FOUND', detail: `case ${caseId} does not exist` };
    }
    if (existing.status !== 'OPEN') {
      return {
        ok: false,
        reasonCode: 'CASE_NOT_OPEN',
        detail: `case ${caseId} is ${existing.status}`,
      };
    }
    const updated: ReconciliationCaseRecord = { ...existing, status: 'INVESTIGATING' };
    this.cases.set(caseId, updated);
    return { ok: true, value: updated };
  }

  /**
   * INV-14-2: the terminal resolution transitions the originating
   * operation exactly once; duplicate resolutions are rejected by case
   * id. RESOLVED_CONFIRMED / RESOLVED_FAILED produce the area-12 recovery
   * directives (the safe-resume interface).
   */
  resolveCase(
    caseId: string,
    input:
      | { readonly resolution: 'RESOLVED_CONFIRMED'; readonly proof: ResolutionProof }
      | { readonly resolution: 'RESOLVED_FAILED'; readonly proof: ResolutionProof },
  ): RailsCommandResult<{
    readonly case: ReconciliationCaseRecord;
    readonly operation: RailOperationRecord;
    readonly recovery: RecoveryDirective;
  }> {
    const existing = this.cases.get(caseId);
    if (existing === undefined) {
      return { ok: false, reasonCode: 'CASE_NOT_FOUND', detail: `case ${caseId} does not exist` };
    }
    if (
      existing.status === 'MATCHED' ||
      existing.status === 'RESOLVED_CONFIRMED' ||
      existing.status === 'RESOLVED_FAILED' ||
      existing.status === 'RESOLVED_ADJUSTED'
    ) {
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
        detail: `case ${caseId} is ${existing.status}; terminal resolution requires INVESTIGATING`,
      };
    }
    if (existing.origin.kind !== 'UNKNOWN_OPERATION') {
      return {
        ok: false,
        reasonCode: 'RESOLUTION_NOT_APPLICABLE',
        detail: 'the double resolves UNKNOWN-operation cases only',
      };
    }
    const operationId = existing.origin.operationId;
    const instructionId = existing.origin.instructionId;
    const operation = this.operations.get(operationId);
    if (operation === undefined) {
      return { ok: false, reasonCode: 'OPERATION_NOT_FOUND', detail: `operation ${operationId} does not exist` };
    }
    if (operation.status !== 'UNKNOWN') {
      return {
        ok: false,
        reasonCode: 'ILLEGAL_TRANSITION',
        detail: `origin operation ${operationId} is ${operation.status}; INV-14-2 resolves UNKNOWN exactly once`,
      };
    }
    const operationOutcome: 'CONFIRMED' | 'FAILED' =
      input.resolution === 'RESOLVED_CONFIRMED' ? 'CONFIRMED' : 'FAILED';
    const at = this.consume();
    const transitioned: RailOperationRecord = { ...operation, status: operationOutcome, updatedAt: at };
    this.operations.set(operationId, transitioned);
    const recovery: RecoveryDirective =
      input.resolution === 'RESOLVED_CONFIRMED'
        ? {
            feed: 'AREA_12_FINALITY_ADVANCE',
            instructionId,
            operationId,
            attemptOutcome: 'CONFIRMED',
          }
        : {
            feed: 'AREA_12_NEW_INSTRUCTION',
            instructionId,
            operationId,
            note: 'RECOVERY_IS_A_NEW_INSTRUCTION_NOT_A_RETRY',
          };
    const resolved: ReconciliationCaseRecord = {
      ...existing,
      status: input.resolution,
      resolvedAt: at,
      resolution: input.resolution as CaseTerminalResolution,
      recovery,
    };
    this.cases.set(caseId, resolved);
    return { ok: true, value: { case: resolved, operation: transitioned, recovery } };
  }

  private transitionTargets(status: RailOperationStatus): readonly RailOperationStatus[] {
    switch (status) {
      case 'AUTHORIZED':
        return ['SUBMITTED'];
      case 'SUBMITTED':
        return ['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN'];
      case 'PENDING':
        return ['CONFIRMED', 'FAILED', 'UNKNOWN'];
      case 'UNKNOWN':
        return ['CONFIRMED', 'FAILED'];
      default:
        return [];
    }
  }
}
