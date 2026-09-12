/**
 * RTN-009 — Settlement and Finality Authority: the per-domain durable
 * store (the openKernelStore convention, read-only over the DEP-003
 * database layer).
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174: "This directory defines semantics only; it
 * intentionally prescribes no implementation, storage, or service
 * decomposition."
 *
 * Mechanically (the kernel's persistence.ts template, the RTN-007/RTN-008
 * sibling templates): one SQLite database opened through the substrate's
 * openDurableDatabase({ dbPath, migrationsDir }), migrations in the owned
 * prefix src/lib/protocol-runtime/settlement/migrations/, domain database
 * file var/settlement.sqlite.
 *
 * Spec sources of the persisted records:
 *   - clearing-netting-settlement.md §4 Area 12 lines 224-240 (the three
 *     record shapes and their exact machines), lines 247-262 (INV-12-1
 *     verbatim amounts + payload hash; INV-12-2/INV-12-3 the per-
 *     instruction single-attempt key; INV-12-4 the per-subject
 *     exactly-once finality key).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  FinalityRecord,
  SettlementAttemptRecord,
  SettlementInstructionRecord,
} from './types.ts';

/**
 * Default filesystem path of the settlement-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 * var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_SETTLEMENT_DB_PATH = 'var/settlement.sqlite';

/**
 * Environment variable overriding the settlement migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling
 * domains' variables).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const SETTLEMENT_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_SETTLEMENT_MIGRATIONS_DIR';

/** The settlement domain's owned migration directory, relative to the repository root. */
export const SETTLEMENT_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'settlement',
  'migrations',
);

/** The settlement domain's owner identity. */
export const SETTLEMENT_STORE_DOMAIN = 'protocol-runtime-settlement';

/**
 * Resolve the settlement migrations directory (explicit argument, then
 * the environment variable, then the 8-level walk-up, then the
 * cwd-relative fallback that fails closed inside the runner).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveSettlementMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[SETTLEMENT_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, SETTLEMENT_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), SETTLEMENT_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the settlement-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface SettlementStoreOptions {
  /**
   * Filesystem path of the settlement-domain SQLite database file.
   * Default: var/settlement.sqlite (created on demand; never committed).
   */
  readonly dbPath?: string;
  /** Explicit migrations directory. Default: resolveSettlementMigrationsDir(). */
  readonly migrationsDir?: string;
}

/**
 * Open the settlement-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the
 * substrate's crash-safety pragmas and applies the settlement domain's
 * pending migrations from
 * src/lib/protocol-runtime/settlement/migrations/ via the substrate's
 * migration runner.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openSettlementStore(options: SettlementStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_SETTLEMENT_DB_PATH,
    migrationsDir: resolveSettlementMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write / read bridges
// ---------------------------------------------------------------------------

/** A persisted settlement-domain row (the write bridge's result marker). */
export interface SettlementStoreWrite {
  readonly kind: 'instruction' | 'attempt' | 'finality';
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`settlement store: expected a string (got ${typeof value})`);
  }
  return value;
}

function asInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`settlement store: expected an integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseTime(sequence: unknown, wallMs: unknown): ProtocolTime {
  return protocolTime(asInteger(sequence), asInteger(wallMs));
}

function optionalTime(sequence: unknown, wallMs: unknown): ProtocolTime | undefined {
  return sequence === null ? undefined : parseTime(sequence, wallMs);
}

/**
 * Persist one SettlementInstruction record (INSERT; the state UPDATE
 * path below replaces it on the state transitions).
 *
 * Source: clearing-netting-settlement.md lines 224-227, 247-249 (INV-12-1
 * — the verbatim amount columns + the recorded payload hash).
 */
export function writeInstruction(
  store: DurableDatabase,
  instruction: SettlementInstructionRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `INSERT INTO settlement_instructions (
         instruction_id, subject_kind, subject_id, subject_ordinal, state,
         beneficiary, memo, currency, scale, amount_minor, payload_hash,
         created_seq, created_wall_ms, issued_seq, issued_wall_ms,
         terminal_seq, terminal_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      instruction.instructionId,
      instruction.subject.kind,
      instruction.subject.kind === 'OBLIGATION'
        ? instruction.subject.obligationId
        : instruction.subject.netObligationId,
      instruction.subjectOrdinal,
      instruction.state,
      instruction.beneficiary,
      instruction.memo ?? null,
      instruction.amount.currency,
      instruction.amount.scale,
      instruction.amount.amountMinor,
      instruction.payloadHash,
      instruction.createdAt.sequence,
      instruction.createdAt.wallMs,
      instruction.issuedAt === undefined ? null : instruction.issuedAt.sequence,
      instruction.issuedAt === undefined ? null : instruction.issuedAt.wallMs,
      instruction.terminalAt === undefined ? null : instruction.terminalAt.sequence,
      instruction.terminalAt === undefined ? null : instruction.terminalAt.wallMs,
    );
  return { kind: 'instruction' };
}

/**
 * Update one instruction's state (CREATED -> ISSUED -> terminal; the
 * terminals have no outgoing edges — recovery is a NEW instruction).
 *
 * Source: clearing-netting-settlement.md lines 225-227, 264-266.
 */
export function updateInstructionState(
  store: DurableDatabase,
  instruction: SettlementInstructionRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `UPDATE settlement_instructions
         SET state = ?, issued_seq = ?, issued_wall_ms = ?, terminal_seq = ?, terminal_wall_ms = ?
       WHERE instruction_id = ?`,
    )
    .run(
      instruction.state,
      instruction.issuedAt === undefined ? null : instruction.issuedAt.sequence,
      instruction.issuedAt === undefined ? null : instruction.issuedAt.wallMs,
      instruction.terminalAt === undefined ? null : instruction.terminalAt.sequence,
      instruction.terminalAt === undefined ? null : instruction.terminalAt.wallMs,
      instruction.instructionId,
    );
  return { kind: 'instruction' };
}

/**
 * Persist one SettlementAttempt record (INSERT — one row per instruction,
 * the UNIQUE instruction_id is INV-12-2/INV-12-3 at the storage layer).
 *
 * Source: clearing-netting-settlement.md lines 228-233, 253-258.
 */
