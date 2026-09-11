/**
 * RTN-003 — Risk/Compliance Authority: the risk-domain store (the per-domain
 * persistence convention, following the kernel's persistence.ts template).
 *
 * Spec source (binding):
 *   The convention (decided in RTN-001 — spec/protocol-runtime-work-orders/
 *   README.md, "Persistence convention"):
 *     "each authority domain owns its schema and per-domain migrations inside
 *      its owned prefix, using the DEP-003 database layer read-only. This
 *      keeps sibling surfaces disjoint (a shared deploy/migrations/ prefix
 *      would collide between parallel siblings)."
 *   v0.1 permission — spec/architecture/v0.1/README.md §9, lines 173-174:
 *     "This directory defines semantics only; it intentionally prescribes no
 *      implementation, storage, or service decomposition."
 *   The invariants this store makes structural:
 *     INV-16-4 (evidence-risk-compliance.md lines 133-134): "check ids are
 *     keyed by (subject id, rule set version); re-evaluation returns the
 *     recorded result." — the compliance_checks PRIMARY KEY on the derived
 *     check id.
 *     INV-16-1 (lines 124-126): identical inputs, identical recorded
 *     outcome — the screening_results UNIQUE (list_id, list_version,
 *     subject_data_hash).
 *     The draft/publish discipline of the rule lifecycle (lines 98-100) —
 *     one AUTHORED draft per rule id (partial unique index).
 *   Failure semantics honored structurally (lines 137-139):
 *     "External list updates are inputs, not effects; a failed list refresh
 *     leaves the prior version active and records the failure — never a
 *     silent guess." — refresh failures are recorded rows; versions are
 *     append-only.
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts (the individually plain-Node-loadable module — see
 * src/lib/durable/index.ts lines 22-25) and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import type { ProtocolTime } from '../kernel/time.ts';
import { isProtocolTime, protocolTime } from '../kernel/time.ts';
import type {
  ComplianceCheckRecord,
  ComplianceEvaluation,
  ComplianceReviewRecord,
} from './evaluation.ts';
import { COMPLIANCE_CHECK_STATES } from './evaluation.ts';
import type { RiskRuleRecord, RiskRuleState, RiskRuleDefinition } from './rule.ts';
import { RISK_RULE_STATES } from './rule.ts';
import type { ScreeningListRecord, ScreeningResultRecord, ScreeningResultState } from './screening.ts';
import { SCREENING_RESULT_STATES } from './screening.ts';
import { SUBJECT_KINDS } from './subject.ts';
import type { SubjectKind } from './subject.ts';

/**
 * Default filesystem path of the risk-domain store, relative to the process
 * working directory (mirrors the kernel's var/kernel.sqlite default; the
 * substrate's var/ convention — data is never committed).
 *
 * Source: the per-domain persistence convention (WAVE README.md line 37);
 * DEP-003 §2 lines 40-43.
 */
export const DEFAULT_RISK_DB_PATH = 'var/risk.sqlite';

/**
 * Environment variable overriding the risk migrations directory (mirrors the
 * kernel's PAYSWAP_KERNEL_MIGRATIONS_DIR; the substrate's
 * PAYSWAP_MIGRATIONS_DIR).
 *
 * Source: DEP-003 §2 lines 44-47; the per-domain convention.
 */
export const RISK_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_RISK_MIGRATIONS_DIR';

/** The risk domain's owned migration directory, relative to the repository root. */
export const RISK_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'risk', 'migrations');

/** The risk domain's owner identity. */
export const RISK_STORE_DOMAIN = 'protocol-runtime-risk';

/**
 * Resolve the risk migrations directory (explicit argument → environment →
 * walk-up from cwd → fail-closed fallback), exactly the kernel's strategy.
 *
 * Source: DEP-003 §2/§4; the per-domain persistence convention.
 */
export function resolveRiskMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[RISK_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, RISK_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), RISK_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the risk-domain store (mirrors KernelStoreOptions).
 *
 * Source: the per-domain persistence convention; the substrate's
 * DurableDatabaseOptions shape.
 */
