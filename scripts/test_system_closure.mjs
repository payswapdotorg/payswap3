#!/usr/bin/env node
/**
 * SYS-003 — the system closure gate (family A).
 *
 * Plain-Node, dependency-free, fail-closed harness that MECHANICALLY asserts
 * every SYS-003 acceptance bullet against the only sources of truth the
 * closure owns: the development-state machine files and Git history. It
 * composes — never modifies — the existing batteries:
 *
 *   - it SPAWNS `python3 scripts/validate_governance.py` (parses its RESULT
 *     line: 17/17 authority paths) and `python3 scripts/validate_deployment.py`
 *     (parses its result line) exactly the way scripts/run_ci_gates.mjs does;
 *   - it re-derives the final reconciliation matrix via the generator's pure
 *     derivation (scripts/generate_final_reconciliation_matrix.mjs) and fails
 *     closed on any divergence from the committed matrix (stale/hand-edited
 *     evidence never passes);
 *   - it PARSES (never re-drives) the SYS-001 matrix and the SYS-002 corpus
 *     artifacts — those live harnesses stay green in the repo battery
 *     (run_ci_gates glob-enumerates them alongside this gate).
 *
 * THE SEVEN ACCEPTANCE BULLETS (each maps to one group):
 *
 *   [closure:protocol-frozen]   Protocol v0.1 remains frozen and
 *                               WORK-001..WORK-033 remain complete:
 *                               frontier-state.json's protocol frontier is
 *                               EMPTY and v0.1 declared complete;
 *                               program-state.json records all 33 COMPLETE;
 *                               the governance validator passes 17/17.
 *   [closure:product-final]    UI-001..UI-010 are FINAL (program CLOSED at
 *                               UI-010) and every recorded merge SHA for
 *                               UI-001..UI-011 is an ancestor of HEAD with
 *                               subject containment (UI-011 recorded as the
 *                               additive hardening item beyond the required
 *                               closure target).
 *   [closure:deployment-final] DEP-001..DEP-008 each carry a recorded merge
 *                               SHA that is an ancestor of HEAD; the DEP-008
 *                               readiness transcript exists with its verdict
 *                               recorded; the DEP-008 release record exists,
 *                               all-green; its known orphan condition is
 *                               ACKNOWLEDGED with its Lead disposition; the
 *                               deployment contract validator passes.
 *   [closure:sys-programs]     SYS-001 (6ec6b38) and SYS-002 (967519a) are
 *                               ancestors of HEAD; the SYS-001 matrix json
 *                               and the SYS-002 corpus-index exist with
 *                               all-green recorded results.
 *   [closure:release-revision] The exact release revision is read from the
 *                               repo at run time (git rev-parse HEAD /
 *                               HEAD^{tree} — never hand-written) and
 *                               recorded in the closure-verdict line; the
 *                               dispatch base is verified as an ancestor.
 *   [closure:state-sync]       Every development-state file's recorded merge
 *                               facts validate against Git (ancestor +
 *                               subject containment); cross-file agreements
 *                               hold; no state file claims an open/blocked
 *                               frontier item that is actually merged (or
 *                               vice versa); at the CLOSED state the machine
 *                               frontier is EMPTY and the residual surface
 *                               lives in the explicit postClosure section
 *                               (closure-hygiene hardening — the historical
 *                               SYS-002 DISPATCHABLE line this gate once
 *                               tolerated is now a mechanical failure).
 *   [closure:closure-corpus]   The closure record exists with the
 *                               clearly-marked sign-off block (PENDING in
 *                               the worker phase; RECORDED after the Lead
 *                               finalize), the
 *                               state synchronization proof names the five
 *                               state files, the committed matrix matches the
 *                               live re-derivation, and the corpus index
 *                               lists the artifacts. (The Architect approval
 *                               itself is the Lead finalize — this gate never
 *                               claims it.)
 *
 * OUTPUT CONTRACT (ci-cd.md §2): stdout is byte-deterministic across runs at
 * the same tree — the JSONL group/scenario records, the human summary table
 * and the closure-verdict line only. Validator child output, timings, paths
 * and working-tree state live on stderr only.
 *
 * SANDBOX-CLASS DISCLAIMER: this gate proves the REPOSITORY system — protocol
 * frozen and materialized, product closed, deployment contracts green,
 * reconciliation and dogfood artifacts green, state synchronized with Git.
 * It claims NOTHING about production financial behavior; production claims
 * stay gated on the DEP-002+ production deployment binding (environments.md
 * F8; the DEP-008 contract's hard boundary).
 *
 * Exit code: 0 iff every acceptance bullet is mechanically proven; 1
 * otherwise (fail-closed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveMatrixContent } from './generate_final_reconciliation_matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HARNESS_NAME = 'scripts/test_system_closure.mjs';

// The dispatch base (SYS-002 finalize — the SYS-003 dispatch base). Verified
// as an ancestor of HEAD; never used to fabricate a release revision.
const DISPATCH_BASE = '19df3bf72d498e397b5ed0a78134f5dbec051f6a';

// The SYS-001 / SYS-002 squash merges (PR #40 / PR #41) the state files record.
const SYS001_SQUASH = '6ec6b38';
const SYS002_SQUASH = '967519a';

// The DEP-008 release record (the immutable release identifier under
// evidence; its revision is the KNOWN orphan — Lead-dispositioned).
const DEP008_RECORD_ID = 'pr-1789278934747-9b83ecdc27';

// ---------------------------------------------------------------------------
// Repository readers (git + files).
// ---------------------------------------------------------------------------
function gitExec(...args) {
  const child = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (child.error || child.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${child.stderr?.toString().slice(0, 200) ?? child.error?.message}`);
  }
  return child.stdout.trim();
}

function gitOk(...args) {
  // spawnSync does NOT throw on non-zero exit — the status must be checked
  // explicitly (a vacuous true here would make every ancestor proof a
  // no-op; fail-closed means the exit code IS the proof).
  const child = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
  return child.status === 0;
}

function readText(relative) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    throw new Error(`required file missing: ${relative}`);
  }
  return readFileSync(path, 'utf8');
}

function readJson(relative) {
  return JSON.parse(readText(relative));
}

function spawnValidator(command, args) {
  const child = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const stdout = typeof child.stdout === 'string' ? child.stdout : '';
  const stderr = typeof child.stderr === 'string' ? child.stderr : '';
  process.stderr.write(`── validator: ${args.join(' ')} ──\n`);
  if (stdout) process.stderr.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const exit = child.error ? 127 : typeof child.status === 'number' ? child.status : 1;
  return { exit, stdout };
}

/** Run one acceptance-surface row's git proofs (live, per run). */
function proveMergeFact(sha, itemAlias) {
  const ancestor = gitOk('merge-base', '--is-ancestor', sha, 'HEAD');
  const subject = gitExec('log', '--format=%s', '-n', '1', sha);
  const containment = subject.toLowerCase().includes(itemAlias.toLowerCase());
  return { ancestor, subject, containment };
}

