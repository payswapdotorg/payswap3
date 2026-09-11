/**
 * RTN-004 — Rails: the A13/A14 authority-state store.
 *
 * Spec sources (binding):
 *   rtn-plan-rulings.md Q1 / delta 1: "The rails/ surface implements the
 *    A13/A14 state machines as authority state under the RTN-001
 *    per-domain persistence convention" — the state machines live HERE, on
 *    the protocol-owned store; the adapter component (adapters.ts) hosts no
 *    authority and never touches this store.
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *    lines 50-54 (Rail Adapter Authority "owns adapter registry and
 *    operation lifecycle") and §2 Area 14 lines 143-146 (Reconciliation
 *    Authority "owns case and cycle state").
 *   spec/deployment/topology.md, "Runtime ownership of protocol
 *    authorities": "There is exactly one protocol-command admission point
 *    (protocol-gateway) and exactly one authoritative-state writer
 *    (transition-runtime)" — the authorities' command surfaces (authority.ts,
 *    reconciliation.ts) are the rails-domain realization of that
 *    single-writer discipline; every state mutation flows through a command,
 *    every command runs in exactly one store transaction.
 *
 * Layer position: this module is the persistence layer ONLY — it maps
 * records to rows and rows to records, mints the domain's protocol-time
 * sequence positions, and owns the transaction discipline. It makes NO
 * domain decisions: illegal transitions are rejected by the authority
 * command guards (plus the SQL CHECK constraints as the storage-layer
 * backstop).
 *
 * The two spec-mandated cross-authority write paths (both reach the store
 * ONLY through authority commands):
 *   - rail_operations status UNKNOWN→terminal: written exclusively by the
 *     Reconciliation Authority's case resolution (INV-14-2) — see
 *     resolveOperationFromUnknown, which validates the UNKNOWN source
 *     state.
 *   - reconciliation_cases rows for UNKNOWN operations: written
 *     exclusively by the auto-case opener (INV-14-1), guarded by the
 *     partial UNIQUE index reconciliation_cases_one_per_operation.
 */

import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import type {
  ExternalStatementRecord,
  RailAdapterRecord,
  RailOperationPayload,
  RailOperationRecord,
  RailResultReportRecord,
  ReconciliationAdjustment,
  ReconciliationCaseOrigin,
  ReconciliationCaseRecord,
  ReconciliationCycleRecord,
  ReconciliationSourceRecord,
  RecoveryDirective,
  CaseTerminalResolution,
} from './types.ts';

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function asOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function asInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`rails store: expected a safe integer, got ${String(value)}`);
  }
  return number;
}

function asTime(seq: unknown, wallMs: unknown): ProtocolTime {
  return protocolTime(asInteger(seq), asInteger(wallMs));
}

function parseJsonArray(value: unknown): readonly string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const parsed = JSON.parse(String(value)) as unknown;
  return Array.isArray(parsed) ? (parsed as readonly string[]) : [];
}

function parsePayload(value: unknown): RailOperationPayload {
  const parsed = JSON.parse(String(value)) as Row;
  const rawMoney = (parsed['money'] ?? {}) as Row;
  const record: RailOperationPayload = {
    instructionId: asString(parsed['instructionId']),
    money: money(
      asString(rawMoney['currency']),
      asInteger(rawMoney['amountMinor']),
      asInteger(rawMoney['scale']),
    ),
    beneficiary: asString(parsed['beneficiary']),
    ...(parsed['memo'] === undefined || parsed['memo'] === null
      ? {}
      : { memo: asString(parsed['memo']) }),
  };
  return record;
}

function parseOrigin(value: unknown): ReconciliationCaseOrigin {
  const parsed = JSON.parse(String(value)) as Row;
  const kind = asString(parsed['kind']);
  if (kind === 'UNKNOWN_OPERATION') {
    return {
      kind: 'UNKNOWN_OPERATION',
      operationId: asString(parsed['operationId']),
      instructionId: asString(parsed['instructionId']),
    };
  }
  return {
    kind: 'CYCLE_DISCREPANCY',
    cycleId: asString(parsed['cycleId']),
    discrepancyKind: asString(parsed['discrepancyKind']),
    ...(parsed['statementRef'] === undefined || parsed['statementRef'] === null
      ? {}
      : { statementRef: asString(parsed['statementRef']) }),
    ...(parsed['protocolRef'] === undefined || parsed['protocolRef'] === null
      ? {}
      : { protocolRef: asString(parsed['protocolRef']) }),
  };
}

