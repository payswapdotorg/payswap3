/**
 * RTN-005 — Intent Authority: per-domain persistence.
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only. This
 *    keeps sibling surfaces disjoint (a shared deploy/migrations/ prefix
 *    would collide between parallel siblings)."
 *
 * v0.1 permission for this convention — spec/architecture/v0.1/README.md
 * §9, lines 173-174: "This directory defines semantics only; it
 * intentionally prescribes no implementation, storage, or service
 * decomposition."
 *
 * This module mirrors the kernel's reference pattern (src/lib/protocol-
 * runtime/kernel/persistence.ts) and the RTN-002 evidence domain's
 * in-process-object-store + durable-bridge split (src/lib/protocol-runtime/
 * evidence/persistence.ts) for the intent domain:
 *   - ONE SQLite database opened through the substrate's
 *     openDurableDatabase({ dbPath, migrationsDir }) (WAL,
 *     synchronous=FULL, busy_timeout, the explicit migration runner);
 *   - migrations in the intent domain's OWNED prefix
 *     (src/lib/protocol-runtime/intent/migrations/), never in the shared
 *     deploy/migrations/;
 *   - its own database file (default var/intent.sqlite), fully disjoint from
 *     the substrate's var/durable.sqlite, the kernel's var/kernel.sqlite,
 *     the evidence log's var/evidence.sqlite, risk's var/risk.sqlite, and
 *     rails' var/rails.sqlite.
 *
 * The Intent Authority itself is an in-process single writer (the RTN-002
 * precedent — see authority.ts); this module is the durable side of the
 * same discipline: write-through bridge functions that persist the
 * authority's committed records and read-back functions that reconstruct
 * them as the domain's frozen records (re-minting Money via the kernel's
 * money() guard — GC-1's integer discipline holds on the read path too).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §1 Area 1 lines 33-44 (PaymentIntent,
 *   DemandDescriptor, IntentReceipt — the records being persisted);
 *   lines 57-62 (INV-1-2/INV-1-3 — the storage-level UNIQUE constraints
 *   that make collapse structural);
 *   spec/durable/execution.md §2 (configuration), §4 (migrations).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import {
  demandDescriptor,
  demandDescriptorHash,
} from './descriptor.ts';
import type { DemandDescriptor } from './types.ts';
import type {
  IntentReceipt,
  IntentState,
  PaymentIntent,
} from './types.ts';
import { isIntentState } from './types.ts';

/**
 * Default filesystem path of the intent-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite,
 * the kernel's var/kernel.sqlite, and the evidence domain's
 * var/evidence.sqlite; spec/durable/execution.md §2 lines 40-43). var/ is a
 * runtime artifact directory and is gitignored ("Data is never committed").
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_INTENT_DB_PATH = 'var/intent.sqlite';

/**
 * Environment variable overriding the intent migrations directory (mirrors
 * the substrate's PAYSWAP_MIGRATIONS_DIR, the kernel's
 * PAYSWAP_KERNEL_MIGRATIONS_DIR, and evidence's
 * PAYSWAP_EVIDENCE_MIGRATIONS_DIR; spec/durable/execution.md §2 lines
 * 44-47). In a deployed image the migrations directory must ship with the
 * application (or be pointed at via this variable) — the runner fails
 * closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const INTENT_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_INTENT_MIGRATIONS_DIR';

/** The intent domain's owned migration directory, relative to the repository root. */
export const INTENT_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'intent', 'migrations');

/** The intent domain's owner identity (for rows the intent domain itself records). */
export const INTENT_STORE_DOMAIN = 'protocol-runtime-intent';

/**
 * Resolve the intent migrations directory:
 *   1. an explicit argument (tests and deployments);
 *   2. PAYSWAP_INTENT_MIGRATIONS_DIR from the environment;
 *   3. the first `src/lib/protocol-runtime/intent/migrations` found walking
 *      up from the process working directory (up to 8 levels) — the same
 *      walk-up strategy the substrate, the kernel, and the evidence domain
 *      use;
 *   4. the cwd-relative fallback (which then fails closed inside the runner
 *      with a precise error, exactly like the substrate).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention (kernel/persistence.ts is the
 * reference pattern).
 */