// ---------------------------------------------------------------------------
// The LIVE matrix derivation (the generator's pure function over the state
// files + Git history — re-derived at run time; the committed matrix must
// match it exactly). Also the run-time release revision holder. A derivation
// failure (malformed/tampered state) is recorded and FAILS the groups that
// consume the derivation — never a silent pass.
// ---------------------------------------------------------------------------
let liveMatrix = null;
let derivationError = null;
try {
  liveMatrix = deriveMatrixContent(ROOT);
} catch (error) {
  derivationError = error;
  process.stderr.write(`${HARNESS_NAME}: live matrix derivation FAILED — ${error.message}\n`);
}
const releaseRevision = { commit: null, tree: null };

// ---------------------------------------------------------------------------
// The group runner (the SYS-001 makeGroup pattern — deterministic stdout).
// ---------------------------------------------------------------------------
const groupResults = [];
const groupLedgers = [];
let liveAssertions = 0;
let failure = null;

function makeGroup(name) {
  const notes = [];
  let scenarios = 0;
  let assertions = 0;
  const count = () => {
    assertions += 1;
    liveAssertions += 1;
    return assertions;
  };
  return {
    name,
    note: (line) => notes.push(line),
    scenario: (label) => {
      scenarios += 1;
      notes.push(`#${scenarios} ${label}`);
      return scenarios;
    },
    check: (condition, message) => {
      const ordinal = count();
      if (!condition) {
        throw new Error(`[${name}] assertion #${ordinal} FAILED: ${message}`);
      }
    },
    equal: (actual, expected, message) => {
      const ordinal = count();
      if (actual !== expected) {
        throw new Error(
          `[${name}] assertion #${ordinal} FAILED: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
        );
      }
    },
    notEqual: (actual, unexpected, message) => {
      const ordinal = count();
      if (actual === unexpected) {
        throw new Error(
          `[${name}] assertion #${ordinal} FAILED: ${message} (must not be ${JSON.stringify(unexpected)})`,
        );
      }
    },
    deepEqual: (actual, expected, message) => {
      const ordinal = count();
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        throw new Error(`[${name}] assertion #${ordinal} FAILED: ${message} (${a} !== ${b})`);
      }
    },
    notes: () => notes,
    counts: () => ({ scenarios, assertions }),
  };
}

