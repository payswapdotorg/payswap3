#!/usr/bin/env node
/**
 * DEP-006 — promotion tool (repo-local, fail-closed, zero npm dependencies).
 *
 * Implements the promotion contract of spec/deployment/ci-cd.md as four
 * auditable subcommands:
 *
 *   node scripts/promote.mjs record
 *       Freezes an exact immutable revision — commit SHA, commit subject,
 *       tree digest (git rev-parse HEAD^{tree}), a content digest over the
 *       tracked file set — plus the gate table from a FRESH
 *       scripts/run_ci_gates.mjs run — as an append-only JSONL entry in
 *       deploy/promotions/promotion-records.jsonl. A record with ANY failed
 *       gate is REFUSED (exit non-zero, nothing appended). A dirty working
 *       tree is refused (the frozen digest must be reproducible at the
 *       recorded SHA). A resolved PAYSWAP_ENV=production context is refused:
 *       production deployment binding is FUTURE-WORK and the
 *       `production_gate` contract in deploy/contracts/components.json stays
 *       authoritative — this tool records and verifies evidence, it never
 *       performs an unverified production promotion.
 *
 *   node scripts/promote.mjs migrate <record-id>
 *       The migration gate: runs the repository's own migration runner
 *       (`runMigrations` from src/lib/durable/db.ts) against a THROWAWAY
 *       copy of the durable database (or a fresh throwaway file when no
 *       database exists yet), verifies the schema_migrations applied set and
 *       sha256 content checksums against the migration files on disk, and
 *       appends a migration-audit entry to the record's audit trail. The
 *       real database is NEVER opened for write — it is migrated by the
 *       deploy step, not by the promotion tool.
 *
 *   node scripts/promote.mjs verify <record-id>
 *       Re-checks a record: creates a temporary git worktree at the recorded
 *       commit SHA, installs the locked dependency graph, recomputes the
 *       content digest over that checkout, re-runs the full gate battery
 *       there, and compares the re-run gate table against the recorded one
 *       (byte-identical for deterministic gates; wall times exempt, and the
 *       build gate's stdout digest exempt — next build embeds tool timing
 *       lines; the build ARTIFACT determinism is proven separately by the
 *       package-snapshot digests).
 *
 *   node scripts/promote.mjs rollback-plan <record-id>
 *       EMITS a rollback plan (JSON on stdout) honoring topology.md
 *       principles R1–R5: redeploy the previous record's artifact revision;
 *       in-flight commands replay from the durable command queue; finality
 *       is NEVER reversed; external-effect safety means the plan may only
 *       re-drive idempotent, explicitly-retryable pre-effect submissions
 *       (UNKNOWN is never retried — the DEP-005 rail retry contract) and it
 *       lists — never executes — post-effect cases routed to
 *       protocol-governed recourse. The tool PLANS rollback; it performs no
 *       external effects.
 *
 * Entry types in deploy/promotions/promotion-records.jsonl (append-only):
 *   promotion-record, migration-audit, build-evidence
 *   (build-evidence entries are appended by scripts/package_snapshot.mjs).
 *
 * Fail-closed everywhere: a missing input (unknown record id, unreadable
 * file, failed git command, missing migration) is an error, never a silent
 * pass.
 *
 * Node >= 22.6 required (node:sqlite + TypeScript type stripping for the
 * frozen src/lib/durable/db.ts and src/lib/environment.ts modules — imported
 * as black boxes, never edited). On Node 22.6–22.17 this tool re-executes
 * itself with the required experimental flags.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RECORDS_FILE = join(ROOT, 'deploy', 'promotions', 'promotion-records.jsonl');
const RECORDS_REL = 'deploy/promotions/promotion-records.jsonl';
const COMPONENTS_JSON = join(ROOT, 'deploy', 'contracts', 'components.json');
const GATE_RUNNER = join(ROOT, 'scripts', 'run_ci_gates.mjs');
const ENVIRONMENT_TS = join(ROOT, 'src', 'lib', 'environment.ts');
const DURABLE_DB_TS = join(ROOT, 'src', 'lib', 'durable', 'db.ts');
const MIGRATIONS_DIR = join(ROOT, 'deploy', 'migrations');

const TOOL_NAME = 'scripts/promote.mjs';
const SCHEMA_VERSION = 1;

/** Wall-clock helper (milliseconds, integer). */
function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/** Control-flow signal for fail-closed refusals (see `fail`). */
class PromoteError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'PromoteError';
    this.exitCode = code;
  }
}

