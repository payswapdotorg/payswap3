/**
 * RTN-007 — Credit Authority: the per-domain durable store (the
 * openKernelStore convention, read-only over the DEP-003 database layer).
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
 * Spec sources of the persisted records:
 *   - liquidity-credit-queues.md lines 96-100 (CreditLine — the persisted
 *     shape; the exact state machine as CHECK constraint).
 *   - lines 105-111 (CreditDecision — the persisted shape; the
 *     (intent id, line id) key of INV-7-3 as a storage-level UNIQUE; the
 *     EVALUATED -> APPLIED machine as a CHECK constraint).
 *   - lines 101-104 (CreditExposure — a denormalized view row per line:
 *     the ledger resource accounting's held/consumed totals, kept in
 *     lockstep with the ledger entries; the CHECK backstop of INV-7-1:
 *     reserved + consumed <= limit).
 *
 * The exposure itself is ALWAYS recomputed from the RTN-006 ledger
 * (the line IS the ledger resource); the denormalized row is a durable
 * projection for audit and recovery.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { isMoney, money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import type {
  CreditDecisionOutcome,
  CreditDecisionRecord,
  CreditLineRecord,
} from './types.ts';
import { isCreditLineState, isCreditDecisionState, isCreditReasonCode } from './types.ts';

/**
 * Default filesystem path of the credit-domain store (mirrors the
 * substrate's var/durable.sqlite and the sibling domains' defaults).
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_CREDIT_DB_PATH = 'var/credit.sqlite';

/**
 * Environment variable overriding the credit migrations directory.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const CREDIT_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_CREDIT_MIGRATIONS_DIR';

/** The credit domain's owned migration directory, relative to the repository root. */
export const CREDIT_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'credit', 'migrations');

/** The credit domain's owner identity (for rows the domain itself records). */
export const CREDIT_STORE_DOMAIN = 'protocol-runtime-credit';

/**
 * Resolve the credit migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolveCreditMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[CREDIT_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, CREDIT_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), CREDIT_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the credit-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface CreditStoreOptions {
  /** Default: var/credit.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveCreditMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the credit-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openCreditStore(options: CreditStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_CREDIT_DB_PATH,
    migrationsDir: resolveCreditMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

const SQL_INSERT_LINE = `
  INSERT INTO credit_lines (
    line_id, limit_minor, currency, scale, state, offered_seq, offered_wall_ms,
    state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (line_id) DO NOTHING
`;

const SQL_UPDATE_LINE = `
  UPDATE credit_lines
  SET state = ?, state_seq = ?, state_wall_ms = ?
  WHERE line_id = ?
`;

const SQL_INSERT_DECISION = `
  INSERT INTO credit_decisions (
    decision_id, intent_id, line_id, state, outcome_kind, approved_amount,
    denial_reason, reservation_id, evaluated_seq, evaluated_wall_ms,
    applied_seq, applied_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (decision_id) DO NOTHING
`;

const SQL_UPDATE_DECISION = `
  UPDATE credit_decisions
  SET state = ?, reservation_id = ?, applied_seq = ?, applied_wall_ms = ?
  WHERE decision_id = ?
`;

const SQL_INSERT_EXPOSURE = `
  INSERT INTO credit_exposure (
    line_id, limit_minor, currency, scale, reserved_minor, consumed_minor
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (line_id) DO NOTHING
`;

const SQL_UPDATE_EXPOSURE = `
  UPDATE credit_exposure
  SET reserved_minor = ?, consumed_minor = ?
  WHERE line_id = ?
`;

/**
 * The outcome of one durable credit-domain write: created is false when
 * the row already existed (the dedupe no-op — the same { created, reason }
 * shape the sibling domains' stores report).
 *
 * Source: INV-7-3 (liquidity-credit-queues.md lines 125-127 — the
 * storage-level dedupe this outcome reports); DEP-003 §6.
 */
export interface CreditStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed line row (INSERT for creation; UPDATE for state
 * progression).
 *
 * Source: liquidity-credit-queues.md lines 96-100.
 */
