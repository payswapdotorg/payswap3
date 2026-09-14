/**
 * PC-001 — Governance validation: no console-owned source file imports
 * financial persistence or authority writers.
 *
 * Mechanically scans EVERY source file under the PC-001..PC-005 owned
 * console roots:
 *   - src/lib/console/
 *   - src/app/console/
 *   - src/app/api/console/
 *   - src/components/console/
 *
 * FORBIDDEN import roots (derived from the PC-001 authority inventory —
 * spec/console/PC-001-evidence.md):
 *   1. `src/lib/durable/` — the durable substrate (node:sqlite database,
 *      durable queue/events/scheduler/worker): the console must never touch
 *      financial persistence directly.
 *   2. `src/lib/protocol-runtime/<area>/persistence` — every protocol-runtime
 *      persistence module (kernel, intent, evidence, capability, gateway,
 *      policy, routing, credit, obligations, clearing, queues, netting,
 *      rails, risk, liquidity, reservations, settlement).
 *   3. `src/lib/protocol-runtime/gateway/` — the protocol gateway COMMAND
 *      surface (ProtocolGateway.submitCommand admission): console commands
 *      (if any ever exist) must traverse product/protocol boundaries, never
 *      the raw gateway from console code.
 *   4. `src/lib/protocol-runtime/<area>/authority` — authority command modules
 *      (register/activate/transition command methods that bypass gateway
 *      admission).
 *   5. `src/lib/protocol-runtime/hosting/` and
 *      `src/lib/protocol-runtime/transition/` — the dequeue-side execution
 *      path and authority command bindings.
 *   6. Direct DB/persistence CLIENTS (bare specifiers): node:sqlite,
 *      sqlite3, better-sqlite3, pg, postgres, mysql, mysql2, mongodb,
 *      mongoose, redis, ioredis, prisma, @prisma/client, drizzle-orm,
 *      kysely, typeorm, sequelize, mssql, oracledb.
 *
 * ALLOWED (recorded, not forbidden): the sanctioned protocol read path
 * `src/lib/protocol/*-port.ts` port modules and the server composition
 * seam `src/lib/protocol/server-composition.ts` (the same imports existing
 * product routes use — see src/app/api/mediation/record/route.ts), plus
 * pure read/type modules of protocol-runtime that do not cross into
 * persistence. When in doubt this scan FORBIDS and the case is recorded for
 * the Tech Lead — it never silently allows.
 *
 * This mirrors the repository's existing RTN-010 boundary-review style
 * (src/lib/protocol-runtime/gateway/boundary.test.ts): a test-time scan of
 * the real source tree, comments and strings stripped so documentation
 * wording can neither trigger nor mask a violation.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

/** The console-owned roots this governance scan protects. */
const CONSOLE_ROOTS: readonly string[] = [
  'src/lib/console',
  'src/app/console',
  'src/app/api/console',
  'src/components/console',
];

/** Direct DB/persistence client specifiers (bare imports). */
const DB_CLIENT_SPECIFIERS: readonly string[] = [
  'node:sqlite',
  'node:sqlite3',
  'sqlite3',
  'better-sqlite3',
  'pg',
  'postgres',
  'mysql',
  'mysql2',
  'mariadb',
  'mongodb',
  'mongoose',
  'redis',
  'ioredis',
  'prisma',
  '@prisma/client',
  'drizzle-orm',
  'kysely',
  'typeorm',
  'sequelize',
  'mssql',
  'oracledb',
];

function walk(dir: string, visit: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') {
      continue;
    }
    const path = join(dir, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(path, visit);
    } else {
      visit(path);
    }
  }
}

function sourceFilesUnder(rootRelative: string): string[] {
  const files: string[] = [];
  walk(join(REPO_ROOT, rootRelative), (path) => {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      files.push(path);
    }
  });
  return files;
}