/**
 * Fail-closed refusal. THROWS (never process.exit): the throw unwinds the
 * call stack, so every `finally` cleanup (temp worktree removal, temp dir
 * removal) runs BEFORE the top-level handler exits — a failed verification
 * must never leak a temp worktree.
 */
function fail(message, code = 1) {
  throw new PromoteError(message, code);
}

function out(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

// ---------------------------------------------------------------------------
// Capability bootstrap (the pattern of scripts/test_durable.mjs): make sure
// this Node can import the frozen TypeScript modules (node:sqlite + type
// stripping). Older 22.x builds need experimental flags; re-exec self.
// ---------------------------------------------------------------------------
const RESPAWN_ENV = 'PAYSWAP_PROMOTE_RESPAWNED';

async function ensureCapabilities() {
  if (process.env[RESPAWN_ENV] === '1') {
    return;
  }
  const flags = [];
  let sqliteOk = false;
  try {
    await import('node:sqlite');
    sqliteOk = true;
  } catch {
    flags.push('--experimental-sqlite');
  }
  let stripTypesNeeded = false;
  try {
    await import(pathToFileURL(ENVIRONMENT_TS).href);
  } catch (error) {
    if (error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      stripTypesNeeded = true;
    } else if (sqliteOk) {
      throw error;
    }
  }
  if (stripTypesNeeded) {
    flags.push('--experimental-strip-types');
  }
  if (flags.length === 0) {
    return;
  }
  const child = spawnSync(
    process.execPath,
    [...flags, '--no-warnings', '--', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, [RESPAWN_ENV]: '1' } },
  );
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

// ---------------------------------------------------------------------------
// Git helpers (fail-closed).
// ---------------------------------------------------------------------------
function git(args, cwd = ROOT) {
  const child = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (child.error || typeof child.status !== 'number' || child.status !== 0) {
    fail(
      `git ${args.join(' ')} failed: ${child.error ? child.error.message : child.stderr || child.stdout}`,
    );
  }
  return child.stdout;
}

function gitOk(args, cwd = ROOT) {
  const child = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return child.status === 0 ? child.stdout : null;
}

/** Tracked file set in lexical order (git ls-files -z semantics). */
function trackedFiles(cwd = ROOT) {
  const child = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'buffer' });
  if (child.error || child.status !== 0) {
    fail(`git ls-files failed in ${cwd}`);
  }
  const paths = child.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0)
    .sort();
  return paths;
}

/**
 * Content digest over the tracked file set — the node-computed equivalent of
 *   git ls-files -z | sort -z | xargs -0 sha256sum
 * hashed again with sha256: one "<hex>  <path>\n" line per tracked file (the
 * sha256sum output format, two spaces), in lexical path order; the digest is
 * sha256 over that byte stream.
 */
function contentDigest(cwd = ROOT) {
  const paths = trackedFiles(cwd);
  const combined = createHash('sha256');
  for (const rel of paths) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      fail(`tracked file missing on disk: ${rel} (in ${cwd})`);
    }
    const digest = createHash('sha256').update(readFileSync(abs)).digest('hex');
    combined.update(`${digest}  ${rel}\n`, 'utf8');
  }
  return { digest: combined.digest('hex'), fileCount: paths.length };
}

