#!/usr/bin/env node
/**
 * DEP-006 — repo-local CI gate runner.
 *
 * Executes the PaySwap verification battery in ONE fixed order and prints a
 * machine-parseable gate table: one JSON object per line on STDOUT (the
 * promotion tool consumes exactly this stream), with gate progress/output
 * forwarded to STDERR so stdout stays pure JSON.
 *
 * Gates, in order (spec/deployment/ci-cd.md — the CI/CD and promotion
 * contract):
 *   1. governance           python3 scripts/validate_governance.py
 *   2. deployment-contract  python3 scripts/validate_deployment.py
 *   3. durable-contract     python3 scripts/validate_durable.py
 *   4. typecheck            bun run typecheck   (tsc --noEmit)
 *   5. harnesses            node scripts/test_*.mjs   (enumerated by glob —
 *                           never a hardcoded list that can drift)
 *   6. build                bun run build        (next build, standalone)
 *
 * Output contract (stdout, one JSON object per line):
 *   {"type":"gate","gate":"governance","command":"...","exit":0,
 *    "passed":true,"wall_ms":44,"stdout_sha256":"..."}
 *   ...
 *   {"type":"verdict","passed":true,"gates_total":6,"gates_failed":0}
 *
 * Exit code: 0 iff EVERY gate passed; 1 otherwise (fail-closed: a missing
 * input — an unreadable script, an unresolvable command — is an error, never
 * a silent pass).
 *
 * Idempotence: the runner leaves no state that changes a second run's
 * RESULT. Build outputs (.next/, tsconfig.tsbuildinfo) are overwritten
 * deterministically by the underlying tools and are gitignored; the runner
 * writes nothing else.
 *
 * Honesty rule: every gate here is a repo-local script that also runs green
 * with plain `bun` / `python3` / `node` in a fresh clone — no gate exists
 * that only CI can run. The GitHub Actions workflow (deploy/contracts
 * ci_cd.workflows) invokes THIS runner; it defines no gates of its own.
 *
 * Dependencies: none beyond Node.js >= 22 (node:child_process, node:crypto,
 * node:fs, node:path) plus the repository's own toolchain (bun, python3).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const RUNNER_NAME = 'scripts/run_ci_gates.mjs';

/** Wall-clock helper (milliseconds, integer). */
function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

/**
 * Run one command, capture stdout, forward combined output to stderr.
 * Returns { exit, stdout, wallMs }. Fail-closed on spawn errors
 * (ENOENT etc.): exit becomes 127 and the gate fails.
 */
function runGate(name, command, args, cwd = ROOT) {
  const started = nowMs();
  const child = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const wallMs = nowMs() - started;
  if (child.error) {
    process.stderr.write(`[gate ${name}] spawn failure: ${child.error.message}\n`);
    return { exit: 127, stdout: '', wallMs };
  }
  const stdout = typeof child.stdout === 'string' ? child.stdout : '';
  const stderr = typeof child.stderr === 'string' ? child.stderr : '';
  const banner = `── gate: ${name} (${command} ${args.join(' ')}) ──\n`;
  process.stderr.write(banner);
  if (stdout) process.stderr.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const status = typeof child.status === 'number' ? child.status : 1;
  return { exit: status, stdout, wallMs };
}

/**
 * Digest of a gate's captured stdout (determinism evidence; see ci-cd.md).
 *
 * The digest is computed over the stdout with the runner's ABSOLUTE
 * repository-root path normalized to the placeholder `<REPO>`: the checkout
 * location is environment, not content (a local clone at
 * /home/operator/payswap3 and a CI runner at /home/runner/work/payswap3
 * must produce the SAME gate table for the same tree — the validators and
 * harnesses are repo-local scripts whose stdout embeds the root path). The
 * forwarded gate output on stderr keeps the original text.
 */
