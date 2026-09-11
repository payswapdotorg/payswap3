/**
 * RTN-005 — Fulfillment Policy Authority: per-domain persistence.
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
 * in-process-object-store + durable-bridge split for the policy domain:
 * ONE SQLite database (default var/policy.sqlite) opened through the
 * substrate's openDurableDatabase, migrations in this domain's OWNED
 * prefix, and write-through bridge functions persisting the authority's
 * committed records plus read-back reconstruction (Money re-minted through
 * the kernel's money() guard — GC-1's integer discipline holds on the read
 * path too).
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/core.md §2 Area 2 lines 97-107 (the records
 *   being persisted); lines 121-123 (INV-2-3 — the storage-level UNIQUE
 *   key); spec/durable/execution.md §2 (configuration), §4 (migrations).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { money } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import { protocolTime } from '../kernel/time.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { fulfillmentPolicyDefinition } from './evaluation.ts';
import type {
  ConstraintEnvelope,
  FulfillmentPolicyDefinition,
  FulfillmentPolicyRecord,
  IntentTerms,
  PolicyEvaluationOutcome,
  PolicyEvaluationRecord,
  RouteRequirement,
} from './types.ts';
import { isPolicyEvaluationState, isPolicyState } from './types.ts';

/**
 * Default filesystem path of the policy-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite
 * and the sibling domains' defaults; spec/durable/execution.md §2 lines
 * 40-43). var/ is a runtime artifact directory and is gitignored.
 *
 * Source: the per-domain persistence convention; DEP-003 §2 lines 40-43.
 */
export const DEFAULT_POLICY_DB_PATH = 'var/policy.sqlite';

/**
 * Environment variable overriding the policy migrations directory (mirrors
 * the substrate's PAYSWAP_MIGRATIONS_DIR and the sibling domains'
 * variables; spec/durable/execution.md §2 lines 44-47). In a deployed image
 * the migrations directory must ship with the application — the runner
 * fails closed when it cannot find migrations.
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const POLICY_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_POLICY_MIGRATIONS_DIR';

/** The policy domain's owned migration directory, relative to the repository root. */
export const POLICY_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'policy', 'migrations');

/** The policy domain's owner identity (for rows the domain itself records). */
export const POLICY_STORE_DOMAIN = 'protocol-runtime-policy';

/**
 * Resolve the policy migrations directory (explicit argument, then the
 * environment variable, then the 8-level walk-up, then the cwd-relative
 * fallback that fails closed inside the runner) — the same strategy the
 * substrate, the kernel, and the sibling domains use.
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain persistence convention.
 */
export function resolvePolicyMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[POLICY_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, POLICY_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), POLICY_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the policy-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface PolicyStoreOptions {
  /** Default: var/policy.sqlite (created on demand; never committed). */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolvePolicyMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the policy-domain store THROUGH the DEP-003 database layer
 * (read-only integration): the substrate's crash-safety pragmas and
 * migration runner over this domain's owned migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4.
 */
export function openPolicyStore(options: PolicyStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_POLICY_DB_PATH,
    migrationsDir: resolvePolicyMigrationsDir(options.migrationsDir),
  });
}

// ---------------------------------------------------------------------------
// Write path (the durable side of the authority's committed records)
// ---------------------------------------------------------------------------

const SQL_INSERT_POLICY = `
  INSERT INTO fulfillment_policies (
    policy_id, version, state, definition, attached_intent_id, attached_snapshot_id,
    created_seq, created_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (policy_id, version) DO NOTHING
`;

const SQL_UPDATE_POLICY_STATE = `
  UPDATE fulfillment_policies
  SET state = ?, attached_intent_id = ?, attached_snapshot_id = ?, state_seq = ?, state_wall_ms = ?
  WHERE policy_id = ? AND version = ?
`;

const SQL_INSERT_EVALUATION = `
  INSERT INTO policy_evaluations (
    evaluation_id, intent_id, policy_id, policy_version, snapshot_id, state,
    result, result_hash, evaluated_seq, evaluated_wall_ms, state_seq, state_wall_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (evaluation_id) DO NOTHING
`;

const SQL_UPDATE_EVALUATION_STATE = `
  UPDATE policy_evaluations
  SET state = ?, state_seq = ?, state_wall_ms = ?
  WHERE evaluation_id = ?
`;

/**
 * The outcome of one durable policy-domain write: created is false when
 * the row already existed (the dedupe no-op — the same { created, reason }
 * shape the substrate's deduplicated enqueue and the sibling domains'
 * stores report).
 *
 * Source: INV-2-3 (core.md lines 121-123 — the storage-level dedupe this
 * outcome reports); DEP-003 §6 (the dedupe-report shape mirrored).
 */