function parseStatements(value: unknown): ExternalStatementRecord[] {
  if (value === null || value === undefined || String(value) === '[]') {
    return [];
  }
  const parsed = JSON.parse(String(value)) as Row[];
  return parsed.map((row) => ({
    sourceId: asString(row['sourceId']),
    sequence: asInteger(row['sequence']),
    railReference: asString(row['railReference']),
    ...(row['operationId'] === undefined || row['operationId'] === null
      ? {}
      : { operationId: asString(row['operationId']) }),
    ...(row['idempotencyKey'] === undefined || row['idempotencyKey'] === null
      ? {}
      : { idempotencyKey: asString(row['idempotencyKey']) }),
    outcomeClass: asString(row['outcomeClass']) as ExternalStatementRecord['outcomeClass'],
    amountMinor: asInteger(row['amountMinor']),
    currency: asString(row['currency']),
    assertedAtWallMs: asInteger(row['assertedAtWallMs']),
  }));
}

function parseOperationSnapshot(value: unknown): RailOperationRecord[] {
  if (value === null || value === undefined || String(value) === '[]') {
    return [];
  }
  const parsed = JSON.parse(String(value)) as Row[];
  return parsed.map(rowToOperation);
}

function rowToOperation(row: Row): RailOperationRecord {
  return {
    operationId: asString(row['operation_id']),
    instructionId: asString(row['instruction_id']),
    adapterId: asString(row['adapter_id']),
    status: asString(row['status']) as RailOperationRecord['status'],
    payload: parsePayload(row['payload_json']),
    payloadHash: asString(row['payload_hash']),
    idempotencyKey: asString(row['idempotency_key']),
    ...(row['reason_code'] === null || row['reason_code'] === undefined
      ? {}
      : { reasonCode: asString(row['reason_code']) }),
    railReferences: parseJsonArray(row['rail_refs_json']),
    authorizedAt: asTime(row['created_seq'], row['created_wall_ms']),
    updatedAt: asTime(row['updated_seq'], row['updated_wall_ms']),
  };
}

function rowToAdapter(row: Row): RailAdapterRecord {
  return {
    adapterId: asString(row['adapter_id']),
    railFamily: asString(row['rail_family']),
    name: asString(row['name']),
    status: asString(row['status']) as RailAdapterRecord['status'],
    ...(row['reason_code'] === null || row['reason_code'] === undefined
      ? {}
      : { reasonCode: asString(row['reason_code']) }),
    createdAt: asTime(row['created_seq'], row['created_wall_ms']),
    updatedAt: asTime(row['updated_seq'], row['updated_wall_ms']),
  };
}

function rowToReport(row: Row): RailResultReportRecord {
  return {
    reportId: asString(row['report_id']),
    operationId: asString(row['operation_id']),
    ordinal: asInteger(row['ordinal']),
    outcomeClass: asString(row['outcome_class']) as RailResultReportRecord['outcomeClass'],
    ...(row['reason_code'] === null || row['reason_code'] === undefined
      ? {}
      : { reasonCode: asString(row['reason_code']) }),
    railReferences: parseJsonArray(row['rail_refs_json']),
    payloadHash: asString(row['payload_hash']),
    reportedAtWallMs: asInteger(row['reported_wall_ms']),
    recordedAt: asTime(row['recorded_seq'], row['recorded_wall_ms']),
  };
}

function rowToCase(row: Row): ReconciliationCaseRecord {
  const resolution = asOptionalString(row['resolution_json']);
  const recovery = asOptionalString(row['recovery_json']);
  return {
    caseId: asString(row['case_id']),
    status: asString(row['status']) as ReconciliationCaseRecord['status'],
    origin: parseOrigin(row['origin_detail_json']),
    openedAt: asTime(row['created_seq'], row['created_wall_ms']),
    ...(resolution === undefined
      ? {}
      : { resolvedAt: asTime(row['updated_seq'], row['updated_wall_ms']) }),
    ...(resolution === undefined
      ? {}
      : { resolution: JSON.parse(resolution) as CaseTerminalResolution }),
    ...(recovery === undefined ? {} : { recovery: JSON.parse(recovery) as RecoveryDirective }),
  };
}