export function writeAttempt(
  store: DurableDatabase,
  attempt: SettlementAttemptRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `INSERT INTO settlement_attempts (
         attempt_id, instruction_id, state, operation_id, adapter_id,
         idempotency_key, reconciliation_case_id, created_seq, created_wall_ms,
         submitted_seq, submitted_wall_ms, resolved_seq, resolved_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      attempt.attemptId,
      attempt.instructionId,
      attempt.state,
      attempt.operationId,
      attempt.adapterId,
      attempt.idempotencyKey,
      attempt.reconciliationCaseId ?? null,
      attempt.createdAt.sequence,
      attempt.createdAt.wallMs,
      attempt.submittedAt === undefined ? null : attempt.submittedAt.sequence,
      attempt.submittedAt === undefined ? null : attempt.submittedAt.wallMs,
      attempt.resolvedAt === undefined ? null : attempt.resolvedAt.sequence,
      attempt.resolvedAt === undefined ? null : attempt.resolvedAt.wallMs,
    );
  return { kind: 'attempt' };
}

/**
 * Update one attempt's state (the machine transitions, including the
 * UNKNOWN -> {CONFIRMED, FAILED} resolution edges — executable only
 * through the reconciliation-resolution consumer).
 *
 * Source: clearing-netting-settlement.md lines 228-233, 264-273.
 */
export function updateAttemptState(
  store: DurableDatabase,
  attempt: SettlementAttemptRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `UPDATE settlement_attempts
         SET state = ?, reconciliation_case_id = ?, submitted_seq = ?,
             submitted_wall_ms = ?, resolved_seq = ?, resolved_wall_ms = ?
       WHERE attempt_id = ?`,
    )
    .run(
      attempt.state,
      attempt.reconciliationCaseId ?? null,
      attempt.submittedAt === undefined ? null : attempt.submittedAt.sequence,
      attempt.submittedAt === undefined ? null : attempt.submittedAt.wallMs,
      attempt.resolvedAt === undefined ? null : attempt.resolvedAt.sequence,
      attempt.resolvedAt === undefined ? null : attempt.resolvedAt.wallMs,
      attempt.attemptId,
    );
  return { kind: 'attempt' };
}

/**
 * Persist one FinalityRecord (INSERT — one row per subject, the UNIQUE
 * (subject_kind, subject_id) is INV-12-4's exactly-once at the storage
 * layer; the state UPDATE path below carries the one-way PROVISIONAL ->
 * FINAL transition).
 *
 * Source: clearing-netting-settlement.md lines 235-240, 259-262
 * (INV-12-4).
 */
export function writeFinality(
  store: DurableDatabase,
  finality: FinalityRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `INSERT INTO finality_records (
         finality_record_id, subject_kind, subject_id, state, instruction_id,
         operation_id, rule_reference, payload_hash, declared_provisional_seq,
         declared_provisional_wall_ms, declared_final_seq, declared_final_wall_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      finality.finalityRecordId,
      finality.subject.kind,
      finality.subject.kind === 'OBLIGATION'
        ? finality.subject.obligationId
        : finality.subject.netObligationId,
      finality.state,
      finality.instructionId ?? null,
      finality.operationId ?? null,
      finality.ruleReference,
      finality.payloadHash ?? null,
      finality.declaredProvisionalAt === undefined
        ? null
        : finality.declaredProvisionalAt.sequence,
      finality.declaredProvisionalAt === undefined ? null : finality.declaredProvisionalAt.wallMs,
      finality.declaredFinalAt === undefined ? null : finality.declaredFinalAt.sequence,
      finality.declaredFinalAt === undefined ? null : finality.declaredFinalAt.wallMs,
    );
  return { kind: 'finality' };
}

/**
 * Update one finality record's state (the one-way PROVISIONAL -> FINAL
 * transition; FINAL has no successor — there is no reversal UPDATE
 * anywhere in this module).
 *
 * Source: clearing-netting-settlement.md lines 236-240, 259-262
 * (INV-12-4).
 */
export function updateFinalityState(
  store: DurableDatabase,
  finality: FinalityRecord,
): SettlementStoreWrite {
  store
    .prepare(
      `UPDATE finality_records
         SET state = ?, instruction_id = ?, operation_id = ?, rule_reference = ?,
             payload_hash = ?, declared_final_seq = ?, declared_final_wall_ms = ?
       WHERE finality_record_id = ?`,
    )
    .run(
      finality.state,
      finality.instructionId ?? null,
      finality.operationId ?? null,
      finality.ruleReference,
      finality.payloadHash ?? null,
      finality.declaredFinalAt === undefined ? null : finality.declaredFinalAt.sequence,
      finality.declaredFinalAt === undefined ? null : finality.declaredFinalAt.wallMs,
      finality.finalityRecordId,
    );
  return { kind: 'finality' };
}

/**
 * Read all instruction records back (insertion order), reconstructing the
 * exact record shapes (Money re-minted through the kernel guards — GC-1
 * holds on the read path).
 *
 * Source: clearing-netting-settlement.md lines 224-227; GC-1.
 */