export interface PolicyStoreWrite {
  readonly created: boolean;
  readonly reason: 'written' | 'duplicate-no-op';
}

/**
 * Persist one committed FulfillmentPolicyRecord (INSERT-only on (policy
 * id, version): every published version is an immutable row; lifecycle
 * state changes flow through savePolicyState).
 *
 * Source: core.md lines 97-99 ("versioned, immutable policy document").
 */
export function writeFulfillmentPolicy(
  store: DurableDatabase,
  policy: FulfillmentPolicyRecord,
): PolicyStoreWrite {
  const result = store.prepare(SQL_INSERT_POLICY).run(
    policy.policyId,
    policy.version,
    policy.state,
    JSON.stringify(policy.definition),
    policy.attachedIntentId ?? null,
    policy.attachedSnapshotId ?? null,
    policy.createdAt.sequence,
    policy.createdAt.wallMs,
    policy.stateChangedAt.sequence,
    policy.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed policy lifecycle state change (the durable
 * projection of a POLICY_ATTACHED transition). Returns the number of rows
 * updated.
 *
 * Source: core.md lines 98-100 (the lifecycle).
 */
export function savePolicyState(store: DurableDatabase, policy: FulfillmentPolicyRecord): number {
  const result = store.prepare(SQL_UPDATE_POLICY_STATE).run(
    policy.state,
    policy.attachedIntentId ?? null,
    policy.attachedSnapshotId ?? null,
    policy.stateChangedAt.sequence,
    policy.stateChangedAt.wallMs,
    policy.policyId,
    policy.version,
  );
  return Number(result.changes);
}

/**
 * Persist one committed PolicyEvaluationRecord (INSERT-only on the derived
 * evaluation id — INV-2-3: one evaluation per (intent, policy version,
 * snapshot id); the schema's UNIQUE constraint makes the contract
 * structural; a duplicate write is a no-op).
 *
 * Source: core.md lines 102-107; INV-2-3 (lines 121-123).
 */
export function writePolicyEvaluation(
  store: DurableDatabase,
  evaluation: PolicyEvaluationRecord,
): PolicyStoreWrite {
  const result = store.prepare(SQL_INSERT_EVALUATION).run(
    evaluation.evaluationId,
    evaluation.intentId,
    evaluation.policyId,
    evaluation.policyVersion,
    evaluation.snapshotId,
    evaluation.state,
    JSON.stringify(evaluation.outcome),
    evaluation.resultHash,
    evaluation.evaluatedAt.sequence,
    evaluation.evaluatedAt.wallMs,
    evaluation.stateChangedAt.sequence,
    evaluation.stateChangedAt.wallMs,
  );
  const created = Number(result.changes) === 1;
  return { created, reason: created ? 'written' : 'duplicate-no-op' };
}

/**
 * Persist one committed evaluation state change (EVALUATED -> CONSUMED).
 * Returns the number of rows updated.
 *
 * Source: core.md lines 104-105 (the machine).
 */
export function savePolicyEvaluationState(
  store: DurableDatabase,
  evaluation: PolicyEvaluationRecord,
): number {
  const result = store.prepare(SQL_UPDATE_EVALUATION_STATE).run(
    evaluation.state,
    evaluation.stateChangedAt.sequence,
    evaluation.stateChangedAt.wallMs,
    evaluation.evaluationId,
  );
  return Number(result.changes);
}

// ---------------------------------------------------------------------------
// Read path (reconstruction as the domain's frozen records)
// ---------------------------------------------------------------------------

interface PolicyRow {
  policy_id: string;
  version: number;
  state: string;
  definition: string;
  attached_intent_id: string | null;
  attached_snapshot_id: string | null;
  created_seq: number;
  created_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

interface EvaluationRow {
  evaluation_id: string;
  intent_id: string;
  policy_id: string;
  policy_version: number;
  snapshot_id: string;
  state: string;
  result: string;
  result_hash: string;
  evaluated_seq: number;
  evaluated_wall_ms: number;
  state_seq: number;
  state_wall_ms: number;
}

function parseMoney(value: unknown, label: string): Money {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`policy store: ${label} is not a Money object`);
  }
  const record = value as Record<string, unknown>;
  return money(String(record['currency']), Number(record['amountMinor']), Number(record['scale']));
}

function parseDefinition(text: string): FulfillmentPolicyDefinition {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return fulfillmentPolicyDefinition({
    allowedRails: parsed['allowedRails'] as readonly string[],
    ordering: String(parsed['ordering']),
    costCeiling: parseMoney(parsed['costCeiling'], 'definition.costCeiling'),
    deadlineEpochMs: Number(parsed['deadlineEpochMs']),
    fallbackPreference: parsed['fallbackPreference'] as readonly string[],
  });
}

function asTime(seq: number, wallMs: number): ProtocolTime {
  return protocolTime(Number(seq), Number(wallMs));
}

/**
 * Read every persisted policy version back, in version order,
 * reconstructed as the domain's frozen FulfillmentPolicyRecord records
 * (definition re-minted through fulfillmentPolicyDefinition — every
 * validation re-runs on the read path; GC-1 holds end to end).
 *
 * Source: core.md lines 97-100; GC-1 (README.md §3 lines 39-43).
 */
export function readFulfillmentPolicies(store: DurableDatabase): FulfillmentPolicyRecord[] {
  const rows = store
    .prepare(
      'SELECT policy_id, version, state, definition, attached_intent_id, attached_snapshot_id, ' +
        'created_seq, created_wall_ms, state_seq, state_wall_ms ' +
        'FROM fulfillment_policies ORDER BY policy_id ASC, version ASC',
    )
    .all() as unknown as PolicyRow[];
  return rows.map((row) => {
    if (!isPolicyState(row.state)) {
      throw new TypeError(`policy store: state is not a policy state (got ${JSON.stringify(row.state)})`);
    }
    return Object.freeze({
      policyId: row.policy_id,
      version: Number(row.version),
      state: row.state,
      definition: Object.freeze(parseDefinition(row.definition)),
      ...(row.attached_intent_id === null ? {} : { attachedIntentId: row.attached_intent_id }),
      ...(row.attached_snapshot_id === null ? {} : { attachedSnapshotId: row.attached_snapshot_id }),
      createdAt: asTime(row.created_seq, row.created_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    });
  });
}

function parseRouteRequirement(value: unknown): RouteRequirement {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('policy store: route requirement is not an object');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    capabilityId: String(record['capabilityId']),
    railId: String(record['railId']),
    sourceCurrency: String(record['sourceCurrency']),
    destinationCurrency: String(record['destinationCurrency']),
    costSchedule: parseMoney(record['costSchedule'], 'costSchedule'),
    tier: String(record['tier']),
  });
}

