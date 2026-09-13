#!/usr/bin/env node
/**
 * SYS-003 — the final reconciliation matrix generator (family B).
 *
 * Machine-generates the final reconciliation matrix from the ONLY two sources
 * of truth the closure owns: the development-state files and Git history.
 * NEVER hand-typed — the JSON is the machine artifact, the .md its human
 * mirror, and `scripts/test_system_closure.mjs` (the closure gate) re-derives
 * every row at run time and fails closed on any divergence between the
 * committed matrix and the live derivation.
 *
 * Row surface (the complete SYS-003 acceptance surface):
 *
 *   protocol-frozen   WORK-001..WORK-033  (the frozen v0.1 authoring program;
 *                                         merged-as protocol-v0.1-materialization,
 *                                         landed in-repo by the ARCH-001
 *                                         bootstrap merge)
 *   bootstrap         ARCH-001, PROD-001, GOV-001
 *   protocol-runtime  RTN-001..RTN-012    (the A01–A16 operational spine the
 *                                         DEP-004 dispatch gate required)
 *   product           UI-001..UI-011      (closure target UI-010; UI-011 is
 *                                         the recorded additive hardening item
 *                                         beyond the required UI-001..010)
 *   deployment        DEP-001..DEP-008    (closure target DEP-008)
 *   system            SYS-001, SYS-002, SYS-003 (the self row)
 *
 * Columns: work item -> governing evidence artifact -> recorded merge SHA ->
 * ancestor-of-HEAD proof -> subject containment -> status.
 *
 * The honest-handoff ledger (each row with its owner and its RECORDED
 * disposition — a deferral with an owner and a recorded rationale is
 * closed-out honesty, NOT an open defect; a missing disposition is a stop
 * condition and fails the generator closed):
 *
 *   sys002_findings          the 9 SYS-002 dogfood findings
 *                            (spec/system-dogfood/corpus-index.json)
 *   deferral_ledger          D-1..D-9 (spec/product/closure/deferral-ledger.md,
 *                            dispositions from the product program's machine
 *                            state closure note)
 *   dep008_conditions        the 3 recorded conditions of the Tech Lead's
 *                            DEP-008 approval (system-program-state.json)
 *   lead_disposition_ledger  the 3 Lead-dispositioned non-blocking conditions
 *                            (system-program-state.json frontier — includes
 *                            the DEP-008 release-record orphan)
 *
 * DETERMINISM: the derivation is a pure function of the repository content
 * (state files + Git history) — no timestamps, no wall clock, no run-order
 * variance. The generation provenance block (base commit) records the
 * generation-time HEAD; it is provenance only and is excluded from the gate's
 * live re-derivation comparison. Regenerate:
 *
 *   node scripts/generate_final_reconciliation_matrix.mjs
 *
 * (additive SYS-003 delivery; composes the state files and git — never
 * modifies anything).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GENERATOR_NAME = 'scripts/generate_final_reconciliation_matrix.mjs';

// ---------------------------------------------------------------------------
// Repository readers (git + files). All paths repo-relative.
// ---------------------------------------------------------------------------
export function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function gitOk(root, ...args) {
  try {
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function readText(root, relative) {
  const path = join(root, relative);
  if (!existsSync(path)) {
    throw new Error(`required file missing: ${relative}`);
  }
  return readFileSync(path, 'utf8');
}

export function readJson(root, relative) {
  return JSON.parse(readText(root, relative));
}

function fail(message) {
  throw new Error(`[matrix-generator] ${message}`);
}

// ---------------------------------------------------------------------------
// Recorded-merge parsers (the state files' recorded merge-fact vocabulary).
// ---------------------------------------------------------------------------
const MERGED_RE = /^merged ([0-9a-f]{7,40}) \(PR #(\d+)\)/;
const MERGE_FIELD_RE = /^([0-9a-f]{7,40}) \(PR #(\d+)\)$/;

/** Parse "merged <sha> (PR #N): description" state strings. */
export function parseMergedEntry(text) {
  const match = MERGED_RE.exec(text);
  if (!match) fail(`deploymentProgress entry does not record a merge fact: ${text.slice(0, 90)}…`);
  return { sha: match[1], pr: Number(match[2]) };
}

