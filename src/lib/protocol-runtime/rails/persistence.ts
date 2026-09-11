/**
 * RTN-004 — Rails: per-domain persistence (the RTN-001 convention, applied).
 *
 * THE CONVENTION (decided in RTN-001 — spec/protocol-runtime-work-orders/
 * README.md, "Persistence convention"):
 *
 *   "each authority domain owns its schema and per-domain migrations inside
 *    its owned prefix, using the DEP-003 database layer read-only."
 *
 * rtn-plan-rulings.md Q1 / delta 1 (binding): "The rails/ surface
 * implements the A13/A14 state machines as authority state under the
 * RTN-001 per-domain persistence convention."
 *
 * v0.1 permission — spec/architecture/v0.1/README.md §9, lines 173-174:
 *   "This directory defines semantics only; it intentionally prescribes no
 *    implementation, storage, or service decomposition."
 *
 * Mechanically this module mirrors the kernel's persistence.ts exactly
 * (the reference pattern):
 *   1. the rails domain store is ONE SQLite database opened through the
 *      substrate's `openDurableDatabase({ dbPath, migrationsDir })` (WAL,
 *      synchronous=FULL, busy_timeout, explicit migration runner with
 *      sha256 content checksums);
 *   2. the migrations live in src/lib/protocol-runtime/rails/migrations/
 *      (NOT in the shared deploy/migrations/ — parallel sibling domains
 *      must never collide);
 *   3. the domain uses its own database file (default var/rails.sqlite).
 *
 * DEP-003 integration is READ-ONLY: imports the db API from
 * src/lib/durable/db.ts and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';

/**
 * Default filesystem path of the rails-domain store, relative to the
 * process working directory (mirrors the kernel's var/kernel.sqlite
 * default). var/ is a runtime artifact directory and is gitignored
 * ("Data is never committed" — spec/durable/execution.md §2).
 */
export const DEFAULT_RAILS_DB_PATH = 'var/rails.sqlite';

/**
 * Environment variable overriding the rails migrations directory (mirrors
 * the kernel's PAYSWAP_KERNEL_MIGRATIONS_DIR and the substrate's
 * PAYSWAP_MIGRATIONS_DIR).
 */
export const RAILS_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_RAILS_MIGRATIONS_DIR';

/** The rails domain's owned migration directory, relative to the repository root. */
export const RAILS_MIGRATIONS_RELATIVE_DIR = join(
  'src',
  'lib',
  'protocol-runtime',
  'rails',
  'migrations',
);

/** The rails domain's owner identity. */
export const RAILS_STORE_DOMAIN = 'protocol-runtime-rails';

/**
 * Resolve the rails migrations directory:
 *   1. an explicit argument (tests and deployments);
 *   2. PAYSWAP_RAILS_MIGRATIONS_DIR from the environment;
 *   3. the first `src/lib/protocol-runtime/rails/migrations` found walking
 *      up from the process working directory (up to 8 levels);
 *   4. the cwd-relative fallback (which then fails closed inside the
 *      runner with a precise error, exactly like the substrate).
 *
 * Source: the per-domain persistence convention (kernel persistence.ts is
 * the reference pattern; same resolution strategy as
 * src/lib/durable/db.ts resolveMigrationsDir).
 */
export function resolveRailsMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[RAILS_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, RAILS_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), RAILS_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the rails-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions.
 */
export interface RailsStoreOptions {
  /**
   * Filesystem path of the rails-domain SQLite database file.
   * Default: var/rails.sqlite (created on demand; never committed).
   * `:memory:` is accepted for experiments and tests only (not durable,
   * WAL unavailable) — same rule as the substrate.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveRailsMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the rails-domain store THROUGH the DEP-003 database layer (read-only
 * integration): opens the SQLite database with the substrate's crash-safety
 * pragmas and applies the rails migrations from
 * src/lib/protocol-runtime/rails/migrations/ via the substrate's migration
 * runner.
 *
 * Source: rtn-plan-rulings.md Q1 (delta 1) — "The rails/ surface implements
 * the A13/A14 state machines as authority state under the RTN-001
 * per-domain persistence convention"; spec/protocol-runtime-work-orders/
 * README.md "Persistence convention"; kernel persistence.ts (the reference
 * pattern).
 */
export function openRailsStore(options: RailsStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_RAILS_DB_PATH,
    migrationsDir: resolveRailsMigrationsDir(options.migrationsDir),
  });
}