// ---------------------------------------------------------------------------
// Environment context (through the frozen src/lib/environment.ts module —
// imported as a black box; the tool never re-implements the allowlist, F1).
// ---------------------------------------------------------------------------
async function environmentContext() {
  const module = await import(pathToFileURL(ENVIRONMENT_TS).href);
  const resolved = module.getEnvironment();
  const raw = process.env.PAYSWAP_ENV;
  return {
    payswap_env_raw: typeof raw === 'string' && raw.length > 0 ? raw : null,
    payswap_env_resolved: resolved,
    runtime_allowlist: ['sandbox', 'production'],
    runtime_fail_safe: 'sandbox',
    production_promotion:
      resolved === 'production'
        ? 'REFUSED (see below)'
        : 'refused-by-contract — FUTURE-WORK: the externalized production deployment binding; the production_gate contract in deploy/contracts/components.json stays authoritative',
  };
}

/** The production-context refusal — one rule, enforced at every entry point. */
function refuseProductionContext(context) {
  if (context.payswap_env_resolved === 'production') {
    fail(
      'PAYSWAP_ENV resolves to production: this tool records and verifies ' +
        'promotion evidence only — production deployment binding is FUTURE-WORK ' +
        '(DEP-002+) and the production_gate contract in ' +
        'deploy/contracts/components.json stays authoritative; unverified ' +
        'production promotion is forbidden (work-order Forbidden list, F2/F3/F8)',
      2,
    );
  }
}

// ---------------------------------------------------------------------------
// Promotion records (append-only JSONL).
// ---------------------------------------------------------------------------
function readRecords() {
  if (!existsSync(RECORDS_FILE)) {
    fail(`${RECORDS_REL} does not exist — the deployment contract requires it in the tree`);
  }
  const entries = [];
  const text = readFileSync(RECORDS_FILE, 'utf8');
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      fail(`${RECORDS_REL} line ${index + 1} does not parse as JSON: ${error.message}`);
    }
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') {
      fail(`${RECORDS_REL} line ${index + 1}: entry must be an object with a "type" field`);
    }
    entries.push(entry);
  }
  return entries;
}

function appendEntry(entry) {
  mkdirSync(dirname(RECORDS_FILE), { recursive: true });
  appendFileSync(RECORDS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

function findRecord(records, recordId) {
  const matches = records.filter(
    (entry) => entry.type === 'promotion-record' && entry.record_id === recordId,
  );
  if (matches.length === 0) {
    fail(`promotion record not found: ${recordId} (searched ${RECORDS_REL})`);
  }
  return matches[0];
}

// ---------------------------------------------------------------------------
// Gate battery execution + parsing (the runner's stdout is pure JSON lines).
// ---------------------------------------------------------------------------
function runGateBattery(cwd = ROOT, forwardOutput = true) {
  // The battery of THE CHECKOUT BEING EXAMINED: spawn that checkout's own
  // runner (the runner resolves its repository root from its own file
  // location — a cwd override is not enough). For `record` this is the main
  // checkout; for `verify` it is the temp worktree at the recorded SHA, so
  // the re-run battery is the RECORDED REVISION's battery, byte for byte.
  const runner = join(cwd, 'scripts', 'run_ci_gates.mjs');
  if (!existsSync(runner)) {
    fail(`scripts/run_ci_gates.mjs is missing in ${cwd} (the recorded revision must carry the gate runner)`);
  }
  const child = spawnSync('node', [runner], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PAYSWAP_PROMOTE_RESPAWNED: '1' },
  });
  if (forwardOutput) {
    if (child.stdout) process.stderr.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
  }
  if (child.error) {
    fail(`failed to spawn scripts/run_ci_gates.mjs in ${cwd}: ${child.error.message}`);
  }
  const gates = [];
  let verdict = null;
  for (const [index, line] of (child.stdout ?? '').split('\n').entries()) {
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(`gate runner stdout line ${index + 1} is not JSON (machine-parseable contract broken)`);
    }
    if (parsed.type === 'gate') gates.push(parsed);
    else if (parsed.type === 'verdict') verdict = parsed;
  }
  if (verdict === null || gates.length === 0) {
    fail(`gate runner produced no parseable verdict/gate table (exit ${child.status})`);
  }
  return { exit: typeof child.status === 'number' ? child.status : 1, gates, verdict };
}