/** Strip comments (string literals are KEPT — import specifiers live in strings). */
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** All static/dynamic import specifiers in a source file (code only). */
function importSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  const patterns = [/from\s+'([^']+)'/g, /from\s+"([^"]+)"/g, /import\s*\(\s*'([^']+)'\s*\)/g, /require\s*\(\s*'([^']+)'\s*\)/g];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolve an import specifier to a repo-relative path (posix), or null for
 * bare/external specifiers.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return posix.join('src', specifier.slice(2));
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const fromDir = posix.dirname(fromFile);
    return posix.normalize(posix.join(fromDir, specifier));
  }
  return null; // bare specifier (bun:test, react, next/*, DB clients...)
}

/** Is this resolved repo path a forbidden financial persistence/writer root? */
function isForbiddenPath(resolved: string): string | null {
  // 1. The durable substrate.
  if (resolved === 'src/lib/durable' || resolved.startsWith('src/lib/durable/')) {
    return 'durable substrate (src/lib/durable/)';
  }
  if (resolved.startsWith('src/lib/protocol-runtime/')) {
    const segments = resolved.split('/');
    const stem = (segments[segments.length - 1] ?? '').replace(/\.(ts|tsx)$/, '');
    // 2. Any protocol-runtime persistence module.
    if (stem === 'persistence' || resolved.includes('/persistence/')) {
      return `protocol-runtime persistence (${resolved})`;
    }
    // 3. The gateway command surface.
    if (
      resolved === 'src/lib/protocol-runtime/gateway' ||
      resolved.startsWith('src/lib/protocol-runtime/gateway/')
    ) {
      return `protocol gateway command surface (${resolved})`;
    }
    // 4. Authority command modules.
    if (stem === 'authority') {
      return `protocol-runtime authority command module (${resolved})`;
    }
    // 5. The dequeue-side execution path and command bindings.
    if (
      resolved.startsWith('src/lib/protocol-runtime/hosting/') ||
      resolved.startsWith('src/lib/protocol-runtime/transition/')
    ) {
      return `protocol-runtime execution/bindings (${resolved})`;
    }
  }
  return null;
}

describe('PC-001 governance — console code never imports financial persistence or authority writers', () => {
  test('the console-owned roots exist and are scanned', () => {
    for (const root of CONSOLE_ROOTS) {
      const files = sourceFilesUnder(root);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  test('no console-owned file imports a forbidden root (persistence, gateway commands, authorities, durable, DB clients)', () => {
    const offenders: string[] = [];
    for (const root of CONSOLE_ROOTS) {
      for (const file of sourceFilesUnder(root)) {
        const relative = file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const specifier of importSpecifiers(code)) {
          // 6. Direct DB/persistence clients (bare specifiers).
          if (DB_CLIENT_SPECIFIERS.includes(specifier)) {
            offenders.push(`${relative}: bare DB client '${specifier}'`);
            continue;
          }
          const resolved = resolveSpecifier(relative, specifier);
          if (resolved === null) {
            continue;
          }
          const forbidden = isForbiddenPath(resolved);
          if (forbidden) {
            offenders.push(`${relative}: imports ${forbidden} via '${specifier}'`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('manual import inspection agrees: zero forbidden references across all console files', () => {
    // Cross-check with a plain substring sweep over the RAW source (comments
    // included) so a masked import (e.g. inside a string-built specifier)
    // still surfaces for human review. Any hit here is a review flag even if
    // the structured scan above is clean. The governance scan file itself is
    // excluded from this RAW sweep (its own marker vocabulary is the scan,
    // not an import) — the structured scan above still covers its imports.
    const GOVERNANCE_SCAN_FILE = 'src/lib/console/governance.test.ts';
    const reviewFlags: string[] = [];
    for (const root of CONSOLE_ROOTS) {
      for (const file of sourceFilesUnder(root)) {
        const relative = file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
        if (relative === GOVERNANCE_SCAN_FILE) {
          continue;
        }
        const raw = readFileSync(file, 'utf8');
        for (const marker of ['@/lib/durable', 'protocol-runtime/gateway', '/persistence', 'node:sqlite', '@prisma/client', 'drizzle-orm']) {
          if (raw.includes(marker)) {
            reviewFlags.push(`${relative}: raw reference to '${marker}' — review`);
          }
        }
      }
    }
    expect(reviewFlags).toEqual([]);
  });
});