export interface RiskStoreOptions {
  /**
   * Filesystem path of the risk-domain SQLite database file. Default:
   * var/risk.sqlite. `:memory:` is accepted for experiments only.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveRiskMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the risk-domain store THROUGH the DEP-003 database layer (read-only
 * integration): WAL, synchronous=FULL, busy_timeout, and the risk domain's
 * pending migrations from src/lib/protocol-runtime/risk/migrations/ applied
 * by the substrate's migration runner.
 *
 * Source: the per-domain persistence convention (WAVE README.md line 37);
 * DEP-003 §3/§4.
 */
export function openRiskStore(options: RiskStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_RISK_DB_PATH,
    migrationsDir: resolveRiskMigrationsDir(options.migrationsDir),
  });
}

function assertWhen(when: unknown, label: string): asserts when is ProtocolTime {
  if (!isProtocolTime(when)) {
    throw new TypeError(`risk store: ${label} must be a well-formed ProtocolTime`);
  }
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new TypeError(`risk store: stored ${label} is not a member of the vocabulary (got ${JSON.stringify(value)})`);
}

// ---------------------------------------------------------------------------
// Deterministic JSON columns: stored projections are canonical (sorted keys,
// stable member order) so identical records always serialize identically.
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`risk store: stored ${label} is not valid JSON`);
  }
}

// ---------------------------------------------------------------------------
// RiskRule rows
// ---------------------------------------------------------------------------

interface RuleRow {
  readonly rule_id: string;
  readonly version: number;
  readonly state: string;
  readonly definition: string;
  readonly created_wall_ms: number;
  readonly created_seq: number;
  readonly state_wall_ms: number;
  readonly state_seq: number;
}

function ruleFromRow(row: RuleRow): RiskRuleRecord {
  return {
    ruleId: row.rule_id,
    version: row.version,
    state: parseEnum(row.state, RISK_RULE_STATES, 'risk rule state'),
    definition: parseJson(row.definition, 'risk rule definition') as RiskRuleDefinition,
  };
}

/**
 * Insert a new AUTHORED rule draft. Rejects (deterministically) a second
 * draft for the same rule id — the store keeps one open draft per rule.
 *
 * Source: the rule lifecycle's AUTHORED state (evidence-risk-compliance.md
 * §2 lines 98-100); the per-domain persistence convention.
 */