function parseOutcome(text: string): PolicyEvaluationOutcome {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed['satisfiable'] === false) {
    return { satisfiable: false, reasonCode: 'POLICY_UNSATISFIABLE' };
  }
  const result = parsed['result'] as Record<string, unknown>;
  const envelope = result['constraintEnvelope'] as Record<string, unknown>;
  const requirements = result['rankedRouteRequirements'] as unknown[];
  const ordering = String(envelope['ordering']);
  if (ordering !== 'COST_ASC' && ordering !== 'TIER_DESC') {
    throw new TypeError(`policy store: constraint envelope ordering is invalid (got ${JSON.stringify(ordering)})`);
  }
  const constraintEnvelope: ConstraintEnvelope = Object.freeze({
    allowedRails: (envelope['allowedRails'] as readonly string[]).map((rail) => String(rail)),
    ordering,
    fallbackPreference: (envelope['fallbackPreference'] as readonly string[]).map((rail) => String(rail)),
  });
  return {
    satisfiable: true,
    result: Object.freeze({
      rankedRouteRequirements: Object.freeze(requirements.map(parseRouteRequirement)),
      constraintEnvelope,
      costCeiling: parseMoney(result['costCeiling'], 'result.costCeiling'),
      deadlineEpochMs: Number(result['deadlineEpochMs']),
    }),
  };
}

/**
 * Read every persisted evaluation back, in evaluation order, reconstructed
 * as the domain's frozen PolicyEvaluationRecord records.
 *
 * Source: core.md lines 102-107; INV-2-2 (the recorded snapshot id);
 * INV-2-3 (the derived ids this read returns).
 */
export function readPolicyEvaluations(store: DurableDatabase): PolicyEvaluationRecord[] {
  const rows = store
    .prepare(
      'SELECT evaluation_id, intent_id, policy_id, policy_version, snapshot_id, state, result, ' +
        'result_hash, evaluated_seq, evaluated_wall_ms, state_seq, state_wall_ms ' +
        'FROM policy_evaluations ORDER BY evaluated_seq ASC',
    )
    .all() as unknown as EvaluationRow[];
  return rows.map((row) => {
    if (!isPolicyEvaluationState(row.state)) {
      throw new TypeError(`policy store: evaluation state is invalid (got ${JSON.stringify(row.state)})`);
    }
    return Object.freeze({
      evaluationId: row.evaluation_id,
      intentId: row.intent_id,
      policyId: row.policy_id,
      policyVersion: Number(row.policy_version),
      snapshotId: row.snapshot_id,
      state: row.state,
      outcome: Object.freeze(parseOutcome(row.result)),
      resultHash: row.result_hash,
      evaluatedAt: asTime(row.evaluated_seq, row.evaluated_wall_ms),
      stateChangedAt: asTime(row.state_seq, row.state_wall_ms),
    });
  });
}