/**
 * Normalize a gate table for comparison: wall times are exempt everywhere;
 * the build gate's stdout digest is exempt (next build embeds tool timing
 * lines — its ARTIFACT determinism is proven by the package snapshot
 * digests, not by stdout). Everything else must be byte-identical.
 */
function normalizeGateTable(gates) {
  return gates.map((gate) => {
    const copy = { ...gate };
    delete copy.wall_ms;
    if (copy.gate === 'build') {
      delete copy.stdout_sha256;
    }
    if (Array.isArray(copy.harnesses)) {
      copy.harnesses = copy.harnesses.map((h) => {
        const hc = { ...h };
        delete hc.wall_ms;
        return hc;
      });
    }
    return copy;
  });
}

function describeGateTable(gates) {
  return gates.map((g) => `${g.gate}:${g.passed ? 'pass' : `FAIL(${g.exit})`}`).join(' ');
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------
async function commandRecord() {
  const context = await environmentContext();
  refuseProductionContext(context);

  // The frozen digest must be reproducible at the recorded SHA: require a
  // clean working tree (the records file is appended AFTER the digest is
  // computed; build outputs are gitignored and do not count).
  const status = git(['status', '--porcelain']);
  if (status.trim().length !== 0) {
    fail(
      'working tree is dirty — a promotion record must freeze a committed, ' +
        'clean revision (git status --porcelain must be empty); commit first:\n' +
        status.trim(),
    );
  }

  const commitSha = git(['rev-parse', 'HEAD']).trim();
  const commitSubject = git(['log', '-1', '--pretty=%s']).trim();
  const treeDigest = git(['rev-parse', 'HEAD^{tree}']).trim();
  const { digest, fileCount } = contentDigest(ROOT);

  process.stderr.write(
    `${TOOL_NAME}: freezing revision ${commitSha.slice(0, 12)} ` +
      `("${commitSubject}") tree=${treeDigest.slice(0, 12)} ` +
      `content=${digest.slice(0, 12)} (${fileCount} tracked files)\n`,
  );

  process.stderr.write(`${TOOL_NAME}: running the full gate battery (this builds; ~1 min)\n`);
  const battery = runGateBattery(ROOT);
  if (battery.exit !== 0 || !battery.verdict.passed) {
    fail(
      `gate battery FAILED — refusing to record (${describeGateTable(battery.gates)}); ` +
        'a record with any failed gate must not exist (fail-closed)',
    );
  }

  const records = readRecords();
  const recordId = `pr-${Date.now()}-${digest.slice(0, 10)}`;
  const duplicate = records.find(
    (entry) =>
      entry.type === 'promotion-record' &&
      entry.revision &&
      entry.revision.content_digest === digest &&
      entry.revision.commit_sha === commitSha,
  );
  if (duplicate) {
    fail(
      `a promotion record already exists for this exact revision: ${duplicate.record_id}; ` +
        'records are append-only — promote a NEW revision instead',
    );
  }
  for (const entry of records) {
    if (entry.type === 'promotion-record' && entry.record_id === recordId) {
      fail(`record id collision (same millisecond + digest): ${recordId}`);
    }
  }

  const record = {
    type: 'promotion-record',
    schema_version: SCHEMA_VERSION,
    record_id: recordId,
    created_at: new Date().toISOString(),
    created_at_epoch_ms: Date.now(),
    work_order: 'DEP-006',
    base_branch: 'main',
    revision: {
      commit_sha: commitSha,
      commit_subject: commitSubject,
      tree_digest: treeDigest,
      content_digest: digest,
      content_digest_format:
        'sha256 over "<sha256-of-file>  <path>\\n" lines for every git-tracked file in lexical order (git ls-files -z | sort -z | xargs -0 sha256sum, hashed again)',
      tracked_file_count: fileCount,
    },
    environment_context: context,
    gate_runner: 'scripts/run_ci_gates.mjs',
    gate_table: battery.gates,
    gate_verdict: battery.verdict,
    evidence: {
      rehearsal_document: 'deploy/promotions/DEP-006-REHEARSAL.md',
      records_file: RECORDS_REL,
    },
  };

  appendEntry(record);
  out({
    ok: true,
    action: 'record',
    record_id: recordId,
    commit_sha: commitSha,
    tree_digest: treeDigest,
    content_digest: digest,
    gates: describeGateTable(battery.gates),
    appended_to: RECORDS_REL,
  });
  process.stderr.write(
    `${TOOL_NAME}: record ${recordId} appended to ${RECORDS_REL} ` +
      `(gates: ${describeGateTable(battery.gates)})\n`,
  );
}

// ---------------------------------------------------------------------------
// migrate — the migration gate (throwaway copy ONLY)
// ---------------------------------------------------------------------------
async function commandMigrate(recordId) {
  if (!recordId) {
    fail('usage: node scripts/promote.mjs migrate <record-id> (a record id is required)');
  }
  const context = await environmentContext();
  refuseProductionContext(context);
  const records = readRecords();
  const record = findRecord(records, recordId);

  // Locate the durable database (the real one — read ONCE, as a copy source).
  const envDb = process.env.PAYSWAP_DURABLE_DB;
  const sourceDb =
    typeof envDb === 'string' && envDb.trim().length > 0
      ? resolve(ROOT, envDb.trim())
      : join(ROOT, 'var', 'durable.sqlite');
  const sourceExists = existsSync(sourceDb);

  const tempDir = mkdtempSync(join(tmpdir(), 'payswap-migration-gate-'));
  let verified = false;
  let appliedRows = [];
  try {
    const throwawayDb = join(tempDir, 'throwaway-copy.sqlite');
    if (sourceExists) {
      copyFileSync(sourceDb, throwawayDb);
      process.stderr.write(
        `${TOOL_NAME}: migration gate on a THROWAWAY COPY of ${sourceDb} (the real database is never opened for write)\n`,
      );
    } else {
      process.stderr.write(
        `${TOOL_NAME}: no durable database present (${sourceDb}) — the migration gate runs on a fresh throwaway file (the fresh-deploy case)\n`,
      );
    }

    // The repo's own migration runner, imported as a black box.
    const dbModule = await import(pathToFileURL(DURABLE_DB_TS).href);
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(throwawayDb);
    try {
      const result = dbModule.runMigrations(sqlite, MIGRATIONS_DIR);
      appliedRows = sqlite
        .prepare('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name')
        .all()
        .map((row) => ({ name: String(row.name), checksum: String(row.checksum) }));

      // Independent verification: the applied set + sha256 content checksums
      // must match the migration files on disk, exactly and completely.
      const diskFiles = trackedFiles(ROOT)
        .filter((rel) => rel.startsWith('deploy/migrations/') && rel.endsWith('.sql'))
        .map((rel) => {
          const name = rel.slice('deploy/migrations/'.length);
          const checksum = createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex');
          return { name, checksum };
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      if (diskFiles.length === 0) {
        fail('no migration files found under deploy/migrations (fail-closed)');
      }
      const diskJson = JSON.stringify(diskFiles);
      const appliedJson = JSON.stringify(appliedRows.map((r) => ({ name: r.name, checksum: r.checksum })));
      if (diskJson !== appliedJson) {
        fail(
          `migration gate verification FAILED: schema_migrations applied set does not match the files on disk\n` +
            `  on disk: ${diskJson}\n  applied: ${appliedJson}`,
        );
      }
      verified = true;
      const appliedNow = result.applied.map((m) => ({ name: m.name, checksum: m.checksum }));
      process.stderr.write(
        `${TOOL_NAME}: migration gate VERIFIED — applied set matches disk exactly ` +
          `(${appliedRows.length} migration(s); applied by this run: ${appliedNow.length})\n`,
      );
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const audit = {
    type: 'migration-audit',
    schema_version: SCHEMA_VERSION,
    audit_id: `mig-${Date.now()}-${recordId}`,
    record_id: recordId,
    created_at: new Date().toISOString(),
    migration_runner: 'src/lib/durable/db.ts#runMigrations (imported as a black box)',
    source_database: sourceExists
      ? `copy-of:${sourceDb === join(ROOT, 'var', 'durable.sqlite') ? 'var/durable.sqlite' : sourceDb}`
      : 'fresh-throwaway (no durable database present at record time)',
    migrations_dir: 'deploy/migrations',
    applied: appliedRows,
    applied_count: appliedRows.length,
    verified: verified && true,
    real_database_mutated: false,
  };
  appendEntry(audit);
  out({
    ok: true,
    action: 'migrate',
    record_id: recordId,
    source: audit.source_database,
    applied: appliedRows.map((r) => r.name),
    verified: audit.verified,
    real_database_mutated: false,
    appended_to: RECORDS_REL,
  });
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
async function commandVerify(recordId) {
  if (!recordId) {
    fail('usage: node scripts/promote.mjs verify <record-id> (a record id is required)');
  }
  const context = await environmentContext();
  refuseProductionContext(context);
  const records = readRecords();
  const record = findRecord(records, recordId);

  // The recorded gates must themselves all be passing.
  const recordedGates = Array.isArray(record.gate_table) ? record.gate_table : [];
  if (recordedGates.length === 0 || !recordedGates.every((g) => g.passed === true && g.exit === 0)) {
    fail(`record ${recordId} contains failed or missing gates — refusing to verify it`);
  }

  const sha = record.revision.commit_sha;
  const worktree = join(tmpdir(), `payswap-verify-${Date.now()}`);
  let ok = true;
  const problems = [];
  try {
    process.stderr.write(`${TOOL_NAME}: creating temp worktree at ${sha.slice(0, 12)}\n`);
    git(['worktree', 'add', '--detach', worktree, sha]);

    // Locked dependency graph in the worktree (same as CI: frozen lockfile).
    process.stderr.write(`${TOOL_NAME}: bun install --frozen-lockfile (worktree)\n`);
    const install = spawnSync('bun', ['install', '--frozen-lockfile'], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (install.error || install.status !== 0) {
      fail(
        `bun install --frozen-lockfile failed in the worktree: ${
          install.error ? install.error.message : install.stderr || install.stdout
        }`,
      );
    }

    // 1. commit identity
    const shaNow = git(['rev-parse', `${sha}^{commit}`]).trim();
    const treeNow = git(['rev-parse', `${sha}^{tree}`]).trim();
    if (treeNow !== record.revision.tree_digest) {
      ok = false;
      problems.push(
        `tree digest mismatch: recorded ${record.revision.tree_digest}, recomputed ${treeNow}`,
      );
    }
    if (shaNow !== sha) {
      ok = false;
      problems.push(`commit SHA mismatch: recorded ${sha}, resolved ${shaNow}`);
    }

    // 2. content digest at the recorded SHA (over the worktree checkout)
    const { digest } = contentDigest(worktree);
    if (digest !== record.revision.content_digest) {
      ok = false;
      problems.push(
        `content digest mismatch: recorded ${record.revision.content_digest}, recomputed ${digest}`,
      );
    }

    // 3. re-run the full gate battery in the worktree
    process.stderr.write(`${TOOL_NAME}: re-running the full gate battery in the worktree\n`);
    const battery = runGateBattery(worktree, false);
    if (battery.exit !== 0 || !battery.verdict.passed) {
      ok = false;
      problems.push(
        `gate battery re-run FAILED (${describeGateTable(battery.gates)}) — the recorded revision no longer passes`,
      );
    }

    // 4. gate-table comparison (wall times exempt; build stdout digest exempt)
    const recorded = normalizeGateTable(recordedGates);
    const rerun = normalizeGateTable(battery.gates);
    if (JSON.stringify(recorded) !== JSON.stringify(rerun)) {
      ok = false;
      problems.push(
        'gate table mismatch between the recorded run and the verification re-run ' +
          '(wall times and the build gate stdout digest are exempt; everything else must be byte-identical)',
      );
    }

    const result = {
      ok,
      action: 'verify',
      record_id: recordId,
      commit_sha: sha,
      tree_digest: record.revision.tree_digest,
      content_digest_recomputed: digest,
      content_digest_matches: digest === record.revision.content_digest,
      gates_rerun: battery.gates.map((g) => ({ gate: g.gate, exit: g.exit, passed: g.passed })),
      gate_table_matches:
        JSON.stringify(recorded) === JSON.stringify(rerun),
      problems,
    };
    out(result);
    if (!ok) {
      for (const problem of problems) {
        process.stderr.write(`${TOOL_NAME}:   - ${problem}\n`);
      }
      fail(`verification of record ${recordId} FAILED`);
    }
    process.stderr.write(`${TOOL_NAME}: verification of ${recordId} PASSED\n`);
  } finally {
    // Runs on success AND on every failure path (fail() throws, so the
    // unwinding always passes through here — no leaked worktrees).
    const remove = gitOk(['worktree', 'remove', '--force', worktree]);
    if (remove === null) {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// rollback-plan (EMITS a plan; performs no external effects)
// ---------------------------------------------------------------------------
async function commandRollbackPlan(recordId) {
  if (!recordId) {
    fail('usage: node scripts/promote.mjs rollback-plan <record-id> (a record id is required)');
  }
  const records = readRecords();
  const record = findRecord(records, recordId);

  // The previous promotion record = the last promotion-record entry appended
  // before this one (the file is append-only, so file order is creation order).
  const promotionRecords = records.filter((entry) => entry.type === 'promotion-record');
  const index = promotionRecords.indexOf(record);
  const previous = index > 0 ? promotionRecords[index - 1] : null;

  // Per-component rollback contracts come from the registry (single source
  // of truth — the plan never invents component behavior).
  let components = [];
  try {
    components = JSON.parse(readFileSync(COMPONENTS_JSON, 'utf8')).components ?? [];
  } catch (error) {
    fail(`deploy/contracts/components.json does not parse: ${error.message}`);
  }
  const perComponent = components.map((component) => ({
    id: component.id,
    layer: component.layer,
    rollback: component.rollback,
    production_gate: component.production_gate,
  }));

  const plan = {
    plan: 'rollback',
    schema_version: SCHEMA_VERSION,
    plan_only: true,
    record_id: recordId,
    generated_at: new Date().toISOString(),
    generated_by: TOOL_NAME,
    rolled_back_revision: {
      record_id: record.record_id,
      commit_sha: record.revision.commit_sha,
      commit_subject: record.revision.commit_subject,
      tree_digest: record.revision.tree_digest,
      content_digest: record.revision.content_digest,
    },
    rollback_target: previous
      ? {
          record_id: previous.record_id,
          commit_sha: previous.revision.commit_sha,
          commit_subject: previous.revision.commit_subject,
          tree_digest: previous.revision.tree_digest,
          content_digest: previous.revision.content_digest,
        }
      : null,
    rollback_target_status: previous
      ? 'present (the previous promotion record in the append-only chain)'
      : 'absent — this is the FIRST promotion record in the chain; the plan refuses to invent a target: the operator must supply the last known-good artifact revision from the deployment history outside this record chain (fail-closed)',
    executable: Boolean(previous),
    principles: {
      R1: 'stateless components: redeploy the previous artifact',
      R2: 'stateful recovery: point-in-time recovery plus replay through the durable command path; idempotent consumers make replay safe',
      R3: 'finality: deployment rollback never reverses protocol finality; post-finality corrections flow only through protocol-governed recourse; rollback restores infrastructure, not financial outcomes',
      R4: 'evidence: append-only; restore-from-backup preserves history; rollback never edits evidence',
      R5: 'no bypass: rollback and recovery paths never bypass protocol authorization — they replay authorized commands; they never hand-edit authoritative state',
      source: 'spec/deployment/topology.md "Health and rollback model"',
    },
    steps: [
      {
        step: 1,
        action: 'redeploy-previous-artifact',
        principles: ['R1'],
        target: previous ? previous.revision.commit_sha : null,
        detail: previous
          ? `redeploy the artifact revision recorded by ${previous.record_id} (tree ${previous.revision.tree_digest}) for every stateless component; the build is reproduced from the recorded revision (same tree digest → same normalized build digest, per the record's build-evidence)`
          : 'no previous recorded revision exists — see rollback_target_status; do not guess a target',
      },
      {
        step: 2,
        action: 'durable-command-replay',
        principles: ['R2'],
        detail:
          'in-flight commands replay from the durable command queue (durable-command-queue component): re-execution re-derives pending work from authoritative state and re-submits the SAME deterministic idempotency keys — recorded receipts, never a second effect',
      },
      {
        step: 3,
        action: 'stateful-point-in-time-recovery',
        principles: ['R2', 'R4'],
        detail:
          'authoritative-state-store: point-in-time recovery plus replay of durable commands (the transition runtime is the only authoritative-state writer); evidence-object-store: restore from backup with append-only history preserved — rollback never edits evidence',
      },
      {
        step: 4,
        action: 'finality-protection',
        principles: ['R3'],
        detail:
          'finality is NEVER reversed by deployment action; post-finality corrections flow ONLY through protocol-governed recourse; this plan restores infrastructure, not financial outcomes',
      },
      {
        step: 5,
        action: 'external-effect-safety',
        principles: ['R5', 'R3'],
        detail:
          'the plan may re-drive ONLY idempotent, explicitly-retryable pre-effect submissions, using the SAME rail idempotency keys (INV-13-3 retransmission identity — recorded receipts prevent a second effect); UNKNOWN outcomes are NEVER retried (the DEP-005 rail retry contract: UNKNOWN is never translated and never retransmitted; it routes to the A14 Reconciliation Authority path)',
      },
      {
        step: 6,
        action: 'authorization-boundary',
        principles: ['R5'],
        detail:
          'every replayed command flows through the protocol gateway (the sole admission point) and the transition runtime (the sole authoritative-state writer); rollback never bypasses protocol authorization and never hand-edits authoritative state',
      },
    ],
    external_effect_safety: {
      pre_effect_re_drive:
        'allowed only for idempotent, explicitly-retryable pre-effect failures, re-driven with the same rail idempotency keys (bounded, backoff, deadline-aware — the DEP-005 retry engine contract)',
      unknown_never_retried: true,
      unknown_handling:
        'UNKNOWN outcomes are never retried, never translated to success or failure — they are held for the A14 reconciliation path (GC-2: the only exit from UNKNOWN)',
      post_effect_cases: [
        {
          case: 'settlement attempt already delivered-with-report before rollback (post-effect)',
          routing: 'protocol-governed recourse — listed, NOT executed by this plan',
        },
        {
          case: 'finalized settlement records (finality reached before rollback)',
          routing: 'finality is never reversed (R3); corrections only through protocol-governed recourse — listed, NOT executed',
        },
        {
          case: 'rail submission whose outcome is UNKNOWN at rollback time',
          routing: 'NEVER retried — routed to the A14 Reconciliation Authority path (GC-2) — listed, NOT executed',
        },
      ],
      execution: 'listed-not-executed — this tool performs no external effects',
    },
    per_component: perComponent,
    tool_boundary:
      'this tool PLANS rollback; it does not perform external effects, does not reverse finality, does not mutate authoritative state, and does not touch any real database',
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stderr.write(
    `${TOOL_NAME}: rollback plan for ${recordId} emitted ` +
      `(target: ${previous ? previous.record_id : 'none (first record)'}; plan-only, no effects performed)\n`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await ensureCapabilities();
  const [command, recordId] = process.argv.slice(2);
  switch (command) {
    case 'record':
      return commandRecord();
    case 'migrate':
      return commandMigrate(recordId);
    case 'verify':
      return commandVerify(recordId);
    case 'rollback-plan':
      return commandRollbackPlan(recordId);
    default:
      fail(
        'usage: node scripts/promote.mjs <record|migrate <id>|verify <id>|rollback-plan <id>> — ' +
          'a subcommand is required (fail-closed: no default action)',
      );
  }
}

main().catch((error) => {
  if (error instanceof PromoteError) {
    process.stderr.write(`${TOOL_NAME}: FAIL — ${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write(`${TOOL_NAME}: FAIL — ${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
