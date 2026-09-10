/**
 * DEP-003 — Durable execution substrate: SQLite bootstrap + migration runner.
 *
 * Opens the durable database through Node's built-in `node:sqlite`
 * (DatabaseSync — zero npm dependencies) at the path configured by
 * PAYSWAP_DURABLE_DB (default: `var/durable.sqlite`, created on demand,
 * never committed). Applies the crash-safety pragmas
 * (journal_mode=WAL, synchronous=FULL, busy_timeout) and then applies any
 * pending migrations from `deploy/migrations`:
 *   - applied in ascending filename order (numeric prefix must be strictly
 *     monotonic),
 *   - each migration runs inside its own BEGIN IMMEDIATE transaction,
 *   - the applied set is recorded in `schema_migrations` together with a
 *     sha256 content checksum, so a delivered migration is immutable: a
 *     changed or deleted applied migration fails loudly, and re-running the
 *     runner is a no-op.
 *
 * This module is server-side only (Node runtime; never import from client
 * components). It stores no financial authority — it is pure infrastructure.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';

/** Relative (to cwd) default database location; its directory is created on demand. */
export const DEFAULT_DURABLE_DB_PATH = 'var/durable.sqlite';

/** Environment variable that overrides the durable database location. */
export const DURABLE_DB_ENV_VAR = 'PAYSWAP_DURABLE_DB';

/** Environment variable that overrides the migrations directory location. */
export const DURABLE_MIGRATIONS_ENV_VAR = 'PAYSWAP_MIGRATIONS_DIR';

export interface DurableDatabaseOptions {
  /**
   * Filesystem path of the SQLite database file.
   * Default: PAYSWAP_DURABLE_DB environment variable, else `var/durable.sqlite`.
   * `:memory:` is accepted for experiments only (not durable, WAL unavailable).
   */
  dbPath?: string;
  /**
   * Directory containing the ordered `*.sql` migrations.
   * Default: PAYSWAP_MIGRATIONS_DIR environment variable, else the first
   * `deploy/migrations` found by walking up from the process cwd.
   */
  migrationsDir?: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: number;
}

export interface MigrationRunResult {
  /** Migrations applied by this run (empty on a no-op re-run). */
  applied: AppliedMigration[];
  /** Migrations already recorded before this run (verified immutable). */
  verified: number;
}

/** Handle around a single opened SQLite database (WAL, synchronous=FULL). */
export interface DurableDatabase {
  readonly sqlite: DatabaseSync;
  /** Absolute path of the database file (or `:memory:`). */
  readonly path: string;
  /** Absolute path of the migrations directory that was used. */
  readonly migrationsDir: string;
  /** Cached statement compilation. */
  prepare(sql: string): StatementSync;
  /** Execute a statement that returns no rows (SQL text must be a static literal). */
  exec(sql: string): void;
  isOpen(): boolean;
  close(): void;
  appliedMigrations(): AppliedMigration[];
}

/** Raised for migration-ordering, immutability, or application failures. */
export class DurableMigrationError extends Error {
  override readonly name = 'DurableMigrationError';
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export function getDurableDbPath(): string {
  const fromEnv = process.env[DURABLE_DB_ENV_VAR];
  const raw =
    typeof fromEnv === 'string' && fromEnv.trim().length > 0
      ? fromEnv.trim()
      : DEFAULT_DURABLE_DB_PATH;
  return raw === ':memory:' ? raw : resolve(raw);
}

export function resolveMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[DURABLE_MIGRATIONS_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'deploy', 'migrations');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), 'deploy', 'migrations');
}

interface MigrationFile {
  name: string;
  content: string;
  checksum: string;
}

function listMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!existsSync(migrationsDir)) {
    throw new DurableMigrationError(
      `migrations directory not found: ${migrationsDir} (set ${DURABLE_MIGRATIONS_ENV_VAR} to override)`,
    );
  }
  const names = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (names.length === 0) {
    throw new DurableMigrationError(`no *.sql migrations found in ${migrationsDir}`);
  }
  const files: MigrationFile[] = [];
  let previousOrder = -1;
  for (const name of names) {
    const match = /^(\d+)_/.exec(name);
    if (!match) {
      throw new DurableMigrationError(
        `migration filename must start with a numeric order prefix: ${name}`,
      );
    }
    const order = Number.parseInt(match[1] as string, 10);
    if (order <= previousOrder) {
      throw new DurableMigrationError(
        `migration order is not strictly monotonic: ${name} (previous order: ${previousOrder})`,
      );
    }
    previousOrder = order;
    const content = readFileSync(join(migrationsDir, name), 'utf8').replace(/^\uFEFF/, '');
    const checksum = createHash('sha256').update(content).digest('hex');
    files.push({ name, content, checksum });
  }
  return files;
}

const SQL_READ_APPLIED = "SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name";
const SQL_RECORD_APPLIED = "INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)";
const SCHEMA_MIGRATIONS_DDL =
  "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)";