function stdoutDigest(stdout) {
  const normalized = stdout.split(ROOT).join('<REPO>');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Enumerate the dependency-free test harnesses by glob (never hardcoded). */
function listHarnesses() {
  const names = readdirSync(HERE)
    .filter((name) => /^test_.*\.mjs$/.test(name))
    .sort();
  return names.map((name) => join('scripts', name));
}

// ---------------------------------------------------------------------------
// The gate battery, in the contract order.
// ---------------------------------------------------------------------------

/** @type {Array<{gate: string, kind: string, run: () => object}>} */
const battery = [];

// 1. governance — the GOV-001 static governance battery.
battery.push({
  gate: 'governance',
  kind: 'python',
  run: () => {
    const r = runGate('governance', 'python3', ['scripts/validate_governance.py']);
    return { ...r };
  },
});

// 2. deployment-contract — the deployment contract battery (DEP-001..DEP-006).
battery.push({
  gate: 'deployment-contract',
  kind: 'python',
  run: () => {
    const r = runGate('deployment-contract', 'python3', ['scripts/validate_deployment.py']);
    return { ...r };
  },
});

// 3. durable-contract — the DEP-003 durable substrate battery.
battery.push({
  gate: 'durable-contract',
  kind: 'python',
  run: () => {
    const r = runGate('durable-contract', 'python3', ['scripts/validate_durable.py']);
    return { ...r };
  },
});

// 4. typecheck — repository script `typecheck` (tsc --noEmit).
battery.push({
  gate: 'typecheck',
  kind: 'bun',
  run: () => {
    const r = runGate('typecheck', 'bun', ['run', 'typecheck']);
    return { ...r };
  },
});

// 5. harnesses — every scripts/test_*.mjs with plain node (glob-enumerated).
battery.push({
  gate: 'harnesses',
  kind: 'node-harnesses',
  run: () => {
    const harnessFiles = listHarnesses();
    if (harnessFiles.length === 0) {
      // Fail-closed: a battery with zero harnesses means the glob is broken
      // or the tree is wrong — never a silent pass.
      process.stderr.write('[gate harnesses] no scripts/test_*.mjs found — refusing\n');
      return { exit: 1, stdout: '', wallMs: 0, harnesses: [] };
    }
    const results = [];
    let harnessExit = 0;
    const started = nowMs();
    for (const rel of harnessFiles) {
      const child = spawnSync('node', [rel], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const exit = child.error ? 127 : typeof child.status === 'number' ? child.status : 1;
      const out = typeof child.stdout === 'string' ? child.stdout : '';
      const err = typeof child.stderr === 'string' ? child.stderr : '';
      process.stderr.write(`── harness: ${rel} ──\n`);
      if (out) process.stderr.write(out);
      if (err) process.stderr.write(err);
      results.push({
        file: rel,
        exit,
        stdout_sha256: stdoutDigest(out),
      });
      if (exit !== 0) harnessExit = exit;
    }
    const wallMs = nowMs() - started;
    return { exit: harnessExit, stdout: '', wallMs, harnesses: results };
  },
});

// 6. build — repository script `build` (next build, standalone output).
battery.push({
  gate: 'build',
  kind: 'bun',
  run: () => {
    const r = runGate('build', 'bun', ['run', 'build']);
    return { ...r };
  },
});

// ---------------------------------------------------------------------------
// Execution + the gate table.
// ---------------------------------------------------------------------------

process.stderr.write(`${RUNNER_NAME}: running ${battery.length} gates from ${ROOT}\n`);

const gateLines = [];
let failed = 0;
for (const entry of battery) {
  const result = entry.run();
  const passed = result.exit === 0;
  if (!passed) failed += 1;
  const line = {
    type: 'gate',
    gate: entry.gate,
    command: entry.commandText ?? describeCommand(entry, result),
    exit: result.exit,
    passed,
    wall_ms: result.wallMs,
    stdout_sha256: stdoutDigest(result.stdout ?? ''),
  };
  if (Array.isArray(result.harnesses)) line.harnesses = result.harnesses;
  gateLines.push(line);
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

const verdict = {
  type: 'verdict',
  passed: failed === 0,
  gates_total: gateLines.length,
  gates_failed: failed,
  runner: RUNNER_NAME,
};
process.stdout.write(`${JSON.stringify(verdict)}\n`);
process.stderr.write(
  `${RUNNER_NAME}: verdict ${verdict.passed ? 'PASS' : 'FAIL'} ` +
    `(${gateLines.length - failed}/${gateLines.length} gates green)\n`,
);
process.exit(verdict.passed ? 0 : 1);

/**
 * Human-readable command descriptor recorded in the gate table. The
 * harnesses gate records the glob plus the concrete file count so the table
 * is self-describing about exactly what ran.
 */
function describeCommand(entry, result) {
  switch (entry.gate) {
    case 'governance':
      return 'python3 scripts/validate_governance.py';
    case 'deployment-contract':
      return 'python3 scripts/validate_deployment.py';
    case 'durable-contract':
      return 'python3 scripts/validate_durable.py';
    case 'typecheck':
      return 'bun run typecheck';
    case 'harnesses':
      return `node scripts/test_*.mjs (${(result.harnesses ?? []).length} files, glob)`;
    case 'build':
      return 'bun run build';
    default:
      return entry.gate;
  }
}