export function insertRiskRuleDraft(db: DurableDatabase, rule: RiskRuleRecord, when: ProtocolTime): void {
  assertWhen(when, 'when');
  if (rule.state !== 'AUTHORED') {
    throw new TypeError(`risk store: insertRiskRuleDraft requires an AUTHORED draft (got ${rule.state})`);
  }
  db.prepare(
    `INSERT INTO risk_rules (rule_id, version, state, definition, created_wall_ms, created_seq, state_wall_ms, state_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rule.ruleId, rule.version, rule.state, canonicalJson(rule.definition), when.wallMs, when.sequence, when.wallMs, when.sequence);
}

/**
 * Replace a rule draft with its published version row (draft v0 out,
 * version N in) — the AUTHORED -> VERSIONED persistence step, atomic in one
 * transaction.
 *
 * Source: evidence-risk-compliance.md §2 line 100 — "AUTHORED -> VERSIONED";
 * the per-domain persistence convention.
 */
export function publishRiskRuleRow(
  db: DurableDatabase,
  ruleId: string,
  published: RiskRuleRecord,
  when: ProtocolTime,
): void {
  assertWhen(when, 'when');
  if (published.state !== 'VERSIONED' || published.ruleId !== ruleId) {
    throw new TypeError('risk store: publishRiskRuleRow requires the VERSIONED record of the same rule id');
  }
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM risk_rules WHERE rule_id = ? AND state = 'AUTHORED'`).run(ruleId);
    const existing = db
      .prepare(`SELECT version FROM risk_rules WHERE rule_id = ? AND version = ?`)
      .get(ruleId, published.version);
    if (existing !== undefined) {
      throw new TypeError(`risk store: rule ${ruleId} v${published.version} already exists`);
    }
    db.prepare(
      `INSERT INTO risk_rules (rule_id, version, state, definition, created_wall_ms, created_seq, state_wall_ms, state_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ruleId, published.version, published.state, canonicalJson(published.definition), when.wallMs, when.sequence, when.wallMs, when.sequence);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Persist a rule record's current state (any published state).
 *
 * Source: the rule lifecycle persistence (lines 98-100); the per-domain
 * persistence convention.
 */
export function saveRiskRuleState(db: DurableDatabase, rule: RiskRuleRecord, when: ProtocolTime): void {
  assertWhen(when, 'when');
  const updated = db
    .prepare(
      `UPDATE risk_rules SET state = ?, state_wall_ms = ?, state_seq = ? WHERE rule_id = ? AND version = ?`,
    )
    .run(rule.state, when.wallMs, when.sequence, rule.ruleId, rule.version);
  if (updated.changes !== 1) {
    throw new TypeError(`risk store: rule ${rule.ruleId} v${rule.version} not found`);
  }
}

/**
 * Replace an AUTHORED draft's definition in place (the AUTHORED-state
 * revision the lifecycle permits; definitions are immutable after publish).
 *
 * Source: evidence-risk-compliance.md §2 lines 98-99 — "versioned, immutable
 * rule definition" (immutable once VERSIONED; AUTHORED is the drafting
 * state).
 */
export function saveRiskRuleDraftDefinition(db: DurableDatabase, ruleId: string, definition: RiskRuleDefinition): void {
  const updated = db
    .prepare(`UPDATE risk_rules SET definition = ? WHERE rule_id = ? AND state = 'AUTHORED'`)
    .run(canonicalJson(definition), ruleId);
  if (updated.changes !== 1) {
    throw new TypeError(`risk store: rule ${ruleId} draft not found`);
  }
}

/**
 * Find a rule version row (version 0 = the AUTHORED draft).
 *
 * Source: the versioned rule definition (lines 98-100).
 */
export function findRiskRule(db: DurableDatabase, ruleId: string, version: number): RiskRuleRecord | undefined {
  const row = db
    .prepare(`SELECT rule_id, version, state, definition, created_wall_ms, created_seq, state_wall_ms, state_seq FROM risk_rules WHERE rule_id = ? AND version = ?`)
    .get(ruleId, version) as RuleRow | undefined;
  return row === undefined ? undefined : ruleFromRow(row);
}

/**
 * Find the open AUTHORED draft of a rule id.
 *
 * Source: the AUTHORED state of the rule lifecycle (line 100).
 */
export function findRiskRuleDraft(db: DurableDatabase, ruleId: string): RiskRuleRecord | undefined {
  const row = db
    .prepare(`SELECT rule_id, version, state, definition, created_wall_ms, created_seq, state_wall_ms, state_seq FROM risk_rules WHERE rule_id = ? AND state = 'AUTHORED'`)
    .get(ruleId) as RuleRow | undefined;
  return row === undefined ? undefined : ruleFromRow(row);
}

/**
 * The next version for a rule id: 1 + the highest recorded published
 * version, or 1 for a new rule identity. Deterministic over recorded
 * state.
 *
 * Source: the versioned rule lifecycle (lines 98-100 — versions are
 * assigned at publish).
 */
export function nextRiskRuleVersion(db: DurableDatabase, ruleId: string): number {
  const row = db
    .prepare(`SELECT MAX(version) AS max_version FROM risk_rules WHERE rule_id = ?`)
    .get(ruleId) as { max_version: number | null };
  return row.max_version === null ? 1 : row.max_version + 1;
}

/**
 * List the rule versions currently in a given state (e.g. ACTIVE — the
 * live evaluation rule set), in canonical (rule id, version) order.
 *
 * Source: the ACTIVE state of the rule lifecycle (line 100) feeding
 * evaluation's pinned rule sets (INV-16-1's "rule version" input).
 */
export function listRiskRulesInState(db: DurableDatabase, state: RiskRuleState): RiskRuleRecord[] {
  const rows = db
    .prepare(`SELECT rule_id, version, state, definition, created_wall_ms, created_seq, state_wall_ms, state_seq FROM risk_rules WHERE state = ? ORDER BY rule_id ASC, version ASC`)
    .all(state) as unknown as RuleRow[];
  return rows.map(ruleFromRow);
}

// ---------------------------------------------------------------------------
// Screening list rows
// ---------------------------------------------------------------------------

interface ListRow {
  readonly list_id: string;
  readonly version: number;
  readonly entries: string;
  readonly registered_wall_ms: number;
  readonly registered_seq: number;
}

function listFromRow(row: ListRow): ScreeningListRecord {
  const entries = parseJson(row.entries, 'screening list entries');
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('risk store: stored screening list entries are not a string array');
  }
  return { listId: row.list_id, version: row.version, entries };
}

/**
 * Insert a screening list version (append-only: the (list id, version) pair
 * is the primary key; re-registering a different content under a recorded
 * version is rejected). A failed refresh NEVER touches prior versions.
 *
 * Source: evidence-risk-compliance.md §2 lines 137-139 — "External list
 * updates are inputs, not effects; a failed list refresh leaves the prior
 * version active and records the failure."
 */
export function insertScreeningList(db: DurableDatabase, list: ScreeningListRecord, when: ProtocolTime): void {
  assertWhen(when, 'when');
  try {
    db.prepare(
      `INSERT INTO screening_lists (list_id, version, entries, registered_wall_ms, registered_seq) VALUES (?, ?, ?, ?, ?)`,
    ).run(list.listId, list.version, canonicalJson(list.entries), when.wallMs, when.sequence);
  } catch (error) {
    throw new TypeError(
      `risk store: screening list ${list.listId}@v${list.version} is already registered (list versions are append-only; register the next version instead)`,
      { cause: error },
    );
  }
}

/**
 * Find the latest registered version of a screening list (the version a
 * refresh failure leaves active).
 *
 * Source: evidence-risk-compliance.md §2 lines 137-139 ("a failed list
 * refresh leaves the prior version active").
 */
export function findLatestScreeningList(db: DurableDatabase, listId: string): ScreeningListRecord | undefined {
  const row = db
    .prepare(`SELECT list_id, version, entries, registered_wall_ms, registered_seq FROM screening_lists WHERE list_id = ? ORDER BY version DESC LIMIT 1`)
    .get(listId) as ListRow | undefined;
  return row === undefined ? undefined : listFromRow(row);
}

/**
 * Find one exact screening list version.
 *
 * Source: the versioned screening list input of INV-16-1 (lines 124-126).
 */
export function findScreeningListVersion(
  db: DurableDatabase,
  listId: string,
  version: number,
): ScreeningListRecord | undefined {
  const row = db
    .prepare(`SELECT list_id, version, entries, registered_wall_ms, registered_seq FROM screening_lists WHERE list_id = ? AND version = ?`)
    .get(listId, version) as ListRow | undefined;
  return row === undefined ? undefined : listFromRow(row);
}

/**
 * Record a failed screening list refresh: a durable row naming the list, the
 * deterministic reason, and the prior version that remains active. Never a
 * silent guess.
 *
 * Source: evidence-risk-compliance.md §2 lines 137-139 — "a failed list
 * refresh leaves the prior version active and records the failure — never a
 * silent guess."
 */
export function recordScreeningListRefreshFailure(
  db: DurableDatabase,
  input: { readonly listId: string; readonly reason: string },
  when: ProtocolTime,
): { readonly failureId: string; readonly priorVersion: number | null } {
  assertWhen(when, 'when');
  if (typeof input.listId !== 'string' || input.listId.length === 0) {
    throw new TypeError('risk store: refresh-failure listId must be a non-empty string');
  }
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    throw new TypeError('risk store: refresh-failure reason must be a non-empty string');
  }
  const prior = findLatestScreeningList(db, input.listId);
  const failureId = deriveProtocolId('screening-refresh-failure', input.listId, input.reason, when.sequence, when.wallMs);
  db.prepare(
    `INSERT INTO screening_list_refresh_failures (failure_id, list_id, reason, prior_version, failed_wall_ms, failed_seq) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(failureId, input.listId, input.reason, prior?.version ?? null, when.wallMs, when.sequence);
  return { failureId, priorVersion: prior?.version ?? null };
}

/**
 * Count recorded refresh failures for a list (the recorded failure trail).
 *
 * Source: evidence-risk-compliance.md §2 lines 137-139.
 */
export function countScreeningListRefreshFailures(db: DurableDatabase, listId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS failures FROM screening_list_refresh_failures WHERE list_id = ?`)
    .get(listId) as { failures: number };
  return row.failures;
}

// ---------------------------------------------------------------------------
// ScreeningResult rows
// ---------------------------------------------------------------------------

interface ScreeningRow {
  readonly screening_id: string;
  readonly list_id: string;
  readonly list_version: number;
  readonly subject_data_hash: string;
  readonly state: string;
  readonly matched_entry: string | null;
  readonly created_wall_ms: number;
  readonly created_seq: number;
  readonly state_wall_ms: number;
  readonly state_seq: number;
}

function screeningFromRow(row: ScreeningRow): ScreeningResultRecord {
  const state = parseEnum(row.state, SCREENING_RESULT_STATES, 'screening result state');
  return {
    screeningId: row.screening_id,
    listId: row.list_id,
    listVersionId: `${row.list_id}@v${row.list_version}`,
    listVersion: row.list_version,
    subjectDataHash: row.subject_data_hash as ScreeningResultRecord['subjectDataHash'],
    state,
    ...(row.matched_entry === null ? {} : { matchedEntry: row.matched_entry }),
  };
}

function screeningToRow(result: ScreeningResultRecord, when: ProtocolTime): ScreeningRowValues {
  return [
    result.screeningId,
    result.listId,
    result.listVersion,
    result.subjectDataHash,
    result.state,
    result.matchedEntry ?? null,
    when.wallMs,
    when.sequence,
    when.wallMs,
    when.sequence,
  ];
}

type ScreeningRowValues = [string, string, number, string, string, string | null, number, number, number, number];

/**
 * Insert a screening result row. The UNIQUE (list id, list version, subject
 * data hash) constraint makes the input triple's recorded outcome
 * idempotent — re-computation addresses the identical row (INV-16-1 made
 * structural).
 *
 * Source: INV-16-1 (evidence-risk-compliance.md lines 124-126); the
 * per-domain persistence convention.
 */
export function insertScreeningResult(db: DurableDatabase, result: ScreeningResultRecord, when: ProtocolTime): void {
  assertWhen(when, 'when');
  db.prepare(
    `INSERT INTO screening_results (screening_id, list_id, list_version, subject_data_hash, state, matched_entry, created_wall_ms, created_seq, state_wall_ms, state_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...screeningToRow(result, when));
}

/**
 * Update a screening result row's state (COMPUTED -> CLEAR | HIT).
 *
 * Source: evidence-risk-compliance.md §2 line 111 — "COMPUTED ->
 * terminal(CLEAR | HIT)."
 */
export function saveScreeningResultState(db: DurableDatabase, result: ScreeningResultRecord, when: ProtocolTime): void {
  assertWhen(when, 'when');
  const updated = db
    .prepare(
      `UPDATE screening_results SET state = ?, matched_entry = ?, state_wall_ms = ?, state_seq = ? WHERE screening_id = ?`,
    )
    .run(result.state, result.matchedEntry ?? null, when.wallMs, when.sequence, result.screeningId);
  if (updated.changes !== 1) {
    throw new TypeError(`risk store: screening result ${result.screeningId} not found`);
  }
}

/**
 * Find the recorded screening result for an exact input triple (list id,
 * list version, subject data hash) — the idempotency read.
 *
 * Source: INV-16-1 (identical inputs, identical recorded outcome).
 */
export function findScreeningResult(
  db: DurableDatabase,
  listId: string,
  listVersion: number,
  subjectDataHash: string,
): ScreeningResultRecord | undefined {
  const row = db
    .prepare(`SELECT screening_id, list_id, list_version, subject_data_hash, state, matched_entry, created_wall_ms, created_seq, state_wall_ms, state_seq FROM screening_results WHERE list_id = ? AND list_version = ? AND subject_data_hash = ?`)
    .get(listId, listVersion, subjectDataHash) as ScreeningRow | undefined;
  return row === undefined ? undefined : screeningFromRow(row);
}

// ---------------------------------------------------------------------------
// ComplianceCheck rows
// ---------------------------------------------------------------------------

interface CheckRow {
  readonly check_id: string;
  readonly subject_id: string;
  readonly subject_kind: string;
  readonly rule_set_version: string;
  readonly screening_list_version_id: string;
  readonly subject_data_hash: string;
  readonly state: string;
  readonly evaluation: string;
  readonly review: string | null;
  readonly created_wall_ms: number;
  readonly created_seq: number;
  readonly state_wall_ms: number;
  readonly state_seq: number;
}

function checkFromRow(row: CheckRow): ComplianceCheckRecord {
  const state = parseEnum(row.state, COMPLIANCE_CHECK_STATES, 'compliance check state');
  const review =
    row.review === null ? undefined : (parseJson(row.review, 'compliance review') as ComplianceReviewRecord);
  return {
    checkId: row.check_id,
    subjectId: row.subject_id,
    subjectKind: parseEnum(row.subject_kind, SUBJECT_KINDS, 'subject kind'),
    ruleSetVersion: row.rule_set_version as ComplianceCheckRecord['ruleSetVersion'],
    screeningListVersionId: row.screening_list_version_id,
    subjectDataHash: row.subject_data_hash as ComplianceCheckRecord['subjectDataHash'],
    state,
    evaluation: parseJson(row.evaluation, 'compliance evaluation') as ComplianceEvaluation,
    createdAt: protocolTime(row.created_seq, row.created_wall_ms),
    stateChangedAt: protocolTime(row.state_seq, row.state_wall_ms),
    ...(review === undefined ? {} : { review }),
  };
}

/**
 * Insert a new EVALUATED compliance check. The derived check id is the
 * primary key — the INV-16-4 keying (subject id, rule set version) made
 * structural: a second evaluation of the same pair addresses the identical
 * row and is rejected here, returning instead the recorded result.
 *
 * Source: INV-16-4 (evidence-risk-compliance.md lines 133-134) — "check ids
 * are keyed by (subject id, rule set version); re-evaluation returns the
 * recorded result."
 */
export function insertComplianceCheck(db: DurableDatabase, check: ComplianceCheckRecord): void {
  db.prepare(
    `INSERT INTO compliance_checks (check_id, subject_id, subject_kind, rule_set_version, screening_list_version_id, subject_data_hash, state, evaluation, review, created_wall_ms, created_seq, state_wall_ms, state_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    check.checkId,
    check.subjectId,
    check.subjectKind,
    check.ruleSetVersion,
    check.screeningListVersionId,
    check.subjectDataHash,
    check.state,
    canonicalJson(check.evaluation),
    check.review === undefined ? null : canonicalJson(check.review),
    check.createdAt.wallMs,
    check.createdAt.sequence,
    check.stateChangedAt.wallMs,
    check.stateChangedAt.sequence,
  );
}

/**
 * Persist a check's current state and review (the decision persistence
 * step).
 *
 * Source: the check lifecycle (evidence-risk-compliance.md §2 lines
 * 104-107); the per-domain persistence convention.
 */
export function saveComplianceCheckState(db: DurableDatabase, check: ComplianceCheckRecord): void {
  const updated = db
    .prepare(
      `UPDATE compliance_checks SET state = ?, review = ?, state_wall_ms = ?, state_seq = ? WHERE check_id = ?`,
    )
    .run(
      check.state,
      check.review === undefined ? null : canonicalJson(check.review),
      check.stateChangedAt.wallMs,
      check.stateChangedAt.sequence,
      check.checkId,
    );
  if (updated.changes !== 1) {
    throw new TypeError(`risk store: compliance check ${check.checkId} not found`);
  }
}

/**
 * Find a check by its derived id — the idempotency read of INV-16-4.
 *
 * Source: INV-16-4 (lines 133-134).
 */
export function findComplianceCheck(db: DurableDatabase, checkId: string): ComplianceCheckRecord | undefined {
  const row = db
    .prepare(`SELECT check_id, subject_id, subject_kind, rule_set_version, screening_list_version_id, subject_data_hash, state, evaluation, review, created_wall_ms, created_seq, state_wall_ms, state_seq FROM compliance_checks WHERE check_id = ?`)
    .get(checkId) as CheckRow | undefined;
  return row === undefined ? undefined : checkFromRow(row);
}

/**
 * List every check recorded for a subject (all kinds), in canonical check-id
 * order — the gate's read set.
 *
 * Source: INV-16-3 (evidence-risk-compliance.md lines 129-131 — the gate
 * consults the checks for the subject).
 */
export function listComplianceChecksForSubject(db: DurableDatabase, subjectId: string): ComplianceCheckRecord[] {
  const rows = db
    .prepare(`SELECT check_id, subject_id, subject_kind, rule_set_version, screening_list_version_id, subject_data_hash, state, evaluation, review, created_wall_ms, created_seq, state_wall_ms, state_seq FROM compliance_checks WHERE subject_id = ? ORDER BY check_id ASC`)
    .all(subjectId) as unknown as CheckRow[];
  return rows.map(checkFromRow);
}