/** Parse the product state's "merge": "<sha> (PR #N)" fields. */
function parseMergeField(text) {
  const match = MERGE_FIELD_RE.exec(text);
  if (!match) fail(`product work item merge field malformed: ${text}`);
  return { sha: match[1], pr: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Git proofs (live, per run — the same proofs the closure gate re-runs).
// ---------------------------------------------------------------------------
function ancestorOfHead(root, sha) {
  return gitOk(root, 'merge-base', '--is-ancestor', sha, 'HEAD');
}

function subjectOf(root, sha) {
  return git(root, 'log', '--format=%s', '-n', '1', sha);
}

/** Case-insensitive work-item id containment over the commit subject. */
function subjectContainsItem(subject, itemId) {
  return subject.toLowerCase().includes(itemId.toLowerCase());
}

function proofRow(root, { item, title, layer, evidence, merge, status, note }) {
  const row = {
    item,
    title,
    layer,
    governing_evidence: evidence,
    status,
  };
  if (note) row.note = note;
  if (merge && merge.sha) {
    row.recorded_merge = { sha: merge.sha, pr: merge.pr ?? null, source: merge.source };
    row.commit_subject = subjectOf(root, merge.sha);
    row.ancestor_of_head = ancestorOfHead(root, merge.sha);
    row.subject_containment = subjectContainsItem(row.commit_subject, merge.itemAlias ?? item);
  } else if (merge && merge.materialization) {
    // The protocol authoring program: no per-item merge SHA exists — the
    // ledger records merged-as protocol-v0.1-materialization, landed by the
    // ARCH-001 bootstrap merge. The git proof anchors THAT merge.
    row.recorded_merge = { sha: null, merged_as: merge.merged_as, source: merge.source };
    row.materialization_merge = { sha: merge.materialization, source: merge.materialization_source };
    row.commit_subject = subjectOf(root, merge.materialization);
    row.ancestor_of_head = ancestorOfHead(root, merge.materialization);
    row.subject_containment = subjectContainsItem(row.commit_subject, merge.materialization_alias);
  } else {
    // The SYS-003 self row: this work item IS the closure under proof.
    row.recorded_merge = null;
    row.ancestor_of_head = null;
    row.subject_containment = null;
    row.note = note ?? 'the closure work item itself — its merge is the Lead finalize; the closure gate is the live proof';
  }
  return row;
}

// ---------------------------------------------------------------------------
// Layer derivations.
// ---------------------------------------------------------------------------
function protocolLayer(root) {
  const programState = readJson(root, 'spec/development-state/program-state.json');
  const frontierState = readJson(root, 'spec/development-state/frontier-state.json');
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const ledgerText = readText(root, 'spec/work-orders/WORK-ORDERS-LEDGER.md');

  // ARCH-001 — the protocol v0.1 materialization merge (bootstrap record).
  const bootArch = systemState.bootstrap.merged.find((line) => line.startsWith('ARCH-001:'));
  if (!bootArch) fail('system-program-state bootstrap.merged does not record ARCH-001');
  const archSha = /^ARCH-001: ([0-9a-f]{7,40})/.exec(bootArch)[1];

  // The 33 WORK rows from the ledger tables.
  const rows = [];
  const rowRe = /^\| (WORK-\d{3}) \| (.+?) \| ([^|]+) \| (COMPLETE) \| ([^|]+) \|$/;
  for (const line of ledgerText.split('\n')) {
    const match = rowRe.exec(line.trim());
    if (!match) continue;
    const [, item, title, , status, mergedAs] = match;
    const stateStatus = programState.workOrderStatus[item];
    if (stateStatus !== 'complete') {
      fail(`program-state.json does not record ${item} complete (found: ${stateStatus})`);
    }
    rows.push(
      proofRow(root, {
        item,
        title,
        layer: 'protocol-frozen',
        evidence: [
          `spec/work-orders/WORK-ORDERS-LEDGER.md#${item}`,
          'spec/development-state/program-state.json#workOrderStatus',
          'spec/development-state/frontier-state.json#frontier',
          'spec/architecture/v0.1/',
        ],
        merge: {
          sha: null,
          merged_as: mergedAs.trim(),
          source: 'spec/work-orders/WORK-ORDERS-LEDGER.md (merged-as)',
          materialization: archSha,
          materialization_source: 'spec/development-state/system-program-state.json#bootstrap.merged (ARCH-001)',
          materialization_alias: 'WORK-001..033',
        },
        status: status === 'COMPLETE' ? 'COMPLETE' : status,
      }),
    );
  }
  if (rows.length !== 33) {
    fail(`the ledger yielded ${rows.length} WORK rows (expected 33)`);
  }
  if (programState.status !== 'complete' || programState.architecture !== 'v0.1') {
    fail('program-state.json does not declare v0.1 complete');
  }
  if (
    frontierState.status !== 'complete' ||
    (frontierState.frontier.openItems ?? []).length !== 0 ||
    (frontierState.frontier.blockedItems ?? []).length !== 0
  ) {
    fail('frontier-state.json does not record an empty, complete protocol frontier');
  }
  return rows;
}

function bootstrapLayer(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const rows = [];
  const re = /^([A-Z]+-\d+): ([0-9a-f]{7,40}) \((.+)\)$/;
  for (const line of systemState.bootstrap.merged) {
    const match = re.exec(line);
    if (!match) fail(`bootstrap.merged entry unparseable: ${line}`);
    const [, item, sha, description] = match;
    rows.push(
      proofRow(root, {
        item,
        title: description,
        layer: 'bootstrap',
        evidence: ['spec/development-state/system-program-state.json#bootstrap.merged'],
        merge: { sha, source: 'spec/development-state/system-program-state.json#bootstrap.merged' },
        status: 'MERGED',
      }),
    );
  }
  if (rows.length !== 3) fail(`bootstrap.merged yielded ${rows.length} rows (expected 3)`);
  return rows;
}

function rtnLayer(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const record = systemState.rtnWave.mergeRecord;
  const rows = [];
  for (const item of Object.keys(record)) {
    const match = MERGE_FIELD_RE.exec(record[item]);
    if (!match) fail(`rtnWave.mergeRecord[${item}] malformed: ${record[item]}`);
    rows.push(
      proofRow(root, {
        item,
        title: `RTN materialization work order (${item})`,
        layer: 'protocol-runtime',
        evidence: [
          'spec/development-state/system-program-state.json#rtnWave.mergeRecord',
          'spec/protocol-runtime-work-orders/',
          `spec/development-state/rtn-plan-rulings.md (${item} schedule)`,
        ],
        merge: { sha: match[1], pr: Number(match[2]), source: 'spec/development-state/system-program-state.json#rtnWave.mergeRecord' },
        status: 'MERGED',
      }),
    );
  }
  if (rows.length !== 12) fail(`rtnWave.mergeRecord yielded ${rows.length} rows (expected 12)`);
  if (systemState.rtnWave.status !== 'complete') fail('rtnWave.status is not complete');
  return rows;
}

function productLayer(root) {
  const productState = readJson(root, 'spec/development-state/product-program-state.json');
  if (productState.status !== 'closed') fail('product-program-state.json status is not closed');
  if (productState.closureTarget !== 'UI-010') fail('product closureTarget is not UI-010');
  if (productState.frontier !== null) fail('product frontier is not null (closed program)');
  const rows = [];
  for (const [item, entry] of Object.entries(productState.workItems)) {
    const merge = parseMergeField(entry.merge);
    rows.push(
      proofRow(root, {
        item,
        title: entry.title,
        layer: 'product',
        evidence: [
          entry.workOrder && !entry.workOrder.startsWith('to be materialized')
            ? entry.workOrder
            : 'spec/product/work-items.md (UI-011 ledger item)',
          'spec/development-state/product-program-state.json#workItems',
        ],
        merge: { ...merge, source: 'spec/development-state/product-program-state.json#workItems' },
        status: 'FINAL',
        note:
          item === 'UI-010'
            ? 'the product closure target — program CLOSED by Tech Lead approval of the UI-010 closure submission (PR #35)'
            : item === 'UI-011'
              ? 'additive hardening item beyond the required UI-001..UI-010 closure target (RTN wave delta 6) — recorded as such, does not gate DEP-004'
              : undefined,
      }),
    );
  }
  if (rows.length !== 11) fail(`product workItems yielded ${rows.length} rows (expected 11)`);
  return rows;
}

function deploymentLayer(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const progress = systemState.deploymentProgress;
  const rows = [];
  for (const item of ['DEP-001', 'DEP-002', 'DEP-003', 'DEP-004', 'DEP-005', 'DEP-006', 'DEP-007', 'DEP-008']) {
    const entry = progress[item];
    if (typeof entry !== 'string') fail(`deploymentProgress missing ${item}`);
    const merge = parseMergedEntry(entry);
    const evidence = [
      `spec/system-work-orders/${item}.md`,
      'spec/development-state/system-program-state.json#deploymentProgress',
    ];
    if (item === 'DEP-008') {
      evidence.push('deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md', 'spec/deployment/production-readiness.md', 'deploy/promotions/promotion-records.jsonl (release record pr-1789278934747-9b83ecdc27)');
    }
    rows.push(
      proofRow(root, {
        item,
        title: entry.slice(entry.indexOf(':') + 1).trim().split(/[:—]/)[0].trim() || `${item} deployment work order`,
        layer: 'deployment',
        evidence,
        merge: { ...merge, source: 'spec/development-state/system-program-state.json#deploymentProgress' },
        status: item === 'DEP-008' ? 'FINAL-WITH-OPERATIONAL-EVIDENCE' : 'FINAL',
        note:
          item === 'DEP-008'
            ? 'the deployment closure target — DEPLOYMENT PROGRAM COMPLETE (DEP-001..008); production claims stay gated on the DEP-002+ production deployment binding'
            : undefined,
      }),
    );
  }
  return rows;
}

function systemLayer(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const progress = systemState.deploymentProgress;
  const rows = [];
  for (const item of ['SYS-001', 'SYS-002']) {
    const entry = progress[item];
    if (typeof entry !== 'string') fail(`deploymentProgress missing ${item}`);
    const merge = parseMergedEntry(entry);
    rows.push(
      proofRow(root, {
        item,
        title: item === 'SYS-001' ? 'three-architecture reconciliation' : 'full-system dogfood',
        layer: 'system',
        evidence:
          item === 'SYS-001'
            ? [
                'spec/system-reconciliation-matrix.json',
                'spec/system-reconciliation-matrix.md',
                'scripts/test_system_reconciliation.mjs',
                'scripts/test_transport_binding.mjs',
              ]
            : [
                'spec/system-dogfood/corpus-index.json',
                'spec/system-dogfood/run-manifest.json',
                'scripts/test_full_system_dogfood.mjs',
                'scripts/dogfood_determinism_probe.mjs',
              ],
        merge: { ...merge, source: 'spec/development-state/system-program-state.json#deploymentProgress' },
        status: 'PASS',
      }),
    );
  }
  // The SYS-003 self row. Pre-merge (the worker phase): the closure DRAFT —
  // this work item IS the closure under proof; its merge is the Lead
  // finalize. Post-finalize (the Lead regeneration): the machine state
  // records the SYS-003 merge and the row reflects it with its git proofs.
  const sys003Entry = progress['SYS-003'];
  if (typeof sys003Entry === 'string') {
    const merge = parseMergedEntry(sys003Entry);
    rows.push(
      proofRow(root, {
        item: 'SYS-003',
        title: 'system closure (this work item — merged at the Lead finalize)',
        layer: 'system',
        governing_evidence: [
          'spec/system-work-orders/SYS-003.md',
          'spec/system-closure/final-reconciliation-matrix.json',
          'spec/system-closure/final-reconciliation-matrix.md',
          'spec/system-closure/state-synchronization-proof.md',
          'spec/system-closure/closure-record.md',
          'scripts/test_system_closure.mjs',
        ],
        merge: { ...merge, source: 'spec/development-state/system-program-state.json#deploymentProgress' },
        status: 'MERGED (closure finalized)',
        note: 'the closure work item, merged by the Lead finalize (Architect approval + merge + finalization); the closure gate re-verified every acceptance bullet at the finalize revision',
      }),
    );
  } else {
    rows.push({
      item: 'SYS-003',
      title: 'system closure (this work item)',
      layer: 'system',
      governing_evidence: [
        'spec/system-work-orders/SYS-003.md',
        'spec/system-closure/final-reconciliation-matrix.json',
        'spec/system-closure/final-reconciliation-matrix.md',
        'spec/system-closure/state-synchronization-proof.md',
        'spec/system-closure/closure-record.md',
        'scripts/test_system_closure.mjs',
      ],
      recorded_merge: null,
      commit_subject: null,
      ancestor_of_head: null,
      subject_containment: null,
      status: 'CLOSURE-DRAFT',
      note:
        'the closure work item itself — the merge is the Lead finalize (Architect approval + merge + finalization); the closure gate is the live mechanical proof of every other acceptance bullet',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The honest-handoff ledger (owners + recorded dispositions, fail-closed).
// ---------------------------------------------------------------------------
function sys002Findings(root) {
  const corpus = readJson(root, 'spec/system-dogfood/corpus-index.json');
  if (corpus.type !== 'sys-002-dogfood-corpus-index') fail('corpus-index.json type mismatch');
  const findings = corpus.findings;
  if (!Array.isArray(findings) || findings.length !== 9) {
    fail(`corpus-index findings = ${findings?.length} (expected 9)`);
  }
  return findings.map((finding, index) => {
    const text = typeof finding === 'string' ? finding : finding.finding;
    if (!text) fail(`corpus finding ${index} carries no recorded text`);
    return {
      id: `SYS002-F${index + 1}`,
      source: `spec/system-dogfood/corpus-index.json#findings[${index}]`,
      summary: text,
      owner: finding.owning_work_item ?? 'SYS-002 evidence corpus (recorded in-corpus; non-blocking)',
      disposition:
        'recorded honestly in the SYS-002 corpus; the compensating evidence and the owning surface are named in the finding text itself',
      status: 'RECORDED',
    };
  });
}

function deferralLedger(root) {
  const ledgerText = readText(root, 'spec/product/closure/deferral-ledger.md');
  const productState = readJson(root, 'spec/development-state/product-program-state.json');
  const note = productState.note;

  // The Tech Lead dispositions recorded in the product program's closure note
  // (the machine state). Fail closed on every missing disposition.
  const extract = (re, label) => {
    const match = re.exec(note);
    if (!match) fail(`product-program-state closure note does not record ${label}`);
    return match[1].trim();
  };
  const dispositions = {
    'D-4': extract(/D-4 → ([^;]+)/, 'the D-4 disposition'),
    'D-5': extract(/D-5 → ([^;]+)/, 'the D-5 disposition'),
    'D-6': extract(/D-6 → ([^;]+)/, 'the D-6 disposition'),
    'D-7': extract(/D-7 WAIVER-1 — ACCEPTED ([^;]+)/, 'the D-7 disposition'),
    'D-8': extract(/D-8 → ([^;]+)/, 'the D-8 disposition'),
    'D-9': 'recorded, no action',
  };

  const rows = [];
  const headingRe = /^## (D-\d+) — (.+)$/;
  const sections = ledgerText.split(/^## /m).slice(1);
  for (const section of sections) {
    const firstLine = section.split('\n')[0];
    const match = headingRe.exec(`## ${firstLine}`);
    if (!match) continue;
    const [, id, rawTitle] = match;
    const resolved = /— RESOLVED \(SYS-001\)/.exec(`## ${firstLine}`);
    const title = rawTitle.replace(/ — RESOLVED \(SYS-001\)$/, '').trim();
    const resolutionMatch = /\*\*RESOLUTION \(SYS-001, base ([0-9a-f]{7,40})\):\*\*/.exec(section);
    let owner;
    let disposition;
    let status;
    if (resolved) {
      if (!resolutionMatch) fail(`${id} is marked RESOLVED but records no RESOLUTION line`);
      owner = 'SYS-001 (resolved by the transport-binding remediation)';
      disposition = `RESOLVED at SYS-001 base ${resolutionMatch[1]} — resolving evidence: the bind:d1/d2/d3 groups of scripts/test_transport_binding.mjs + the recon:journeys group of scripts/test_system_reconciliation.mjs`;
      status = 'RESOLVED';
    } else {
      const recorded = dispositions[id];
      if (!recorded) fail(`${id} has no recorded Tech Lead disposition in the product program state`);
      owner = recorded;
      disposition = `Tech Lead disposition recorded in the product program closure note: ${recorded}`;
      status = id === 'D-7' ? 'ACCEPTED (WAIVER-1)' : 'OPEN-OWNED';
    }
    rows.push({
      id,
      source: `spec/product/closure/deferral-ledger.md#${id}`,
      summary: title,
      owner,
      disposition,
      status,
    });
  }
  if (rows.length !== 9) fail(`deferral ledger yielded ${rows.length} rows (expected D-1..D-9)`);
  return rows;
}

function dep008Conditions(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  // The conditions of the Tech Lead's DEP-008 acceptance are recorded in the
  // machine state's activeWork ledger (the DEP-008 entry).
  const entry = systemState.activeWork.find((line) => line.startsWith('DEP-008 MERGED'));
  if (!entry) fail('system-program-state activeWork does not record the DEP-008 merge entry');
  const marker = 'conditions recorded: ';
  const at = entry.indexOf(marker);
  if (at === -1) fail('the DEP-008 activeWork entry does not record acceptance conditions');
  const end = entry.indexOf(')', at + marker.length);
  const body = entry.slice(at + marker.length, end === -1 ? undefined : end);
  const conditions = body.split('; ').map((c) => c.trim()).filter(Boolean);
  if (conditions.length !== 3) {
    fail(`DEP-008 recorded ${conditions.length} conditions (expected 3): ${JSON.stringify(conditions)}`);
  }
  return conditions.map((condition, index) => ({
    id: `DEP008-C${index + 1}`,
    source: 'spec/development-state/system-program-state.json#deploymentProgress.DEP-008',
    summary: condition,
    owner: 'Tech Lead (accepted; the named owning surface carries each condition)',
    disposition: `recorded condition of the Tech Lead acceptance of the DEP-008 approve-with-conditions recommendation: ${condition}`,
    status: 'ACCEPTED-CONDITION',
  }));
}

function leadDispositionLedger(root) {
  const systemState = readJson(root, 'spec/development-state/system-program-state.json');
  const frontier = systemState.frontier;
  const entry = frontier.find((s) => s.startsWith('Lead-disposition ledger'));
  if (!entry) fail('system-program-state frontier does not record the Lead-disposition ledger');
  const parts = entry.split(/\((\d)\) /).filter(Boolean);
  // parts: [ "Lead-disposition ledger (recorded, non-blocking): ", "1", text1, "2", text2, "3", text3 ]
  if (parts.length !== 7) fail(`Lead-disposition ledger parsed ${parts.length} segments (expected 7)`);
  const rows = [];
  for (let i = 1; i < 7; i += 2) {
    const number = parts[i];
    const text = parts[i + 1].trim().replace(/;$/, '');
    rows.push({
      id: `LD-${number}`,
      source: 'spec/development-state/system-program-state.json#frontier',
      summary: text,
      owner: 'Tech Lead (Lead-disposition ledger — recorded, non-blocking)',
      disposition: `Lead-dispositioned: ${text}`,
      status: 'DISPOSITIONED-NON-BLOCKING',
    });
  }
  if (rows.length !== 3) fail(`Lead-disposition ledger yielded ${rows.length} rows (expected 3)`);
  return rows;
}

// ---------------------------------------------------------------------------
// The pure derivation (deterministic; the closure gate re-runs this and
// compares against the committed matrix).
// ---------------------------------------------------------------------------
export function deriveMatrixContent(root) {
  const layers = {
    'protocol-frozen': protocolLayer(root),
    bootstrap: bootstrapLayer(root),
    'protocol-runtime': rtnLayer(root),
    product: productLayer(root),
    deployment: deploymentLayer(root),
    system: systemLayer(root),
  };
  const honest_handoff = {
    sys002_findings: sys002Findings(root),
    deferral_ledger: deferralLedger(root),
    dep008_conditions: dep008Conditions(root),
    lead_disposition_ledger: leadDispositionLedger(root),
  };

  const acceptanceRows = Object.values(layers).reduce((sum, rows) => sum + rows.length, 0);
  const handoffRows = Object.values(honest_handoff).reduce((sum, rows) => sum + rows.length, 0);
  const withGitProof = Object.values(layers)
    .flat()
    .filter((row) => row.recorded_merge !== null);
  const missingDispositions = Object.values(honest_handoff)
    .flat()
    .filter((row) => !row.owner || !row.disposition);

  const totals = {
    acceptance_surface_rows: acceptanceRows,
    honest_handoff_rows: handoffRows,
    rows_with_recorded_merge: withGitProof.length,
    rows_ancestor_of_head: withGitProof.filter((row) => row.ancestor_of_head === true).length,
    rows_subject_containment: withGitProof.filter((row) => row.subject_containment === true).length,
    handoff_rows_missing_disposition: missingDispositions.length,
  };
  return { layers, honest_handoff, totals };
}

export function generationContext(root) {
  return {
    base_commit: git(root, 'rev-parse', 'HEAD'),
    base_tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    note:
      'provenance only — read at generation; the closure gate re-derives every row at run time (ancestor + subject proofs against the live HEAD) and fails closed on divergence. The exact release revision is likewise read at run time by the closure gate — never hand-written.',
  };
}

export function buildMatrix(root) {
  const content = deriveMatrixContent(root);
  return {
    matrix: 'payswap-final-reconciliation-matrix',
    version: 1,
    generated_by: 'SYS-003',
    work_order: 'spec/system-work-orders/SYS-003.md',
    generator: GENERATOR_NAME,
    harness: 'scripts/test_system_closure.mjs',
    human_readable_companion: 'spec/system-closure/final-reconciliation-matrix.md',
    closure_record: 'spec/system-closure/closure-record.md',
    columns: [
      'work_item',
      'governing_evidence',
      'recorded_merge',
      'ancestor_of_head',
      'subject_containment',
      'status',
    ],
    generation: generationContext(root),
    ...content,
  };
}

// ---------------------------------------------------------------------------
// The human mirror (.md).
// ---------------------------------------------------------------------------
function mdEscape(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderRowMarkdown(row) {
  const merge = row.recorded_merge
    ? row.recorded_merge.sha
      ? `${row.recorded_merge.sha}${row.recorded_merge.pr ? ` (PR #${row.recorded_merge.pr})` : ''}`
      : `merged-as: ${row.recorded_merge.merged_as} (materialization ${row.materialization_merge.sha})`
    : '— (the Lead finalize)';
  const ancestor =
    row.ancestor_of_head === null ? 'self' : row.ancestor_of_head ? 'yes' : 'NO';
  const containment =
    row.subject_containment === null ? 'self' : row.subject_containment ? 'yes' : 'NO';
  return `| ${row.item} | ${mdEscape(row.title)} | ${mdEscape(row.governing_evidence[0])}${row.governing_evidence.length > 1 ? ` (+${row.governing_evidence.length - 1})` : ''} | ${merge} | ${ancestor} | ${containment} | ${row.status} |`;
}

function renderHandoffMarkdown(row) {
  return `| ${row.id} | ${mdEscape(row.summary.slice(0, 160))}${row.summary.length > 160 ? '…' : ''} | ${mdEscape(row.owner)} | ${mdEscape(row.disposition.slice(0, 200))}${row.disposition.length > 200 ? '…' : ''} | ${row.status} |`;
}

export function renderMarkdown(matrix) {
  const lines = [];
  lines.push('# PaySwap final reconciliation matrix — SYS-003');
  lines.push('');
  lines.push('**Status:** NORMATIVE SYSTEM CLOSURE EVIDENCE (SYS-003 deliverable)');
  lines.push('**Machine artifact:** `spec/system-closure/final-reconciliation-matrix.json` (this file is its human mirror — both machine-generated by `scripts/generate_final_reconciliation_matrix.mjs`; never hand-typed)');
  lines.push('**Closure gate:** `scripts/test_system_closure.mjs` (re-derives every row at run time and fails closed on divergence)');
  lines.push('**Work order:** `spec/system-work-orders/SYS-003.md`');
  lines.push('');
  lines.push('The single composed view of system completeness across the three layers. Every');
  lines.push('acceptance row carries: the work item, its governing evidence artifact, its');
  lines.push('recorded merge SHA (from the development-state machine files — Git history is');
  lines.push('authoritative for merge facts), the ancestor-of-HEAD proof, the commit-subject');
  lines.push('containment proof, and the status. The honest-handoff ledger records every');
  lines.push('finding, deferral, condition and orphan WITH its owner and its recorded');
  lines.push('disposition — a deferral with an owner and a recorded rationale is closed-out');
  lines.push('honesty, not an open defect; a missing disposition is a stop condition.');
  lines.push('');
  lines.push('## Generation provenance');
  lines.push('');
  lines.push(`- base commit (HEAD at generation): \`${matrix.generation.base_commit}\``);
  lines.push(`- base tree: \`${matrix.generation.base_tree}\``);
  lines.push(`- ${matrix.generation.note}`);
  lines.push('');
  const layerTitles = {
    'protocol-frozen': 'Layer 1 — protocol (frozen v0.1 authoring surface: WORK-001..WORK-033)',
    bootstrap: 'Repository bootstrap (ARCH-001 / PROD-001 / GOV-001)',
    'protocol-runtime': 'Protocol runtime materialization (RTN-001..RTN-012 — the A01–A16 operational spine)',
    product: 'Layer 2 — product (UI-001..UI-011; closure target UI-010; program CLOSED)',
    deployment: 'Layer 3 — deployment (DEP-001..DEP-008; closure target DEP-008)',
    system: 'System reconciliation items (SYS-001 / SYS-002 / SYS-003)',
  };
  for (const [layer, rows] of Object.entries(matrix.layers)) {
    lines.push(`## ${layerTitles[layer]}`);
    lines.push('');
    lines.push('| item | title | governing evidence | recorded merge | ancestor of HEAD | subject contains item | status |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const row of rows) lines.push(renderRowMarkdown(row));
    lines.push('');
    for (const row of rows) {
      if (row.note) lines.push(`- **${row.item}:** ${row.note}`);
    }
    lines.push('');
  }

  lines.push('## The honest-handoff ledger (owners + recorded dispositions)');
  lines.push('');
  const handoffTitles = {
    sys002_findings: 'The 9 SYS-002 dogfood findings (recorded in-corpus)',
    deferral_ledger: 'The product deferral ledger D-1..D-9 (D-1..D-3 RESOLVED by SYS-001; D-4..D-9 owned open/accepted)',
    dep008_conditions: 'The DEP-008 approval conditions (Tech Lead accepted, recorded in machine state)',
    lead_disposition_ledger: 'The Lead-disposition ledger (non-blocking, recorded in machine state — includes the DEP-008 release-record orphan)',
  };
  for (const [group, rows] of Object.entries(matrix.honest_handoff)) {
    lines.push(`### ${handoffTitles[group]}`);
    lines.push('');
    lines.push('| id | summary | owner | disposition | status |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of rows) lines.push(renderHandoffMarkdown(row));
    lines.push('');
  }

  lines.push('## Totals');
  lines.push('');
  const t = matrix.totals;
  lines.push(`- acceptance-surface rows: **${t.acceptance_surface_rows}**`);
  lines.push(`- honest-handoff rows: **${t.honest_handoff_rows}**`);
  lines.push(`- rows with a recorded merge fact: **${t.rows_with_recorded_merge}** (ancestor-of-HEAD: ${t.rows_ancestor_of_head}; subject-containment: ${t.rows_subject_containment})`);
  lines.push(`- honest-handoff rows missing a disposition: **${t.handoff_rows_missing_disposition}** (must be 0 — a missing disposition is a stop condition)`);
  lines.push('');
  lines.push('## Regeneration');
  lines.push('');
  lines.push('```bash');
  lines.push('node scripts/generate_final_reconciliation_matrix.mjs');
  lines.push('```');
  lines.push('');
  lines.push('Deterministic: the derivation is a pure function of the state files + Git');
  lines.push('history (no timestamps, no wall clock). The closure gate');
  lines.push('(`scripts/test_system_closure.mjs`) re-derives and cross-checks the committed');
  lines.push('matrix on every run.');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function main() {
  const matrix = buildMatrix(ROOT);
  const outDir = join(ROOT, 'spec', 'system-closure');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'final-reconciliation-matrix.json');
  const mdPath = join(outDir, 'final-reconciliation-matrix.md');
  writeFileSync(jsonPath, `${JSON.stringify(matrix, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(matrix));
  process.stdout.write(
    `${JSON.stringify({
      type: 'matrix-generated',
      generator: GENERATOR_NAME,
      base_commit: matrix.generation.base_commit,
      base_tree: matrix.generation.base_tree,
      acceptance_surface_rows: matrix.totals.acceptance_surface_rows,
      honest_handoff_rows: matrix.totals.honest_handoff_rows,
      rows_with_recorded_merge: matrix.totals.rows_with_recorded_merge,
      rows_ancestor_of_head: matrix.totals.rows_ancestor_of_head,
      rows_subject_containment: matrix.totals.rows_subject_containment,
      handoff_rows_missing_disposition: matrix.totals.handoff_rows_missing_disposition,
      files: ['spec/system-closure/final-reconciliation-matrix.json', 'spec/system-closure/final-reconciliation-matrix.md'],
    })}\n`,
  );
  if (matrix.totals.rows_ancestor_of_head !== matrix.totals.rows_with_recorded_merge) {
    process.stderr.write(`${GENERATOR_NAME}: FAIL — not every recorded merge is an ancestor of HEAD\n`);
    process.exit(1);
  }
  if (matrix.totals.rows_subject_containment !== matrix.totals.rows_with_recorded_merge) {
    process.stderr.write(`${GENERATOR_NAME}: FAIL — not every recorded merge subject contains its work item\n`);
    process.exit(1);
  }
  if (matrix.totals.handoff_rows_missing_disposition !== 0) {
    process.stderr.write(`${GENERATOR_NAME}: FAIL — honest-handoff rows missing a disposition (stop condition)\n`);
    process.exit(1);
  }
}

// Run as CLI only when invoked directly (the closure gate imports the pure
// functions without triggering the write).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    // Fail-closed and CLEAN: a malformed/tampered state file or an unprovable
    // merge fact is a generator error, never a silent pass and never a bare
    // stack trace.
    process.stderr.write(`${GENERATOR_NAME}: FAILED — ${error.message}\n`);
    process.exit(1);
  }
}