export function readInstructions(
  store: DurableDatabase,
): readonly SettlementInstructionRecord[] {
  const rows = store.prepare(`SELECT * FROM settlement_instructions ORDER BY rowid ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const subjectKind = asString(record['subject_kind']);
    return {
      instructionId: asString(record['instruction_id']),
      subject:
        subjectKind === 'OBLIGATION'
          ? {
              kind: 'OBLIGATION' as const,
              obligationId: asString(record['subject_id']),
            }
          : {
              kind: 'NET_POSITION' as const,
              netObligationId: asString(record['subject_id']),
            },
      subjectOrdinal: asInteger(record['subject_ordinal']),
      state: asString(record['state']) as SettlementInstructionRecord['state'],
      amount: money(
        asString(record['currency']),
        asInteger(record['amount_minor']),
        asInteger(record['scale']),
      ),
      beneficiary: asString(record['beneficiary']),
      ...(record['memo'] === null ? {} : { memo: asString(record['memo']) }),
      payloadHash: asString(record['payload_hash']),
      createdAt: parseTime(record['created_seq'], record['created_wall_ms']),
      ...(optionalTime(record['issued_seq'], record['issued_wall_ms']) === undefined
        ? {}
        : { issuedAt: optionalTime(record['issued_seq'], record['issued_wall_ms']) }),
      ...(optionalTime(record['terminal_seq'], record['terminal_wall_ms']) === undefined
        ? {}
        : { terminalAt: optionalTime(record['terminal_seq'], record['terminal_wall_ms']) }),
    };
  });
}

/**
 * Read all attempt records back (insertion order).
 *
 * Source: clearing-netting-settlement.md lines 228-233, 253-258.
 */
export function readAttempts(store: DurableDatabase): readonly SettlementAttemptRecord[] {
  const rows = store.prepare(`SELECT * FROM settlement_attempts ORDER BY rowid ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      attemptId: asString(record['attempt_id']),
      instructionId: asString(record['instruction_id']),
      state: asString(record['state']) as SettlementAttemptRecord['state'],
      operationId: asString(record['operation_id']),
      adapterId: asString(record['adapter_id']),
      idempotencyKey: asString(record['idempotency_key']),
      ...(record['reconciliation_case_id'] === null
        ? {}
        : { reconciliationCaseId: asString(record['reconciliation_case_id']) }),
      createdAt: parseTime(record['created_seq'], record['created_wall_ms']),
      ...(optionalTime(record['submitted_seq'], record['submitted_wall_ms']) === undefined
        ? {}
        : { submittedAt: optionalTime(record['submitted_seq'], record['submitted_wall_ms']) }),
      ...(optionalTime(record['resolved_seq'], record['resolved_wall_ms']) === undefined
        ? {}
        : { resolvedAt: optionalTime(record['resolved_seq'], record['resolved_wall_ms']) }),
    };
  });
}

/**
 * Read all finality records back (insertion order).
 *
 * Source: clearing-netting-settlement.md lines 235-240, 259-262.
 */
export function readFinalities(store: DurableDatabase): readonly FinalityRecord[] {
  const rows = store.prepare(`SELECT * FROM finality_records ORDER BY rowid ASC`).all();
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const subjectKind = asString(record['subject_kind']);
    return {
      finalityRecordId: asString(record['finality_record_id']),
      subject:
        subjectKind === 'OBLIGATION'
          ? {
              kind: 'OBLIGATION' as const,
              obligationId: asString(record['subject_id']),
            }
          : {
              kind: 'NET_POSITION' as const,
              netObligationId: asString(record['subject_id']),
            },
      state: asString(record['state']) as FinalityRecord['state'],
      ...(record['instruction_id'] === null
        ? {}
        : { instructionId: asString(record['instruction_id']) }),
      ...(record['operation_id'] === null
        ? {}
        : { operationId: asString(record['operation_id']) }),
      ruleReference: asString(record['rule_reference']),
      ...(record['payload_hash'] === null ? {} : { payloadHash: asString(record['payload_hash']) }),
      ...(optionalTime(
        record['declared_provisional_seq'],
        record['declared_provisional_wall_ms'],
      ) === undefined
        ? {}
        : {
            declaredProvisionalAt: optionalTime(
              record['declared_provisional_seq'],
              record['declared_provisional_wall_ms'],
            ),
          }),
      ...(optionalTime(record['declared_final_seq'], record['declared_final_wall_ms']) ===
      undefined
        ? {}
        : {
            declaredFinalAt: optionalTime(
              record['declared_final_seq'],
              record['declared_final_wall_ms'],
            ),
          }),
    };
  });
}