function rowToCycle(row: Row): ReconciliationCycleRecord {
  const closed = asString(row['status']) === 'CLOSED';
  return {
    cycleId: asString(row['cycle_id']),
    status: asString(row['status']) as ReconciliationCycleRecord['status'],
    windowStartWallMs: asInteger(row['window_start_wall_ms']),
    windowEndWallMs: asInteger(row['window_end_wall_ms']),
    ruleVersion: asInteger(row['rule_version']),
    sourceIds: parseJsonArray(row['source_ids_json']),
    statementCount: asInteger(row['statement_count']),
    matchedCount: asInteger(row['matched_count']),
    discrepancyCount: asInteger(row['discrepancy_count']),
    openCaseCount: asInteger(row['open_case_count']),
    openedAt: asTime(row['created_seq'], row['created_wall_ms']),
    ...(closed
      ? { closedAt: asTime(row['updated_seq'], row['updated_wall_ms']) }
      : {}),
  };
}

function rowToSource(row: Row): ReconciliationSourceRecord {
  return {
    sourceId: asString(row['source_id']),
    kind: asString(row['kind']),
    description: asString(row['description']),
    lastSequence: asInteger(row['last_sequence']),
    registeredAt: asTime(row['created_seq'], row['created_wall_ms']),
  };
}

function rowToAdjustment(row: Row): ReconciliationAdjustment {
  return {
    adjustmentId: asString(row['adjustment_id']),
    caseId: asString(row['case_id']),
    ...(row['operation_id'] === null || row['operation_id'] === undefined
      ? {}
      : { operationId: asString(row['operation_id']) }),
    links: parseJsonArray(row['links_json']),
    description: asString(row['description']),
    createdAt: asTime(row['created_seq'], row['created_wall_ms']),
  };
}

/**
 * The rails-domain authority-state store: record↔row mapping, the domain's
 * protocol-time sequence mint, and the command-transaction discipline.
 *
 * Construction: wrap a database opened through the per-domain convention —
 * `new RailsStore(openRailsStore(options))`. The migrations are applied by
 * openRailsStore before this constructor runs.
 *
 * Source: rtn-plan-rulings.md Q1/delta 1; the RTN-001 per-domain
 * persistence convention (kernel persistence.ts is the reference pattern).
 */
export class RailsStore {
  private readonly db: DurableDatabase;
  private txDepth = 0;
  private readonly statements = new Map<string, StatementSync>();

  constructor(db: DurableDatabase) {
    this.db = db;
  }

  /** The underlying database handle (read-only access for diagnostics). */
  get database(): DurableDatabase {
    return this.db;
  }

  /** The underlying sqlite connection (diagnostics only). */
  get sqlite(): DatabaseSync {
    return this.db.sqlite;
  }