export function writeCreditLine(store: DurableDatabase, line: CreditLineRecord): CreditStoreWrite {
  const result = store
    .prepare(SQL_INSERT_LINE)
    .run(
      line.lineId,
      line.limit.amountMinor,
      line.limit.currency,
      line.limit.scale,
      line.state,
      line.offeredAt.sequence,
      line.offeredAt.wallMs,
      line.stateChangedAt.sequence,
      line.stateChangedAt.wallMs,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store.prepare(SQL_UPDATE_LINE).run(line.state, line.stateChangedAt.sequence, line.stateChangedAt.wallMs, line.lineId);
  return { created: false, reason: 'written' };
}

/**
 * Persist one committed decision row (INSERT for the evaluation; UPDATE
 * for the EVALUATED -> APPLIED progression).
 *
 * Source: liquidity-credit-queues.md lines 105-111.
 */
export function writeCreditDecision(
  store: DurableDatabase,
  decision: CreditDecisionRecord,
): CreditStoreWrite {
  const approvedJson =
    decision.outcome.kind === 'APPROVED' ? JSON.stringify(decision.outcome.approvedAmount) : null;
  const denialReason = decision.outcome.kind === 'DENIED' ? decision.outcome.reason : null;
  const result = store
    .prepare(SQL_INSERT_DECISION)
    .run(
      decision.decisionId,
      decision.intentId,
      decision.lineId,
      decision.state,
      decision.outcome.kind,
      approvedJson,
      denialReason,
      decision.reservationId ?? null,
      decision.evaluatedAt.sequence,
      decision.evaluatedAt.wallMs,
      decision.appliedAt === undefined ? null : decision.appliedAt.sequence,
      decision.appliedAt === undefined ? null : decision.appliedAt.wallMs,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store
    .prepare(SQL_UPDATE_DECISION)
    .run(
      decision.state,
      decision.reservationId ?? null,
      decision.appliedAt === undefined ? null : decision.appliedAt.sequence,
      decision.appliedAt === undefined ? null : decision.appliedAt.wallMs,
      decision.decisionId,
    );
  return { created: false, reason: 'written' };
}

/**
 * Persist one line's denormalized exposure view (INSERT for the zero
 * view at activation; UPDATE in lockstep with the ledger transitions).
 *
 * Source: liquidity-credit-queues.md lines 101-104, 119-121.
 */
export function writeCreditExposure(
  store: DurableDatabase,
  view: {
    readonly lineId: string;
    readonly limit: Money;
    readonly reserved: Money;
    readonly consumed: Money;
  },
): CreditStoreWrite {
  const result = store
    .prepare(SQL_INSERT_EXPOSURE)
    .run(
      view.lineId,
      view.limit.amountMinor,
      view.limit.currency,
      view.limit.scale,
      view.reserved.amountMinor,
      view.consumed.amountMinor,
    );
  if (Number(result.changes) === 1) {
    return { created: true, reason: 'written' };
  }
  store.prepare(SQL_UPDATE_EXPOSURE).run(view.reserved.amountMinor, view.consumed.amountMinor, view.lineId);
  return { created: false, reason: 'written' };
}

// ---------------------------------------------------------------------------
// Read path (GC-1 holds: every Money column re-mints through money())
// ---------------------------------------------------------------------------

function parseMoneyColumn(value: unknown, label: string): Money {
  if (typeof value !== 'string') {
    throw new TypeError(`credit store: the ${label} column must hold canonical Money JSON`);
  }
  const parsed: unknown = JSON.parse(value);
  if (!isMoney(parsed)) {
    throw new TypeError(`credit store: the ${label} column is not a well-formed Money value (GC-1)`);
  }
  return money(parsed.currency, parsed.amountMinor, parsed.scale);
}

function parseTime(seq: unknown, wallMs: unknown, label: string): ProtocolTime {
  if (typeof seq !== 'number' || typeof wallMs !== 'number') {
    throw new TypeError(`credit store: the ${label} time columns are malformed`);
  }
  return protocolTime(seq, wallMs);
}

/**
 * Read every line row. Source: liquidity-credit-queues.md lines 96-100.
 */
export function readCreditLines(store: DurableDatabase): readonly CreditLineRecord[] {
  const rows = store.prepare('SELECT * FROM credit_lines ORDER BY offered_seq, line_id').all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => ({
    lineId: String(row['line_id']),
    limit: money(String(row['currency']), Number(row['limit_minor']), Number(row['scale'])),
    state: assertLineState(row['state']),
    offeredAt: parseTime(row['offered_seq'], row['offered_wall_ms'], 'offeredAt'),
    stateChangedAt: parseTime(row['state_seq'], row['state_wall_ms'], 'stateChangedAt'),
  }));
}

/**
 * Read every decision row. Source: liquidity-credit-queues.md lines
 * 105-111 (INV-7-3's key as UNIQUE (intent_id, line_id)).
 */
export function readCreditDecisions(store: DurableDatabase): readonly CreditDecisionRecord[] {
  const rows =
    store.prepare('SELECT * FROM credit_decisions ORDER BY evaluated_seq, decision_id').all() as Record<
      string,
      unknown
    >[];
  return rows.map((row) => {
    const outcomeKind = String(row['outcome_kind']);
    let outcome: CreditDecisionOutcome;
    if (outcomeKind === 'APPROVED') {
      outcome = { kind: 'APPROVED', approvedAmount: parseMoneyColumn(row['approved_amount'], 'approved_amount') };
    } else if (outcomeKind === 'DENIED') {
      const reason = row['denial_reason'];
      if (!isCreditReasonCode(reason)) {
        throw new TypeError(`credit store: unknown denial reason ${JSON.stringify(reason)}`);
      }
      outcome = { kind: 'DENIED', reason };
    } else {
      throw new TypeError(`credit store: unknown decision outcome kind ${outcomeKind}`);
    }
    const reservationId = row['reservation_id'];
    const appliedSeq = row['applied_seq'];
    return {
      decisionId: String(row['decision_id']),
      intentId: String(row['intent_id']),
      lineId: String(row['line_id']),
      state: assertDecisionState(row['state']),
      outcome,
      ...(typeof reservationId === 'string' ? { reservationId } : {}),
      evaluatedAt: parseTime(row['evaluated_seq'], row['evaluated_wall_ms'], 'evaluatedAt'),
      ...(appliedSeq === null || appliedSeq === undefined
        ? {}
        : { appliedAt: parseTime(appliedSeq, row['applied_wall_ms'], 'appliedAt') }),
    } as CreditDecisionRecord;
  });
}

/**
 * Read every denormalized exposure row. Source:
 * liquidity-credit-queues.md lines 101-104, 119-121.
 */
export function readCreditExposure(
  store: DurableDatabase,
): readonly { lineId: string; limit: Money; reserved: Money; consumed: Money }[] {
  const rows = store.prepare('SELECT * FROM credit_exposure ORDER BY line_id').all() as Record<
    string,
    unknown
  >[];
  return rows.map((row) => ({
    lineId: String(row['line_id']),
    limit: money(String(row['currency']), Number(row['limit_minor']), Number(row['scale'])),
    reserved: money(String(row['currency']), Number(row['reserved_minor']), Number(row['scale'])),
    consumed: money(String(row['currency']), Number(row['consumed_minor']), Number(row['scale'])),
  }));
}

function assertLineState(value: unknown): CreditLineRecord['state'] {
  if (!isCreditLineState(value)) {
    throw new TypeError(`credit store: unknown line state ${JSON.stringify(value)}`);
  }
  return value;
}

function assertDecisionState(value: unknown): CreditDecisionRecord['state'] {
  if (!isCreditDecisionState(value)) {
    throw new TypeError(`credit store: unknown decision state ${JSON.stringify(value)}`);
  }
  return value;
}