/**
 * Explicit migration runner. Safe to call repeatedly:
 * applied migrations are skipped (no-op), their content checksums are
 * verified (immutability), and each new migration is applied inside its own
 * transaction with the applied_at timestamp recorded in schema_migrations.
 */
export function runMigrations(sqlite: DatabaseSync, migrationsDir: string): MigrationRunResult {
  sqlite.exec(SCHEMA_MIGRATIONS_DDL);
  const rows = sqlite.prepare(SQL_READ_APPLIED).all() as Array<Record<string, unknown>>;
  const appliedByName = new Map<string, { checksum: string; appliedAt: number }>();
  for (const row of rows) {
    appliedByName.set(String(row.name), {
      checksum: String(row.checksum),
      appliedAt: Number(row.applied_at),
    });
  }
  const files = listMigrationFiles(migrationsDir);
  for (const [name, record] of appliedByName) {
    const file = files.find((candidate) => candidate.name === name);
    if (!file) {
      throw new DurableMigrationError(
        `applied migration is missing from the directory (history regression): ${name}`,
      );
    }
    if (file.checksum !== record.checksum) {
      throw new DurableMigrationError(
        `applied migration content changed (migrations are immutable once delivered): ${name}`,
      );
    }
  }
  const newlyApplied: AppliedMigration[] = [];
  for (const file of files) {
    if (appliedByName.has(file.name)) {
      continue;
    }
    const appliedAt = Date.now();
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(file.content);
      sqlite.prepare(SQL_RECORD_APPLIED).run(file.name, file.checksum, appliedAt);
      sqlite.exec("COMMIT");
    } catch (error) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // connection already closed or transaction already rolled back
      }
      throw new DurableMigrationError(
        `migration failed: ${file.name}: ${describeError(error)}`,
      );
    }
    newlyApplied.push({ name: file.name, checksum: file.checksum, appliedAt });
  }
  return { applied: newlyApplied, verified: appliedByName.size };
}

function firstColumnValue(row: Record<string, unknown> | undefined): unknown {
  if (!row) {
    return undefined;
  }
  const values = Object.values(row);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * Open (and migrate) the durable database.
 *
 * Guarantees on return:
 *   - WAL journaling is active (file-backed databases),
 *   - synchronous=FULL is set on this connection,
 *   - busy_timeout=5000 is set on this connection,
 *   - all pending migrations are applied and recorded.
 */
export function openDurableDatabase(options: DurableDatabaseOptions = {}): DurableDatabase {
  const rawPath =
    typeof options.dbPath === 'string' && options.dbPath.length > 0
      ? options.dbPath
      : getDurableDbPath();
  const isMemory = rawPath === ':memory:';
  const dbPath = isMemory ? rawPath : resolve(rawPath);
  const migrationsDir = resolveMigrationsDir(options.migrationsDir);

  if (!isMemory) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new DatabaseSync(dbPath);
  let open = true;

  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = FULL");
  if (!isMemory) {
    const journalRow = sqlite.prepare("PRAGMA journal_mode").get() as Record<string, unknown> | undefined;
    const journalMode = firstColumnValue(journalRow);
    if (String(journalMode).toLowerCase() !== 'wal') {
      sqlite.close();
      open = false;
      throw new Error(
        `durable database failed to enable WAL journal_mode (got: ${String(journalMode)}) at ${dbPath}`,
      );
    }
  }
  const synchronousRow = sqlite.prepare("PRAGMA synchronous").get() as Record<string, unknown> | undefined;
  const synchronousMode = firstColumnValue(synchronousRow);
  if (Number(synchronousMode) !== 2) {
    sqlite.close();
    open = false;
    throw new Error(
      `durable database failed to set synchronous=FULL (got: ${String(synchronousMode)}) at ${dbPath}`,
    );
  }

  runMigrations(sqlite, migrationsDir);

  const statements = new Map<string, StatementSync>();
  const assertOpen = (): void => {
    if (!open) {
      throw new Error(`durable database is closed: ${dbPath}`);
    }
  };

  return {
    sqlite,
    path: dbPath,
    migrationsDir,
    prepare(sql: string): StatementSync {
      assertOpen();
      let statement = statements.get(sql);
      if (!statement) {
        statement = sqlite.prepare(sql);
        statements.set(sql, statement);
      }
      return statement;
    },
    exec(sql: string): void {
      assertOpen();
      sqlite.exec(sql);
    },
    isOpen(): boolean {
      return open;
    },
    close(): void {
      if (!open) {
        return;
      }
      open = false;
      statements.clear();
      sqlite.close();
    },
    appliedMigrations(): AppliedMigration[] {
      assertOpen();
      const rows = sqlite.prepare(SQL_READ_APPLIED).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        name: String(row.name),
        checksum: String(row.checksum),
        appliedAt: Number(row.applied_at),
      }));
    },
  };
}
