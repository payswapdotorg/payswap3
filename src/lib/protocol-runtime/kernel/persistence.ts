/**
 * RTN-001 — Protocol runtime kernel: the per-domain persistence convention.
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
 * §9, lines 173-174:
 *   "This directory defines semantics only; it intentionally prescribes no
 *    implementation, storage, or service decomposition."
 *
 * Mechanically, the convention composes the DEP-003 substrate read-only
 * (spec/durable/execution.md §4 "Migrations", lines 77-97, and §2
 * "Configuration", lines 40-47):
 *
 *   1. A domain store is ONE SQLite database opened through the substrate's
 *      `openDurableDatabase({ dbPath, migrationsDir })` — the substrate
 *      supplies WAL journaling, synchronous=FULL, busy_timeout, and the
 *      explicit migration runner (`schema_migrations` bookkeeping with
 *      sha256 content checksums, immutability of delivered migrations,
 *      no-op re-runs).
 *   2. The domain's migrations live in `<owned-prefix>/migrations/` (for
 *      the kernel: src/lib/protocol-runtime/kernel/migrations/), NOT in the
 *      shared deploy/migrations/ — parallel sibling domains must never
 *      collide on one migration directory, and no domain ever edits
 *      src/lib/durable/.
 *   3. Each domain uses its own database file (the kernel's default is
 *      var/kernel.sqlite, mirroring the substrate's var/durable.sqlite) so
 *      domains stay fully disjoint at the storage layer while sharing the
 *      one migration-runner implementation.
 *
 * This module is the kernel's demonstration of the convention
 * (openKernelStore + resolveKernelMigrationsDir + the kernel migration
 * directory), and the template every later authority domain follows.
 *
 * DEP-003 integration is READ-ONLY: this module imports the db API from
 * src/lib/durable/db.ts (the individually plain-Node-loadable module — see
 * src/lib/durable/index.ts lines 22-25) and never modifies the substrate.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDurableDatabase } from '../../durable/db.ts';
import type { DurableDatabase } from '../../durable/db.ts';

/**
 * Default filesystem path of the kernel-domain store, relative to the
 * process working directory (mirrors the substrate's var/durable.sqlite
 * default; spec/durable/execution.md §2 lines 40-43). var/ is a runtime
 * artifact directory and is gitignored ("Data is never committed").
 */
export const DEFAULT_KERNEL_DB_PATH = 'var/kernel.sqlite';

/**
 * Environment variable overriding the kernel migrations directory
 * (mirrors the substrate's PAYSWAP_MIGRATIONS_DIR, spec/durable/execution.md
 * §2 lines 44-47). Packaging note: in a deployed image the migrations
 * directory must ship with the application (or be pointed at via this
 * variable) — the runner fails closed when it cannot find migrations.
 */
export const KERNEL_MIGRATIONS_DIR_ENV_VAR = 'PAYSWAP_KERNEL_MIGRATIONS_DIR';

/** The kernel domain's owned migration directory, relative to the repository root. */
export const KERNEL_MIGRATIONS_RELATIVE_DIR = join('src', 'lib', 'protocol-runtime', 'kernel', 'migrations');

/** The kernel domain's owner identity (for rows the kernel itself records). */
export const KERNEL_STORE_DOMAIN = 'protocol-runtime-kernel';

/**
 * Resolve the kernel migrations directory:
 *   1. an explicit argument (tests and deployments);
 *   2. PAYSWAP_KERNEL_MIGRATIONS_DIR from the environment;
 *   3. the first `src/lib/protocol-runtime/kernel/migrations` found walking
 *      up from the process working directory (up to 8 levels) — the same
 *      walk-up strategy the substrate uses for deploy/migrations
 *      (src/lib/durable/db.ts resolveMigrationsDir);
 *   4. the cwd-relative fallback (which then fails closed inside the runner
 *      with a precise error, exactly like the substrate).
 *
 * Source: DEP-003 migration conventions (spec/durable/execution.md §2/§4);
 * the per-domain convention (spec/protocol-runtime-work-orders/README.md
 * "Persistence convention").
 */
export function resolveKernelMigrationsDir(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) {
    return resolve(explicit);
  }
  const fromEnv = process.env[KERNEL_MIGRATIONS_DIR_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return resolve(fromEnv.trim());
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, KERNEL_MIGRATIONS_RELATIVE_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(process.cwd(), KERNEL_MIGRATIONS_RELATIVE_DIR);
}

/**
 * Options for opening the kernel-domain store.
 *
 * Source: the per-domain persistence convention; option shape mirrors the
 * substrate's DurableDatabaseOptions (src/lib/durable/db.ts).
 */
export interface KernelStoreOptions {
  /**
   * Filesystem path of the kernel-domain SQLite database file.
   * Default: var/kernel.sqlite (created on demand; never committed).
   * `:memory:` is accepted for experiments only (not durable, WAL
   * unavailable) — same rule as the substrate.
   */
  dbPath?: string;
  /** Explicit migrations directory. Default: resolveKernelMigrationsDir(). */
  migrationsDir?: string;
}

/**
 * Open the kernel-domain store THROUGH the DEP-003 database layer (read-only
 * integration): opens the SQLite database with the substrate's crash-safety
 * pragmas (WAL, synchronous=FULL, busy_timeout) and applies the kernel's
 * pending migrations from src/lib/protocol-runtime/kernel/migrations/ via
 * the substrate's migration runner. This is the demonstration of — and the
 * template for — the per-domain persistence convention.
 *
 * Guarantees on return (inherited from the substrate's openDurableDatabase):
 * WAL journaling active (file-backed), synchronous=FULL on the connection,
 * busy_timeout=5000, and all pending kernel migrations applied and recorded
 * in schema_migrations.
 *
 * Source: spec/protocol-runtime-work-orders/README.md "Persistence
 * convention"; spec/durable/execution.md §3/§4; RTN-001.md line 18
 * ("a kernel-owned store opens via the DEP-003 db module with a migration
 * directory inside the kernel prefix").
 */
export function openKernelStore(options: KernelStoreOptions = {}): DurableDatabase {
  return openDurableDatabase({
    dbPath: options.dbPath ?? DEFAULT_KERNEL_DB_PATH,
    migrationsDir: resolveKernelMigrationsDir(options.migrationsDir),
  });
}