async function runGroup(name, runner) {
  const group = makeGroup(name);
  process.stderr.write(`── closure group: ${name} ──\n`);
  let groupError = null;
  try {
    await runner(group);
  } catch (error) {
    groupError = error;
  }
  const { scenarios, assertions } = group.counts();
  const result = groupError === null ? 'PASS' : 'FAIL';
  groupResults.push({ type: 'closure-group', group: name, scenarios, assertions, result });
  groupLedgers.push(group);
  if (groupError !== null) {
    failure = failure ?? groupError;
    process.stderr.write(`${name}: FAILED — ${groupError.message}\n`);
  } else {
    process.stderr.write(`${name}: PASS (${scenarios} scenarios / ${assertions} assertions)\n`);
  }
  for (const note of group.notes()) {
    if (typeof note === 'string' && note.startsWith('#')) {
      const record = { type: 'closure-scenario', group: name, name: note.replace(/^#\d+ /, ''), result };
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ type: 'closure-group', group: name, scenarios, assertions, result })}\n`,
  );
}

// ---------------------------------------------------------------------------
// Bullet 1 — protocol frozen + WORK-001..033 complete.
// ---------------------------------------------------------------------------
await runGroup('closure:protocol-frozen', (group) => {
  group.scenario('the protocol frontier is empty and v0.1 is declared complete');
  const frontierState = readJson('spec/development-state/frontier-state.json');
  group.equal(frontierState.architecture, 'v0.1', 'frontier-state architecture is v0.1');
  group.equal(frontierState.status, 'complete', 'frontier-state status is complete');
  group.deepEqual(frontierState.frontier.openItems, [], 'the protocol frontier has no open items');
  group.deepEqual(frontierState.frontier.blockedItems, [], 'the protocol frontier has no blocked items');
  for (const [name, ref] of Object.entries(frontierState.adjacentFrontiers)) {
    group.check(existsSync(join(ROOT, ref.stateFile ?? ref)), `adjacent frontier ${name} references an existing state file`);
  }

  group.scenario('program-state records WORK-001..WORK-033 all complete');
  const programState = readJson('spec/development-state/program-state.json');
  group.equal(programState.architecture, 'v0.1', 'program-state architecture is v0.1');
  group.equal(programState.status, 'complete', 'program-state status is complete');
  const workIds = Object.keys(programState.workOrderStatus);
  group.equal(workIds.length, 33, 'program-state records exactly 33 work orders');
  for (let i = 1; i <= 33; i += 1) {
    const id = `WORK-${String(i).padStart(3, '0')}`;
    group.equal(programState.workOrderStatus[id], 'complete', `${id} is recorded complete`);
  }

  group.scenario('the frozen protocol architecture directory is present');
  group.check(existsSync(join(ROOT, 'spec/architecture/v0.1')), 'spec/architecture/v0.1/ exists (frozen)');
  group.check(existsSync(join(ROOT, 'spec/architecture/v0.1/README.md')), 'the frozen architecture README exists');

  group.scenario('the governance validator passes 17/17 (spawned, RESULT line parsed)');
  const gov = spawnValidator('python3', ['scripts/validate_governance.py']);
  group.equal(gov.exit, 0, 'validate_governance.py exits 0');
  const resultLine = gov.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('RESULT:'));
  group.check(resultLine !== undefined, 'the governance validator printed a RESULT line');
  const match = /^RESULT: PASS — (\d+) authority paths validated \((\d+) present, (\d+) sibling-wave pending\), 0 errors$/.exec(resultLine);
  group.check(match !== null, `the RESULT line is the PASS form (got: ${resultLine})`);
  group.equal(Number(match[1]), 17, '17 authority paths validated');
  group.equal(Number(match[2]), 17, 'all 17 present');
});

// ---------------------------------------------------------------------------
// Bullet 2 — product FINAL (UI-001..UI-010 required; UI-011 recorded additive).
// ---------------------------------------------------------------------------
await runGroup('closure:product-final', (group) => {
  group.scenario('the product program is CLOSED at the UI-010 closure target');
  const productState = readJson('spec/development-state/product-program-state.json');
  group.equal(productState.status, 'closed', 'product-program-state status is closed');
  group.equal(productState.closureTarget, 'UI-010', 'the product closure target is UI-010');
  group.equal(productState.frontier, null, 'the closed product program has no frontier');

  group.scenario('every recorded product merge (UI-001..UI-011) is an ancestor of HEAD with subject containment');
  const required = [];
  for (let i = 1; i <= 10; i += 1) required.push(`UI-${String(i).padStart(3, '0')}`);
  for (const item of required) {
    const entry = productState.workItems[item];
    group.check(entry !== undefined, `${item} is recorded in the product state`);
    group.equal(entry.status, 'merged', `${item} status is merged`);
    const merge = /^([0-9a-f]{7,40}) \(PR #(\d+)\)$/.exec(entry.merge);
    group.check(merge !== null, `${item} records a merge fact`);
    const proof = proveMergeFact(merge[1], item);
    group.check(proof.ancestor, `${item} merge ${merge[1]} is an ancestor of HEAD`);
    group.check(proof.containment, `${item} merge subject contains the work item id`);
  }

  group.scenario('UI-011 (the port re-anchoring) is recorded as the additive hardening item beyond the required closure target');
  const ui011 = productState.workItems['UI-011'];
  group.check(ui011 !== undefined, 'UI-011 is recorded in the product state');
  group.equal(ui011.status, 'merged', 'UI-011 status is merged');
  const ui011Merge = /^([0-9a-f]{7,40}) \(PR #(\d+)\)$/.exec(ui011.merge);
  group.check(ui011Merge !== null, 'UI-011 records a merge fact');
  const ui011Proof = proveMergeFact(ui011Merge[1], 'UI-011');
  group.check(ui011Proof.ancestor, `UI-011 merge ${ui011Merge[1]} is an ancestor of HEAD`);
  group.check(ui011Proof.containment, 'UI-011 merge subject contains the work item id');
  group.note('UI-011 rides the RTN wave (rulings delta 6) and does not gate DEP-004 — recorded additive, per the dispatch note');
});

// ---------------------------------------------------------------------------
// Bullet 3 — deployment FINAL with operational evidence.
// ---------------------------------------------------------------------------
await runGroup('closure:deployment-final', (group) => {
  group.scenario('every recorded deployment merge (DEP-001..DEP-008) is an ancestor of HEAD with subject containment');
  const systemState = readJson('spec/development-state/system-program-state.json');
  const progress = systemState.deploymentProgress;
  for (let i = 1; i <= 8; i += 1) {
    const item = `DEP-${String(i).padStart(3, '0')}`;
    const entry = progress[item];
    group.check(typeof entry === 'string', `${item} is recorded in deploymentProgress`);
    const merge = /^merged ([0-9a-f]{7,40}) \(PR #(\d+)\)/.exec(entry);
    group.check(merge !== null, `${item} records a merge fact`);
    const proof = proveMergeFact(merge[1], item);
    group.check(proof.ancestor, `${item} merge ${merge[1]} is an ancestor of HEAD`);
    group.check(proof.containment, `${item} merge subject contains the work item id`);
  }

  group.scenario('the DEP-008 readiness transcript exists with its verdict recorded');
  const transcript = readText('deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md');
  group.check(transcript.includes(DEP008_RECORD_ID), 'the transcript names the release record id');
  group.check(
    transcript.includes('ed673d7d220002186b1d06082b55321d58e04a38'),
    'the transcript names the frozen release revision',
  );
  group.check(transcript.includes('RECOMMENDATION TO THE ARCHITECT'), 'the transcript records the Architect recommendation');
  group.check(
    transcript.includes('approve') && transcript.includes('conditions'),
    'the recommendation is approve-with-conditions (the recorded verdict form)',
  );
  group.check(
    readText('spec/deployment/production-readiness.md').includes('production deployment binding stays FUTURE-WORK'),
    'the readiness contract records the production binding as FUTURE-WORK (the sandbox-class boundary)',
  );

  group.scenario('the DEP-008 release record exists in the promotion store, all-green');
  const records = readText('deploy/promotions/promotion-records.jsonl')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const releaseRecord = records.find((r) => r.type === 'promotion-record' && r.record_id === DEP008_RECORD_ID);
  group.check(releaseRecord !== undefined, 'the DEP-008 release record exists (append-only store)');
  group.equal(releaseRecord.revision.commit_sha, 'ed673d7d220002186b1d06082b55321d58e04a38', 'the record freezes the release revision');
  group.equal(releaseRecord.gate_verdict.passed, true, "the record's gate table is all-green");

  group.scenario('the release-record orphan condition is ACKNOWLEDGED with its recorded Lead disposition');
  group.check(liveMatrix !== null, `the live matrix derivation succeeded (derivation error: ${derivationError?.message ?? 'none'})`);
  const orphanIsAncestor = gitOk('merge-base', '--is-ancestor', releaseRecord.revision.commit_sha, 'HEAD');
  group.equal(orphanIsAncestor, false, 'the known condition holds: the release revision is orphaned by PR #39 squash-merge (NOT an ancestor of HEAD)');
  const carries = gitOk('merge-base', '--is-ancestor', '8d713f1', 'HEAD');
  group.check(carries, 'the content-carrying squash merge 8d713f1 IS an ancestor of HEAD');
  const handoff = liveMatrix.honest_handoff.lead_disposition_ledger;
  const orphanRow = handoff.find((row) => row.summary.includes('orphan') && row.summary.includes('ed673d7'));
  group.check(orphanRow !== undefined, 'the honest-handoff ledger carries the orphan row with its recorded disposition');
  group.check(
    orphanRow && /disposition/i.test(orphanRow.disposition) && orphanRow.owner.length > 0,
    'the orphan row records an owner and a disposition (closed-out honesty, not an open defect)',
  );
  group.note('the DEP-008 readiness harness base failure signature (proof:release-identity assertion #32 — the orphan) is Lead-dispositioned at next governance touch; this gate acknowledges it and never chases it');

  group.scenario('the deployment contract validator passes (spawned, result parsed)');
  const dep = spawnValidator('python3', ['scripts/validate_deployment.py']);
  group.equal(dep.exit, 0, 'validate_deployment.py exits 0');
  const checks = /checks performed: (\d+)/.exec(dep.stdout);
  const result = /result: (\w+)/.exec(dep.stdout);
  group.check(checks !== null, 'the deployment validator printed its check count');
  group.check(result !== null, 'the deployment validator printed its result');
  group.equal(result?.[1], 'PASS', 'the deployment contract result is PASS');
  group.check(Number(checks?.[1]) > 0, 'the deployment contract ran a non-zero check battery');
});

// ---------------------------------------------------------------------------
// Bullet 4 — SYS-001 and SYS-002 are PASS.
// ---------------------------------------------------------------------------
await runGroup('closure:sys-programs', (group) => {
  group.scenario('the SYS-001 and SYS-002 squash merges are ancestors of HEAD');
  for (const [item, sha] of [['SYS-001', SYS001_SQUASH], ['SYS-002', SYS002_SQUASH]]) {
    const proof = proveMergeFact(sha, item);
    group.check(proof.ancestor, `${item} squash merge ${sha} is an ancestor of HEAD`);
    group.check(proof.containment, `${item} merge subject contains the work item id`);
  }

  group.scenario('the SYS-001 reconciliation matrix exists with all-green recorded results');
  const matrixJson = readJson('spec/system-reconciliation-matrix.json');
  group.equal(matrixJson.generated_by, 'SYS-001', 'the matrix is the SYS-001 artifact');
  group.equal(matrixJson.harness, 'scripts/test_system_reconciliation.mjs', 'the matrix names its live harness');
  group.deepEqual(
    matrixJson.hop_names,
    ['product_action', 'canonical_protocol_object', 'owning_authority', 'api_runtime_boundary', 'deployment_component', 'durable_state_evidence', 'user_visible_outcome'],
    'the seven-hop vocabulary is the contract invariant',
  );
  group.equal(matrixJson.journeys.length, 8, 'eight journeys are recorded');
  for (const journey of matrixJson.journeys) {
    for (const hop of matrixJson.hop_names) {
      const cell = journey.hops?.[hop];
      group.check(
        cell !== null && typeof cell === 'object' && Object.keys(cell).length > 0,
        `${journey.journey_id}: hop ${hop} is present (no hand-waving cells)`,
      );
    }
  }
  group.check(existsSync(join(ROOT, 'spec/system-reconciliation-matrix.md')), 'the human matrix companion exists');
  group.check(existsSync(join(ROOT, 'scripts/test_system_reconciliation.mjs')), 'the SYS-001 live harness exists (kept green in the repo battery)');

  group.scenario('the SYS-002 dogfood corpus-index exists with all-green recorded results');
  const corpus = readJson('spec/system-dogfood/corpus-index.json');
  group.equal(corpus.type, 'sys-002-dogfood-corpus-index', 'the corpus index is the SYS-002 artifact');
  group.equal(corpus.scenarios.length, 12, 'twelve required scenarios are recorded');
  for (const scenario of corpus.scenarios) {
    group.equal(scenario.result, 'PASS', `${scenario.scenario_id} records PASS`);
  }
  group.equal(corpus.findings.length, 9, 'the 9 honest findings are recorded');
  const corpusRevision = corpus.revision.commit_sha;
  group.check(
    gitOk('merge-base', '--is-ancestor', corpusRevision, 'HEAD'),
    'the corpus records a run-time revision that resolves and is an ancestor of HEAD',
  );
  group.check(existsSync(join(ROOT, 'spec/system-dogfood/run-manifest.json')), 'the run manifest exists');
  const manifest = readJson('spec/system-dogfood/run-manifest.json');
  group.equal(manifest.findings_count, 9, 'the run manifest agrees on the findings count');
  group.equal(manifest.drive_legs.determinism.result, 'identical receipts', 'the determinism double-run is recorded identical');
  group.equal(manifest.drive_legs.determinism.receipt_count, 7, 'the determinism receipts count is recorded');
  group.check(existsSync(join(ROOT, 'scripts/test_full_system_dogfood.mjs')), 'the SYS-002 live harness exists (kept green in the repo battery)');
});

// ---------------------------------------------------------------------------
// Bullet 5 — the exact release revision, read at run time.
// ---------------------------------------------------------------------------
await runGroup('closure:release-revision', (group) => {
  group.scenario('the exact release revision is read from the repo at run time');
  releaseRevision.commit = gitExec('rev-parse', 'HEAD');
  releaseRevision.tree = gitExec('rev-parse', 'HEAD^{tree}');
  group.check(/^[0-9a-f]{40}$/.test(releaseRevision.commit), 'HEAD resolves to a full commit SHA');
  group.check(/^[0-9a-f]{40}$/.test(releaseRevision.tree), 'HEAD^{tree} resolves to a full tree SHA');
  group.note(`release revision (run-time read): commit ${releaseRevision.commit} tree ${releaseRevision.tree}`);

  group.scenario('the dispatch base is verified as an ancestor of the release revision');
  group.check(
    gitOk('merge-base', '--is-ancestor', DISPATCH_BASE, 'HEAD'),
    `the SYS-003 dispatch base ${DISPATCH_BASE} is an ancestor of HEAD`,
  );

  group.scenario('the working tree state is recorded (stderr evidence only — stdout stays deterministic)');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const statusLines = (status.stdout ?? '').split('\n').filter(Boolean);
  process.stderr.write(
    `closure gate working-tree state: ${statusLines.length === 0 ? 'CLEAN' : `${statusLines.length} entries (uncommitted/untracked — recorded, not a failure)`}\n`,
  );
  for (const line of statusLines.slice(0, 20)) {
    process.stderr.write(`  ${line}\n`);
  }
});

// ---------------------------------------------------------------------------
// Bullet 6 — machine state agrees with Git history.
// ---------------------------------------------------------------------------
await runGroup('closure:state-sync', (group) => {
  group.scenario('every recorded merge fact in every development-state file validates against Git');
  group.check(liveMatrix !== null, `the live matrix derivation succeeded (derivation error: ${derivationError?.message ?? 'none'})`);
  // The live matrix derivation already proves every recorded merge fact
  // (ancestor + subject containment) — the totals are its proof surface.
  // The only acceptance row allowed to lack a recorded merge fact is the
  // SYS-003 self row in its DRAFT phase (pre-merge); at the Lead finalize
  // the state records the SYS-003 merge and the regenerated matrix carries
  // its proof like every other row.
  const rowsWithoutMerge = Object.values(liveMatrix.layers)
    .flat()
    .filter((row) => row.recorded_merge === null || row.recorded_merge === undefined)
    .map((row) => row.item);
  group.check(
    rowsWithoutMerge.length <= 1 && rowsWithoutMerge.every((item) => item === 'SYS-003'),
    'no acceptance row other than the SYS-003 draft self row lacks a merge fact (never a silent gap)',
  );
  group.check(liveMatrix.totals.rows_with_recorded_merge >= 69, 'the state files record the full expected merge-fact surface (>= 69)');
  group.equal(liveMatrix.totals.rows_ancestor_of_head, liveMatrix.totals.rows_with_recorded_merge, 'every recorded merge is an ancestor of HEAD');
  group.equal(liveMatrix.totals.rows_subject_containment, liveMatrix.totals.rows_with_recorded_merge, 'every recorded merge subject contains its work item');
  group.equal(liveMatrix.totals.handoff_rows_missing_disposition, 0, 'no honest-handoff row is missing its disposition (stop condition otherwise)');

  group.scenario('cross-file agreements hold (the governance revision is the GOV-001 bootstrap merge)');
  const systemState = readJson('spec/development-state/system-program-state.json');
  const govBootstrap = /^GOV-001: ([0-9a-f]{7,40})/.exec(
    systemState.bootstrap.merged.find((line) => line.startsWith('GOV-001:')),
  );
  group.check(govBootstrap !== null, 'the bootstrap records the GOV-001 merge');
  const mergedGovSha = systemState.mergedGovernanceRevision;
  group.check(
    mergedGovSha.startsWith(govBootstrap[1]) || govBootstrap[1].startsWith(mergedGovSha.slice(0, 7)),
    'mergedGovernanceRevision agrees with the GOV-001 bootstrap SHA (prefix match)',
  );
  group.check(gitOk('merge-base', '--is-ancestor', mergedGovSha, 'HEAD'), 'the merged governance revision is an ancestor of HEAD');
  const frontierState = readJson('spec/development-state/frontier-state.json');
  group.check(existsSync(join(ROOT, frontierState.adjacentFrontiers.product.stateFile)), 'frontier-state product reference resolves');
  group.check(existsSync(join(ROOT, frontierState.adjacentFrontiers.deployment.stateFile)), 'frontier-state deployment reference resolves');
  group.check(existsSync(join(ROOT, frontierState.adjacentFrontiers.deployment.workGraph)), 'frontier-state work graph reference resolves');

  group.scenario('no state file claims an open/blocked frontier item that is actually merged (or vice versa)');
  group.deepEqual(
    readJson('spec/development-state/frontier-state.json').frontier.openItems,
    [],
    'the protocol frontier claims no open items (protocol frozen — merged complete)',
  );
  const productState = readJson('spec/development-state/product-program-state.json');
  group.equal(productState.status, 'closed', 'the product program state is closed (all items merged)');
  group.equal(productState.frontier, null, 'the product frontier claims no open items');
  // The SYS-003 live-closure consistency check — valid in BOTH phases of the
  // governed flow (fail-closed on stale state in either direction). The
  // machine-checkable invariants (no fragile prose parsing):
  //   1. a recorded SYS-003 merge fact must be REAL (its SHA an ancestor of
  //      HEAD — fabrication/staleness check);
  //   2. while SYS-003 is NOT recorded merged, the program status must not
  //      claim 'complete' (a premature completion claim is stale state);
  //   3. once SYS-003 IS recorded merged, no frontier line may still carry
  //      the machine-recorded "SYS-003 DISPATCHABLE" vocabulary (stale).
  const sys003MergedEntry =
    typeof systemState.deploymentProgress['SYS-003'] === 'string'
      ? systemState.deploymentProgress['SYS-003']
      : systemState.activeWork.find((line) => line.startsWith('SYS-003 MERGED')) ?? null;
  const frontierLines = [...systemState.frontier, ...systemState.deploymentProgress.frontier];
  if (sys003MergedEntry !== null) {
    const sys003Merge = /(?:merged )?([0-9a-f]{7,40})/.exec(sys003MergedEntry);
    group.check(sys003Merge !== null, 'the recorded SYS-003 merge fact is parseable');
    group.check(
      gitOk('merge-base', '--is-ancestor', sys003Merge[1], 'HEAD'),
      'the recorded SYS-003 merge is an ancestor of HEAD (the finalize flow)',
    );
    group.check(
      !frontierLines.some((line) => line.includes('SYS-003 DISPATCHABLE')),
      'SYS-003 recorded merged — no frontier line still carries the SYS-003 DISPATCHABLE vocabulary (stale)',
    );
    // Closure-hygiene hardening (Lead-applied contract delta, post-6114e4e
    // lineage): at the CLOSED state the machine frontier is EMPTY and the
    // residual surface lives in the explicit postClosure section. The
    // historical gate tolerated a stale "SYS-002 DISPATCHABLE" frontier line
    // (only the SYS-003 vocabulary was checked) — exactly the governance
    // smell the Architect's post-closure review flagged. Mechanical now:
    // ANY dispatchable-looking machine frontier line at the closed state is
    // stale state and fails the gate; the residuals must carry POST-CLOSURE
    // vocabulary in their own section, never frontier vocabulary.
    group.deepEqual(
      systemState.frontier,
      [],
      'SYS-003 recorded merged — the machine frontier is EMPTY at the closed state (residuals live in postClosure, never as frontier claims)',
    );
    group.check(
      Array.isArray(systemState.postClosure?.residualLedger),
      'the residual surface lives in the explicit postClosure section (POST-CLOSURE vocabulary, not frontier vocabulary)',
    );
    group.check(
      (systemState.postClosure?.residualLedger ?? []).some((line) => line.startsWith('Lead-disposition ledger')),
      'the Lead-disposition ledger is recorded as an explicit POST-CLOSURE residual (the honest-handoff source)',
    );
  } else {
    group.notEqual(
      systemState.status,
      'complete',
      'SYS-003 not yet recorded merged — the program status must not claim complete (a premature completion claim is stale state)',
    );
  }
  // SYS-002 is recorded merged AND claimed complete in the frontier — both
  // must agree with Git (the merged SHA is an ancestor).
  const sys002 = /^merged ([0-9a-f]{7,40})/.exec(systemState.deploymentProgress['SYS-002']);
  group.check(sys002 !== null, 'SYS-002 records its merge fact');
  group.check(gitOk('merge-base', '--is-ancestor', sys002[1], 'HEAD'), 'SYS-002 recorded merge is an ancestor (claimed-complete is supported)');

  group.scenario('the dependency-state file is structurally consistent (frozen graph)');
  const dependencyState = readJson('spec/development-state/dependency-state.json');
  group.equal(dependencyState.status, 'frozen', 'dependency-state status is frozen');
  group.equal(dependencyState.nodes.length, 24, 'the dependency graph has 24 nodes');
  group.equal(dependencyState.nodeCount, dependencyState.nodes.length, 'nodeCount agrees with the nodes array');
  group.equal(dependencyState.acyclic, true, 'the graph is recorded acyclic');
  group.deepEqual(dependencyState.roots, ['A01', 'A13', 'A15', 'A16'], 'the four roots are recorded');
  group.check(existsSync(join(ROOT, dependencyState.workOrderLevel.ledger)), 'the WORK-level ledger reference resolves');

  group.scenario('the stale spec status lines are acknowledged (the closure record supersedes them)');
  // Phase-aware: pre-merge the SYS-003 work order still carries its stale
  // BLOCKED line (the dispatch supersedes it; the closure record says so);
  // post-finalize the Lead updates the line and the supersession stays
  // documented in the closure record either way.
  const sys003Order = readText('spec/system-work-orders/SYS-003.md');
  if (sys003Order.includes('**Status:** BLOCKED')) {
    group.note("SYS-003's own work order status line is the recorded stale line (dispatch supersedes; the closure record says so)");
  } else {
    group.note('the SYS-003 work order status line is no longer BLOCKED (finalized at the Lead finalize)');
  }
  const closureRecord = readText('spec/system-closure/closure-record.md');
  group.check(
    closureRecord.includes('stale') && closureRecord.includes('BLOCKED'),
    'the closure record explicitly supersedes the stale BLOCKED status lines',
  );
});

// ---------------------------------------------------------------------------
// Bullet 7 — the closure record (the Architect signs it in the Lead
// finalize; this gate proves the record, never the approval).
// ---------------------------------------------------------------------------
await runGroup('closure:closure-corpus', (group) => {
  group.scenario('the final reconciliation matrix is committed and matches the live re-derivation');
  group.check(liveMatrix !== null, `the live matrix derivation succeeded (derivation error: ${derivationError?.message ?? 'none'})`);
  const committedMatrix = readJson('spec/system-closure/final-reconciliation-matrix.json');
  group.equal(committedMatrix.matrix, 'payswap-final-reconciliation-matrix', 'the committed machine artifact declares its identity');
  group.equal(committedMatrix.generator, 'scripts/generate_final_reconciliation_matrix.mjs', 'the matrix names its generator');
  group.deepEqual(committedMatrix.layers, liveMatrix.layers, 'the committed matrix layers match the live derivation (no staleness, no hand edits)');
  group.deepEqual(committedMatrix.honest_handoff, liveMatrix.honest_handoff, 'the committed honest-handoff ledger matches the live derivation');
  group.deepEqual(committedMatrix.totals, liveMatrix.totals, 'the committed totals match the live derivation');
  group.check(
    /^[0-9a-f]{40}$/.test(committedMatrix.generation.base_commit),
    'the generation provenance records a full base commit SHA',
  );
  group.check(
    gitOk('merge-base', '--is-ancestor', committedMatrix.generation.base_commit, 'HEAD'),
    'the recorded generation base is an ancestor of HEAD (provenance)',
  );

  group.scenario('the human matrix mirror documents every row');
  const matrixMd = readText('spec/system-closure/final-reconciliation-matrix.md');
  for (const row of Object.values(committedMatrix.layers).flat()) {
    group.check(matrixMd.includes(row.item), `the md matrix documents ${row.item}`);
  }
  for (const row of Object.values(committedMatrix.honest_handoff).flat()) {
    group.check(matrixMd.includes(row.id), `the md matrix documents handoff row ${row.id}`);
  }
  group.check(
    matrixMd.includes(`acceptance-surface rows: **${committedMatrix.totals.acceptance_surface_rows}**`),
    'the md matrix records the acceptance-surface total',
  );

  group.scenario('the state synchronization proof names the five state files');
  const proof = readText('spec/system-closure/state-synchronization-proof.md');
  for (const stateFile of [
    'spec/development-state/program-state.json',
    'spec/development-state/frontier-state.json',
    'spec/development-state/product-program-state.json',
    'spec/development-state/system-program-state.json',
    'spec/development-state/dependency-state.json',
  ]) {
    group.check(proof.includes(stateFile), `the proof covers ${stateFile}`);
  }

  group.scenario('the closure record carries the clearly-marked Architect sign-off block (PENDING in the worker phase; RECORDED after the Lead finalize)');
  const record = readText('spec/system-closure/closure-record.md');
  // Lead-applied delta (post-finalize first exercise): the sign-off block is
  // phase-bound by design — PENDING while the worker owns the draft,
  // RECORDED once the Architect has approved, merged and finalized. The
  // worker NEVER signs; the gate asserts the block exists, is clearly
  // marked with its phase, and the finalize never removes it.
  group.check(
    record.includes('Architect sign-off: PENDING (Lead finalize)') ||
      record.includes('Architect sign-off: RECORDED (Lead finalize'),
    'the closure record carries the clearly-marked sign-off block (PENDING or RECORDED — never absent, never worker-signed)',
  );
  for (const marker of [
    '## The program being closed',
    '## The acceptance mapping',
    '## The exact release revision',
    '## The sandbox-environment disclaimer',
    '## The honest-handoff ledger',
    '## The stop-condition audit',
  ]) {
    group.check(record.includes(marker), `the closure record has section ${marker}`);
  }
  group.check(
    record.includes('closure-verdict') && record.includes('scripts/test_system_closure.mjs'),
    'the closure record binds the acceptance mapping to the closure gate verdict',
  );
  group.check(
    record.includes('never hand-written') || record.includes('run time'),
    'the closure record records the run-time release revision mechanism',
  );

  group.scenario('the closure corpus index lists every artifact');
  const index = readText('spec/system-closure/README.md');
  for (const artifact of [
    'final-reconciliation-matrix.json',
    'final-reconciliation-matrix.md',
    'state-synchronization-proof.md',
    'closure-record.md',
    'README.md',
  ]) {
    group.check(index.includes(artifact), `the index lists ${artifact}`);
  }
  group.check(index.includes('generate_final_reconciliation_matrix.mjs'), 'the index names the generator');
  group.check(index.includes('test_system_closure.mjs'), 'the index names the closure gate');
});

// ---------------------------------------------------------------------------
// The report (stdout — byte-deterministic).
// ---------------------------------------------------------------------------
process.stdout.write('\nSYS-003 system closure proof (the seven acceptance bullets)\n');
process.stdout.write('='.repeat(78) + '\n');
const header = ['closure group (acceptance bullet)', 'scenarios', 'assertions', 'result'];
process.stdout.write(header.map((cell) => String(cell).padEnd(40)).join('') + '\n');
process.stdout.write('-'.repeat(78) + '\n');
const scenariosTotal = groupResults.reduce((sum, r) => sum + r.scenarios, 0);
for (const row of groupResults) {
  const line = [row.group, String(row.scenarios), String(row.assertions), row.result];
  process.stdout.write(line.map((cell) => String(cell).padEnd(40)).join('') + '\n');
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(
  `TOTAL: ${scenariosTotal} scenarios / ${liveAssertions} assertions / ${failure === null ? 'PASS' : 'FAIL'}\n`,
);

process.stdout.write('\nClosure evidence notes (deterministic)\n');
process.stdout.write('-'.repeat(78) + '\n');
for (const ledger of groupLedgers) {
  process.stdout.write(`${ledger.name}:\n`);
  for (const note of ledger.notes()) {
    if (!note.startsWith('#')) {
      process.stdout.write(`  ${note}\n`);
    }
  }
}

// The per-bullet verdict mapping (bullet -> group -> evidence pointers).
const bulletMapping = [
  {
    bullet: 'protocol-v0.1-frozen-and-WORK-001..033-complete',
    group: 'closure:protocol-frozen',
    evidence: [
      'spec/development-state/frontier-state.json (empty frontier, v0.1 complete)',
      'spec/development-state/program-state.json (WORK-001..033 complete)',
      'scripts/validate_governance.py RESULT line (17/17)',
    ],
  },
  {
    bullet: 'product-UI-001..UI-010-FINAL',
    group: 'closure:product-final',
    evidence: [
      'spec/development-state/product-program-state.json (CLOSED at UI-010)',
      'git merge-base --is-ancestor <each UI merge> HEAD',
    ],
  },
  {
    bullet: 'deployment-DEP-001..DEP-008-FINAL-with-operational-evidence',
    group: 'closure:deployment-final',
    evidence: [
      'spec/development-state/system-program-state.json#deploymentProgress',
      'deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md',
      'deploy/promotions/promotion-records.jsonl (release record, all-green)',
      'scripts/validate_deployment.py result line',
    ],
  },
  {
    bullet: 'SYS-001-and-SYS-002-PASS',
    group: 'closure:sys-programs',
    evidence: [
      'git merge-base --is-ancestor 6ec6b38 / 967519a HEAD',
      'spec/system-reconciliation-matrix.json (8 journeys x 7 hops)',
      'spec/system-dogfood/corpus-index.json (12/12 PASS, 9 findings)',
    ],
  },
  {
    bullet: 'exact-release-revision-verified',
    group: 'closure:release-revision',
    evidence: ['git rev-parse HEAD / HEAD^{tree} (run-time read — this verdict line)'],
  },
  {
    bullet: 'machine-state-agrees-with-git-history',
    group: 'closure:state-sync',
    evidence: [
      'spec/development-state/*.json (all five parsed; every recorded merge fact proven)',
      'scripts/generate_final_reconciliation_matrix.mjs (the live derivation)',
    ],
  },
  {
    bullet: 'architect-closure-record',
    group: 'closure:closure-corpus',
    evidence: [
      'spec/system-closure/closure-record.md (the sign-off block: PENDING in the worker phase; RECORDED after the Lead finalize — the gate asserts its presence and phase marking)',
      'spec/system-closure/final-reconciliation-matrix.json (live-verified)',
    ],
  },
];
const groupByBullet = new Map(groupResults.map((r) => [r.group, r.result]));
const bullets = bulletMapping.map((entry) => ({
  bullet: entry.bullet,
  result: groupByBullet.get(entry.group) ?? 'FAIL',
  evidence: entry.evidence,
}));

const verdict = {
  type: 'closure-verdict',
  passed: failure === null,
  bullets_total: bullets.length,
  bullets_failed: bullets.filter((b) => b.result !== 'PASS').length,
  bullets,
  release_revision: {
    commit: releaseRevision.commit,
    tree: releaseRevision.tree,
    read_at_run_time: 'git rev-parse HEAD / HEAD^{tree} — never hand-written',
  },
  dispatch_base: { commit: DISPATCH_BASE, verified_ancestor_of_head: true },
  architect_closure: (readText('spec/system-closure/closure-record.md').includes('Architect sign-off: RECORDED (Lead finalize')
    ? 'closure record SIGNED by the Architect (Lead finalize) — the approval, merge and finalization are recorded; this gate re-derives every acceptance bullet at the closed state'
    : 'closure-record DRAFT complete; Architect sign-off: PENDING (Lead finalize) — the approval, merge and finalization are the Lead finalize, never claimed by this gate'),
  sandbox_class: 'this gate proves the REPOSITORY system; production claims stay gated on the DEP-002+ production deployment binding',
  harness: HARNESS_NAME,
};
process.stdout.write(`${JSON.stringify(verdict)}\n`);

if (failure !== null) {
  process.stderr.write(`${HARNESS_NAME}: FAILED — ${failure.message}\n`);
  process.exit(1);
}
// Phase-aware closing message (closure-hygiene contract delta): the record's
// phase is already machine-read for the verdict's architect_closure field —
// the closing message must not contradict it with stale DRAFT vocabulary at
// the closed state.
process.stderr.write(
  readText('spec/system-closure/closure-record.md').includes('Architect sign-off: RECORDED (Lead finalize')
    ? `${HARNESS_NAME}: all closure groups green (every SYS-003 acceptance bullet mechanically proven; the closure record is SIGNED and RECORDED — the closed state is the steady state, and the machine frontier is empty by assertion).\n`
    : `${HARNESS_NAME}: all closure groups green (every SYS-003 acceptance bullet mechanically proven; the record DRAFT awaits the Lead finalize).\n`,
);
process.exit(0);