  close(): void {
    this.db.close();
  }

  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /**
   * Run one command transaction: every authority command executes inside
   * exactly one BEGIN IMMEDIATE … COMMIT, so a command's writes (state
   * rows + the GC-5 evidence submission, which the authority performs
   * inside the transaction) commit atomically — a failure anywhere rolls
   * the whole command back ("an operation is not committed until its
   * record is written. A failed write fails the operation").
   *
   * Nested calls join the outermost transaction (depth counter; SQLite
   * cannot nest BEGIN).
   *
   * Source: spec/architecture/v0.1/evidence-risk-compliance.md lines 62-64
   * (A15 synchronous write coupling); topology.md single-writer rule.
   */
  transaction<T>(fn: () => T): T {
    const outermost = this.txDepth === 0;
    if (outermost) {
      this.db.exec('BEGIN IMMEDIATE');
    }
    this.txDepth += 1;
    try {
      const result = fn();
      this.txDepth -= 1;
      if (outermost) {
        this.db.exec('COMMIT');
      }
      return result;
    } catch (error) {
      this.txDepth = 0;
      if (outermost) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // transaction already rolled back or connection closed
        }
      }
      throw error;
    }
  }

  /**
   * Mint the next protocol-time sequence position for the rails domain
   * (the A15 'when' slot's sequenced component). Must be called inside a
   * transaction; strictly monotonic, starts at 1.
   *
   * Source: evidence-risk-compliance.md line 28 ("protocol time
   * (sequenced)"); the per-domain persistence convention.
   */
  nextProtocolSequence(): number {
    const row = this.stmt(
      "SELECT next_value FROM rails_sequence WHERE name = 'protocol'",
    ).get() as Row | undefined;
    if (row === undefined) {
      throw new TypeError('rails store: rails_sequence row missing (migration not applied?)');
    }
    const current = asInteger(row['next_value']);
    this.stmt(
      "UPDATE rails_sequence SET next_value = ? WHERE name = 'protocol'",
    ).run(current + 1);
    return current;
  }

  // --- Area 13: adapter registry -------------------------------------------

  insertAdapter(record: RailAdapterRecord): void {
    this.stmt(
      `INSERT INTO rail_adapters (adapter_id, rail_family, name, status, reason_code,
         created_seq, created_wall_ms, updated_seq, updated_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.adapterId,
      record.railFamily,
      record.name,
      record.status,
      record.reasonCode ?? null,
      record.createdAt.sequence,
      record.createdAt.wallMs,
      record.updatedAt.sequence,
      record.updatedAt.wallMs,
    );
  }

  updateAdapter(record: RailAdapterRecord): void {
    this.stmt(
      `UPDATE rail_adapters SET status = ?, reason_code = ?,
         updated_seq = ?, updated_wall_ms = ? WHERE adapter_id = ?`,
    ).run(
      record.status,
      record.reasonCode ?? null,
      record.updatedAt.sequence,
      record.updatedAt.wallMs,
      record.adapterId,
    );
  }

  getAdapter(adapterId: string): RailAdapterRecord | undefined {
    const row = this.stmt('SELECT * FROM rail_adapters WHERE adapter_id = ?').get(adapterId) as
      | Row
      | undefined;
    return row === undefined ? undefined : rowToAdapter(row);
  }

  listAdapters(): RailAdapterRecord[] {
    const rows = this.stmt(
      'SELECT * FROM rail_adapters ORDER BY adapter_id',
    ).all() as Row[];
    return rows.map(rowToAdapter);
  }

  // --- Area 13: operation lifecycle ----------------------------------------

  insertOperation(record: RailOperationRecord): void {
    this.stmt(
      `INSERT INTO rail_operations (operation_id, instruction_id, adapter_id, status,
         reason_code, idempotency_key, payload_json, payload_hash, rail_refs_json,
         created_seq, created_wall_ms, updated_seq, updated_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.operationId,
      record.instructionId,
      record.adapterId,
      record.status,
      record.reasonCode ?? null,
      record.idempotencyKey,
      JSON.stringify(record.payload),
      record.payloadHash,
      JSON.stringify(record.railReferences),
      record.authorizedAt.sequence,
      record.authorizedAt.wallMs,
      record.updatedAt.sequence,
      record.updatedAt.wallMs,
    );
  }

  updateOperation(record: RailOperationRecord): void {
    this.stmt(
      `UPDATE rail_operations SET status = ?, reason_code = ?, rail_refs_json = ?,
         updated_seq = ?, updated_wall_ms = ? WHERE operation_id = ?`,
    ).run(
      record.status,
      record.reasonCode ?? null,
      JSON.stringify(record.railReferences),
      record.updatedAt.sequence,
      record.updatedAt.wallMs,
      record.operationId,
    );
  }

  /**
   * The INV-14-2 write path: transition an operation OUT of UNKNOWN to its
   * established true outcome. Validates the UNKNOWN source state and the
   * frozen transition table edge (UNKNOWN→CONFIRMED | FAILED) — the ONLY
   * exit from UNKNOWN (GC-2). Reached exclusively through the
   * Reconciliation Authority's case-resolution command.
   *
   * Source: rails-adapters-reconciliation.md lines 45-46 (UNKNOWN durable;
   * no re-submission), lines 152-154 (INV-14-2), README.md §3 GC-2.
   */
  resolveOperationFromUnknown(
    operationId: string,
    toStatus: 'CONFIRMED' | 'FAILED',
    reasonCode: string | undefined,
    at: ProtocolTime,
  ): RailOperationRecord {
    const existing = this.getOperation(operationId);
    if (existing === undefined) {
      throw new TypeError(
        `rails store: cannot resolve unknown operation — operation ${operationId} does not exist`,
      );
    }
    if (existing.status !== 'UNKNOWN') {
      throw new TypeError(
        `rails store: INV-14-2 exactly-once violation — operation ${operationId} is ${existing.status}, not UNKNOWN`,
      );
    }
    const resolved: RailOperationRecord = {
      ...existing,
      status: toStatus,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      updatedAt: at,
    };
    this.updateOperation(resolved);
    return resolved;
  }

  getOperation(operationId: string): RailOperationRecord | undefined {
    const row = this.stmt('SELECT * FROM rail_operations WHERE operation_id = ?').get(
      operationId,
    ) as Row | undefined;
    return row === undefined ? undefined : rowToOperation(row);
  }

  getOperationByIdempotencyKey(idempotencyKey: string): RailOperationRecord | undefined {
    const row = this.stmt('SELECT * FROM rail_operations WHERE idempotency_key = ?').get(
      idempotencyKey,
    ) as Row | undefined;
    return row === undefined ? undefined : rowToOperation(row);
  }

  listOperations(): RailOperationRecord[] {
    const rows = this.stmt('SELECT * FROM rail_operations ORDER BY operation_id').all() as Row[];
    return rows.map(rowToOperation);
  }

  listOperationsInWindow(startWallMs: number, endWallMs: number): RailOperationRecord[] {
    const rows = this.stmt(
      `SELECT * FROM rail_operations
       WHERE created_wall_ms >= ? AND created_wall_ms <= ? ORDER BY operation_id`,
    ).all(startWallMs, endWallMs) as Row[];
    return rows.map(rowToOperation);
  }

  // --- Area 13: immutable report log ---------------------------------------

  insertReport(record: RailResultReportRecord): void {
    this.stmt(
      `INSERT INTO rail_result_reports (report_id, operation_id, ordinal, outcome_class,
         reason_code, rail_refs_json, payload_hash, reported_wall_ms,
         recorded_seq, recorded_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.reportId,
      record.operationId,
      record.ordinal,
      record.outcomeClass,
      record.reasonCode ?? null,
      JSON.stringify(record.railReferences),
      record.payloadHash,
      record.reportedAtWallMs,
      record.recordedAt.sequence,
      record.recordedAt.wallMs,
    );
  }

  listReports(operationId: string): RailResultReportRecord[] {
    const rows = this.stmt(
      'SELECT * FROM rail_result_reports WHERE operation_id = ? ORDER BY ordinal',
    ).all(operationId) as Row[];
    return rows.map(rowToReport);
  }

  // --- Area 14: cases --------------------------------------------------------

  insertCase(record: ReconciliationCaseRecord): void {
    this.stmt(
      `INSERT INTO reconciliation_cases (case_id, status, origin_kind, origin_operation_id,
         origin_cycle_id, origin_detail_json, resolution_json, recovery_json,
         created_seq, created_wall_ms, updated_seq, updated_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.caseId,
      record.status,
      record.origin.kind,
      record.origin.kind === 'UNKNOWN_OPERATION' ? record.origin.operationId : null,
      record.origin.kind === 'CYCLE_DISCREPANCY' ? record.origin.cycleId : null,
      JSON.stringify(record.origin),
      record.resolution === undefined ? null : JSON.stringify(record.resolution),
      record.recovery === undefined ? null : JSON.stringify(record.recovery),
      record.openedAt.sequence,
      record.openedAt.wallMs,
      (record.resolvedAt ?? record.openedAt).sequence,
      (record.resolvedAt ?? record.openedAt).wallMs,
    );
  }

  updateCase(record: ReconciliationCaseRecord): void {
    this.stmt(
      `UPDATE reconciliation_cases SET status = ?, resolution_json = ?, recovery_json = ?,
         updated_seq = ?, updated_wall_ms = ? WHERE case_id = ?`,
    ).run(
      record.status,
      record.resolution === undefined ? null : JSON.stringify(record.resolution),
      record.recovery === undefined ? null : JSON.stringify(record.recovery),
      (record.resolvedAt ?? record.openedAt).sequence,
      (record.resolvedAt ?? record.openedAt).wallMs,
      record.caseId,
    );
  }

  getCase(caseId: string): ReconciliationCaseRecord | undefined {
    const row = this.stmt('SELECT * FROM reconciliation_cases WHERE case_id = ?').get(caseId) as
      | Row
      | undefined;
    return row === undefined ? undefined : rowToCase(row);
  }

  getCaseByOriginOperation(operationId: string): ReconciliationCaseRecord | undefined {
    const row = this.stmt(
      'SELECT * FROM reconciliation_cases WHERE origin_operation_id = ?',
    ).get(operationId) as Row | undefined;
    return row === undefined ? undefined : rowToCase(row);
  }

  listCases(): ReconciliationCaseRecord[] {
    const rows = this.stmt('SELECT * FROM reconciliation_cases ORDER BY case_id').all() as Row[];
    return rows.map(rowToCase);
  }

  listCasesByCycle(cycleId: string): ReconciliationCaseRecord[] {
    const rows = this.stmt(
      'SELECT * FROM reconciliation_cases WHERE origin_cycle_id = ? ORDER BY case_id',
    ).all(cycleId) as Row[];
    return rows.map(rowToCase);
  }

  /**
   * Open (non-terminal) case count — "the case stays open until a terminal
   * resolution" (INV-14-1); feeds CYCLE_CLOSED's "open case count".
   */
  countOpenCases(): number {
    const row = this.stmt(
      "SELECT COUNT(*) AS open_count FROM reconciliation_cases WHERE status IN ('OPEN', 'INVESTIGATING')",
    ).get() as Row;
    return asInteger(row['open_count']);
  }

  // --- Area 14: cycles -------------------------------------------------------

  insertCycle(record: ReconciliationCycleRecord, statements: readonly ExternalStatementRecord[]): void {
    this.stmt(
      `INSERT INTO reconciliation_cycles (cycle_id, status, window_start_wall_ms,
         window_end_wall_ms, rule_version, source_ids_json, statement_count, matched_count,
         discrepancy_count, open_case_count, statements_json, operations_snapshot_json,
         created_seq, created_wall_ms, updated_seq, updated_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.cycleId,
      record.status,
      record.windowStartWallMs,
      record.windowEndWallMs,
      record.ruleVersion,
      JSON.stringify(record.sourceIds),
      record.statementCount,
      record.matchedCount,
      record.discrepancyCount,
      record.openCaseCount,
      JSON.stringify(statements),
      '[]',
      record.openedAt.sequence,
      record.openedAt.wallMs,
      record.openedAt.sequence,
      record.openedAt.wallMs,
    );
  }

  updateCycle(record: ReconciliationCycleRecord): void {
    this.stmt(
      `UPDATE reconciliation_cycles SET status = ?, statement_count = ?, matched_count = ?,
         discrepancy_count = ?, open_case_count = ?, updated_seq = ?, updated_wall_ms = ?
       WHERE cycle_id = ?`,
    ).run(
      record.status,
      record.statementCount,
      record.matchedCount,
      record.discrepancyCount,
      record.openCaseCount,
      (record.closedAt ?? record.openedAt).sequence,
      (record.closedAt ?? record.openedAt).wallMs,
      record.cycleId,
    );
  }

  snapshotCycleInputs(
    cycleId: string,
    statements: readonly ExternalStatementRecord[],
    operations: readonly RailOperationRecord[],
  ): void {
    this.stmt(
      `UPDATE reconciliation_cycles SET statements_json = ?, operations_snapshot_json = ?
       WHERE cycle_id = ?`,
    ).run(JSON.stringify(statements), JSON.stringify(operations.map(rowValueOfOperation)), cycleId);
  }

  getCycle(cycleId: string): ReconciliationCycleRecord | undefined {
    const row = this.stmt('SELECT * FROM reconciliation_cycles WHERE cycle_id = ?').get(cycleId) as
      | Row
      | undefined;
    return row === undefined ? undefined : rowToCycle(row);
  }

  getCycleStatements(cycleId: string): ExternalStatementRecord[] {
    const row = this.stmt('SELECT statements_json FROM reconciliation_cycles WHERE cycle_id = ?').get(
      cycleId,
    ) as Row | undefined;
    return row === undefined ? [] : parseStatements(row['statements_json']);
  }

  getCycleOperationSnapshot(cycleId: string): RailOperationRecord[] {
    const row = this.stmt(
      'SELECT operations_snapshot_json FROM reconciliation_cycles WHERE cycle_id = ?',
    ).get(cycleId) as Row | undefined;
    return row === undefined ? [] : parseOperationSnapshot(row['operations_snapshot_json']);
  }

  // --- Area 14: sources --------------------------------------------------------

  insertSource(record: ReconciliationSourceRecord): void {
    this.stmt(
      `INSERT INTO reconciliation_sources (source_id, kind, description, last_sequence,
         created_seq, created_wall_ms, updated_seq, updated_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.sourceId,
      record.kind,
      record.description,
      record.lastSequence,
      record.registeredAt.sequence,
      record.registeredAt.wallMs,
      record.registeredAt.sequence,
      record.registeredAt.wallMs,
    );
  }

  updateSource(record: ReconciliationSourceRecord): void {
    this.stmt(
      `UPDATE reconciliation_sources SET last_sequence = ?, updated_seq = ?, updated_wall_ms = ?
       WHERE source_id = ?`,
    ).run(
      record.lastSequence,
      record.registeredAt.sequence,
      record.registeredAt.wallMs,
      record.sourceId,
    );
  }

  getSource(sourceId: string): ReconciliationSourceRecord | undefined {
    const row = this.stmt('SELECT * FROM reconciliation_sources WHERE source_id = ?').get(
      sourceId,
    ) as Row | undefined;
    return row === undefined ? undefined : rowToSource(row);
  }

  listSources(): ReconciliationSourceRecord[] {
    const rows = this.stmt('SELECT * FROM reconciliation_sources ORDER BY source_id').all() as Row[];
    return rows.map(rowToSource);
  }

  // --- Area 14: adjustments (append-only, INV-14-3) ---------------------------

  insertAdjustment(record: ReconciliationAdjustment): void {
    this.stmt(
      `INSERT INTO reconciliation_adjustments (adjustment_id, case_id, operation_id, links_json,
         description, created_seq, created_wall_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.adjustmentId,
      record.caseId,
      record.operationId ?? null,
      JSON.stringify(record.links),
      record.description,
      record.createdAt.sequence,
      record.createdAt.wallMs,
    );
  }

  listAdjustments(caseId: string): ReconciliationAdjustment[] {
    const rows = this.stmt(
      'SELECT * FROM reconciliation_adjustments WHERE case_id = ? ORDER BY adjustment_id',
    ).all(caseId) as Row[];
    return rows.map(rowToAdjustment);
  }
}

/**
 * Serializable projection of an operation for the cycle's matching-input
 * snapshot: the exact fields matchReconciliationRecords consumes
 * (operationId, status, idempotencyKey, railReferences, payload money).
 * Round-trips through rowToOperation-compatible shape.
 */
function rowValueOfOperation(operation: RailOperationRecord): Row {
  return {
    operation_id: operation.operationId,
    instruction_id: operation.instructionId,
    adapter_id: operation.adapterId,
    status: operation.status,
    reason_code: operation.reasonCode ?? null,
    idempotency_key: operation.idempotencyKey,
    payload_json: JSON.stringify(operation.payload),
    payload_hash: operation.payloadHash,
    rail_refs_json: JSON.stringify(operation.railReferences),
    created_seq: operation.authorizedAt.sequence,
    created_wall_ms: operation.authorizedAt.wallMs,
    updated_seq: operation.updatedAt.sequence,
    updated_wall_ms: operation.updatedAt.wallMs,
  };
}