export function resolveIntentMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[INTENT_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, INTENT_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), INTENT_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the intent-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface IntentStoreOptions {
  /**
   * Filesystem path of the intent-domain SQLite database file.
   * Default: var/intent.sqlite (created on demand; never committed).
   * `:memory:` is accepted for experiments only (not durable, WAL
   * unavailable) — same rule as the substrate.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveIntentMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the intent-domain store THROUGH the DEP-003 database layer
 * (read-only integration): opens the SQLite database with the substrate's
 * crash-safety pragmas (WAL, synchronous=FULL, busy_timeout) and applies
 * the intent domain's pending migrations from
 * src/lib/protocol-runtime/intent/migrations/ via the substrate's
 * migration runner.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openIntentStore(options: IntentStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_INTENT_DB_PATH,
    migrationsDir: resolveIntentMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the authority's committed records)
// ---------------------------------------------------------------------------

const SQL_INSERT_INTENT = `
  INSERT INTO payment_intents (
    intent_id, idempotency_key, state, descriptor, descriptor_hash,
    prior_intent_id, policy_decision_id, recorded_outcome,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (intent_id) DO NOTHING
`;

const SQL_UPDATE_INTENT_STATE = `
  UPDATE payment_intents
  SET state = ?, policy_decision_id = COALESCE(?, policy_decision_id),
      state_seq = ?, state_wall_ms = ?
  WHERE intent_id = ?
`;

const SQL_INSERT_RECEIPT = `
  INSERT INTO intent_receipts (
    idempotency_key, intent_id, state, outcome, recorded_seq, recorded_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (idempotency_key) DO NOTHING
`;

/**
 * The outcome of one durable intent write: created is false when the row
 * already existed (the dedupe no-op — the same { created, reason } shape
 * the substrate's deduplicated enqueue and the evidence store's
 * writeEvidenceRecord report).
 *
 * Source: INV-1-2/INV-1-3 (core.md lines 57-62 — the storage-level collapse
 * this outcome reports); DEP-003 §6 (the dedupe-report shape mirrored).
 */
export interface IntentStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

function asTime(seq: number, wallMs: number): ProtocolTime {
  return protocolTime(seq, wallMs);
}

/**
 * Persist one committed PaymentIntent (INSERT-only on identity: the
 * derived intent id and the UNIQUE idempotency key make duplicate writes
 * no-ops — the storage-level INV-1-2/INV-1-3 collapse). The descriptor is
 * stored as canonical JSON; state changes flow through
 * writeIntentState, never a second intent row.
 *
 * Source: core.md lines 33-41; INV-1-2/INV-1-3 (lines 57-62).
 */
export function writePaymentIntent(store: DurableDatabase, intent: PaymentIntent): IntentStoreWrite {
  const result = store.prepare(SQL_INSERT_INTENT).run(
    intent.intentId,
    intent.idempotencyKey,
    intent.state,
    JSON.stringify(intent.descriptor),
    intent.descriptorHash,
    intent.priorIntentId ?? null,
    intent.policyDecisionId ?? null,
    'DRAFT',
    intent.createdAt.sequence,
    intent.createdAt.wallMs,
    intent.stateChangedAt.sequence,
    intent.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed intent state change (the durable projection of an
 * INTENT_STATE_CHANGED / INTENT_AUTHORIZED transition). Returns the number
 * of rows updated (0 when the intent is not persisted — a typed outcome,
 * not a silent guess).
 *
 * Source: core.md lines 34-37 (the one-way transitions this persists);
 * lines 76-77 (the transitions' evidence coupling the authority already
 * honored before committing the record handed here).
 */
export function writeIntentState(store: DurableDatabase, intent: PaymentIntent): number {
  const result = store.prepare(SQL_UPDATE_INTENT_STATE).run(
    intent.state,
    intent.policyDecisionId ?? null,
    intent.stateChangedAt.sequence,
    intent.stateChangedAt.wallMs,
    intent.intentId,
  );
  return Number(result.changes);
}

/**
 * Persist one recorded IntentReceipt (INSERT-only on the idempotency key —
 * INV-1-3: the recorded receipt is returned verbatim on re-submission, so
 * it is written exactly once per key).
 *
 * Source: core.md lines 43-44; INV-1-3 (lines 60-62).
 */
export function writeIntentReceipt(store: DurableDatabase, receipt: IntentReceipt): IntentStoreWrite {
  const key = findKeyForReceipt(store, receipt);
  const result = store.prepare(SQL_INSERT_RECEIPT).run(
    key,
    receipt.intentId,
    receipt.state,
    receipt.outcome,
    receipt.recordedAt.sequence,
    receipt.recordedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

function findKeyForReceipt(store: DurableDatabase, receipt: IntentReceipt): string {
  const row = store
    .prepare('SELECT idempotency_key FROM payment_intents WHERE intent_id = ?')
    .get(receipt.intentId) as unknown as { idempotency_key: string } | undefined;
  if (row === undefined) {
    throw new TypeError(
      `intent store: receipt for intent ${receipt.intentId} has no persisted intent row (write the intent first)`,
    );
  }
  return row.idempotency_key;
}

// ---------------------------------------------------------------------------
// Read path (reconstruction as the domain's frozen records)
// ---------------------------------------------------------------------------

interface IntentRow {
  intent_id: string;
  idempotency_key: string;
  state: string;
  descriptor: string;
  descriptor_hash: string;
  prior_intent_id: string | null;
  policy_decision_id: string | null;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface ReceiptRow {
  idempotency_key: string;
  intent_id: string;
  state: string;
  outcome: string;
  recorded_seq: number;
  recorded_wall_ms: number;
}

function parseDescriptor(text: string): DemandDescriptor {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const amount = parseMoney(parsed['amount'], 'descriptor.amount');
  const constraints = parseConstraints(parsed['constraints']);
  return demandDescriptor({
    amount,
    source: parseEndpoint(parsed['source'], 'source'),
    destination: parseEndpoint(parsed['destination'], 'destination'),
    constraints,
    idempotencyKey: String(parsed['idempotencyKey']),
  });
}

function parseEndpoint(value: unknown, label: string): {
  readonly currency: string;
  readonly geography: string;
  readonly account: string;
} {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`intent store: descriptor.${label} is not an object`);
  }
  const endpoint = value as Record<string, unknown>;
  return {
    currency: String(endpoint['currency']),
    geography: String(endpoint['geography']),
    account: String(endpoint['account']),
  };
}

function parseConstraints(value: unknown): {
  readonly deadlineEpochMs: number;
  readonly allowedRails: readonly string[];
  readonly costCeiling: Money;
} {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('intent store: descriptor.constraints is not an object');
  }
  const constraints = value as Record<string, unknown>;
  const rails = constraints['allowedRails'];
  if (!Array.isArray(rails)) {
    throw new TypeError('intent store: descriptor.constraints.allowedRails is not an array');
  }
  return {
    deadlineEpochMs: Number(constraints['deadlineEpochMs']),
    allowedRails: rails.map((rail) => String(rail)),
    costCeiling: parseMoney(constraints['costCeiling'], 'constraints.costCeiling'),
  };
}

function parseMoney(value: unknown, label: string): Money {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`intent store: ${label} is not a Money object`);
  }
  const record = value as Record<string, unknown>;
  return money(String(record['currency']), Number(record['amountMinor']), Number(record['scale']));
}

function parseIntentState(value: string, label: string): IntentState {
  if (!isIntentState(value)) {
    throw new TypeError(`intent store: ${label} is not an intent state (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Read every persisted intent back, in insertion order, reconstructed as
 * the domain's frozen PaymentIntent records (descriptor re-minted through
 * demandDescriptor — every kernel Money guard re-runs on the read path;
 * GC-1's integer discipline holds end to end).
 *
 * Source: core.md lines 33-41 (the records being reconstructed); GC-1
 * (README.md §3 lines 39-43).
 */
export function readPaymentIntents(store: DurableDatabase): PaymentIntent[] {
  const rows = store
    .prepare(
      'SELECT intent_id, idempotency_key, state, descriptor, descriptor_hash, prior_intent_id, ' +
        'policy_decision_id, created_seq, created_wall_ms, state_seq, state_wall_ms ' +
        'FROM payment_intents ORDER BY created_seq ASC',
    )
    .all() as unknown as IntentRow[];
  return rows.map((row) => {
    const descriptor = parseDescriptor(row.descriptor);
    const intent: PaymentIntent = {
      intentId: row.intent_id,
      idempotencyKey: row.idempotency_key,
      state: parseIntentState(row.state, 'state'),
      descriptor,
      descriptorHash: row.descriptor_hash,
      ...(row.prior_intent_id === null ? {} : { priorIntentId: row.prior_intent_id }),
      ...(row.policy_decision_id === null ? {} : { policyDecisionId: row.policy_decision_id }),
      createdAt: asTime(Number(row.created_seq), Number(row.created_wall_ms)),
      stateChangedAt: asTime(Number(row.state_seq), Number(row.state_wall_ms)),
    };
    if (intent.descriptorHash !== row.descriptor_hash) {
      throw new TypeError(
        `intent store: descriptor hash mismatch for intent ${row.intent_id} (stored ${row.descriptor_hash}, derived ${intent.descriptorHash})`,
      );
    }
    return Object.freeze(intent);
  });
}

/**
 * Read every persisted receipt back, in recording order, reconstructed as
 * the domain's frozen IntentReceipt records.
 *
 * Source: core.md lines 43-44; INV-1-3 (lines 60-62).
 */
export function readIntentReceipts(store: DurableDatabase): IntentReceipt[] {
  const rows = store
    .prepare(
      'SELECT idempotency_key, intent_id, state, outcome, recorded_seq, recorded_wall_ms ' +
        'FROM intent_receipts ORDER BY recorded_seq ASC',
    )
    .all() as unknown as ReceiptRow[];
  return rows.map((row) =>
    Object.freeze({
      intentId: row.intent_id,
      state: parseIntentState(row.state, 'receipt state'),
      outcome: parseIntentState(row.outcome, 'receipt outcome'),
      recordedAt: asTime(Number(row.recorded_seq), Number(row.recorded_wall_ms)),
    }),
  );
}
