#!/usr/bin/env node
/**
 * payswap3 · RTN-003 — Risk/Compliance Authority evidence harness.
 *
 * Plain-Node evidence suite for the SQLite-backed surfaces of the risk
 * authority (the same split the RTN-001 kernel uses): `bun test` covers the
 * pure modules; THIS harness exercises the store and the composed
 * authority against real SQLite through the DEP-003 database layer
 * (node:sqlite), because Bun does not implement node:sqlite.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16:
 *     lines 98-100 (RiskRule lifecycle); 102-107 (ComplianceCheck
 *     lifecycle + reviewed decisions); 109-113 (ScreeningResult lifecycle
 *     + HIT handling); 124-134 (INV-16-1 determinism; INV-16-2 integer
 *     thresholds; INV-16-3 gating; INV-16-4 idempotent check ids); 137-139
 *     (failed list refresh leaves the prior version active and records the
 *     failure); 144-147 (evidence produced).
 *   §1 Area 15 lines 62-64 (synchronous evidence coupling: "an operation
 *   is not committed until its record is written. A failed write fails
 *   the operation.").
 *   spec/protocol-runtime-work-orders/README.md line 39 (evidence
 *   discipline: the owned in-surface test double stands in for the
 *   unmerged RTN-002 log; RTN-012 proves the real-log integration).
 *
 * Node-version note: requires Node.js >= 22.6 (node:sqlite + type
 * stripping), mirroring scripts/test_protocol_kernel.mjs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RISK_URL = (name) => pathToFileURL(join(ROOT, 'src', 'lib', 'protocol-runtime', 'risk', name)).href;

const RESPAWN_ENV = 'PAYSWAP_RISK_TEST_RESPAWNED';
const tempDirs = [];
function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `payswap-risk-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Capability bootstrap (mirrors scripts/test_protocol_kernel.mjs): probes
 * node:sqlite importability and .ts module loadability, re-executing with
 * the required experimental flags on Node builds that need them.
 */
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
    await import(RISK_URL('reason-codes.ts'));
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
  if (child.status === 9) {
    console.error('node rejected the required experimental flags (exit 9): this Node build does not support');
    console.error('node:sqlite / type stripping. The evidence suite requires Node.js >= 22.6.');
    process.exit(1);
  }
  process.exit(typeof child.status === 'number' ? child.status : 1);
}

await ensureCapabilities();

let risk;
try {
  risk = await import(RISK_URL('risk.ts'));
} catch (error) {
  console.error(`Failed to load the risk authority barrel: ${error}`);
  console.error('This suite requires Node.js >= 22.6 (node:sqlite + TypeScript type stripping).');
  process.exit(1);
}

const {
  // pure surface (re-verified under plain Node loadability)
  subjectComplianceData,
  deriveSubjectDataHash,
  authorRiskRule,
  publishRiskRuleVersion,
  activateRiskRule,
  createScreeningList,
  // store surface
  openRiskStore,
  insertRiskRuleDraft,
  findRiskRuleDraft,
  findRiskRule,
  nextRiskRuleVersion,
  publishRiskRuleRow,
  saveRiskRuleState,
  listRiskRulesInState,
  saveRiskRuleDraftDefinition,
  insertScreeningList,
  findLatestScreeningList,
  recordScreeningListRefreshFailure,
  countScreeningListRefreshFailures,
  insertScreeningResult,
  findScreeningResult,
  saveScreeningResultState,
  insertComplianceCheck,
  findComplianceCheck,
  listComplianceChecksForSubject,
  // composed authority + evidence double
  createRiskComplianceAuthority,
  EvidenceSubmissionTestDouble,
} = risk;

const { protocolTime } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'protocol-runtime', 'kernel', 'time.ts')).href);

// ---------------------------------------------------------------------------
// (a) [test:risk-load] — plain-Node loadability + export surface
// ---------------------------------------------------------------------------
function testRiskLoad() {
  assert.equal(typeof subjectComplianceData, 'function', 'risk exports subjectComplianceData()');
  assert.equal(typeof deriveSubjectDataHash, 'function', 'risk exports deriveSubjectDataHash()');
  assert.equal(typeof authorRiskRule, 'function', 'risk exports authorRiskRule()');
  assert.equal(typeof publishRiskRuleVersion, 'function', 'risk exports publishRiskRuleVersion()');
  assert.equal(typeof activateRiskRule, 'function', 'risk exports activateRiskRule()');
  assert.equal(typeof createScreeningList, 'function', 'risk exports createScreeningList()');
  assert.equal(typeof openRiskStore, 'function', 'risk exports openRiskStore()');
  assert.equal(typeof insertComplianceCheck, 'function', 'risk exports insertComplianceCheck()');
  assert.equal(typeof findComplianceCheck, 'function', 'risk exports findComplianceCheck()');
  assert.equal(typeof createRiskComplianceAuthority, 'function', 'risk exports createRiskComplianceAuthority()');
  assert.equal(typeof EvidenceSubmissionTestDouble, 'function', 'risk exports the EvidenceSubmissionTestDouble');
}

// ---------------------------------------------------------------------------
// (b) [test:risk-store-migrations] — the per-domain persistence convention
// ---------------------------------------------------------------------------
function testRiskStoreMigrations() {
  const dir = tempDir('migrations');
  const db = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all()
    .map((row) => row.name);
  for (const expected of [
    'risk_rules',
    'screening_lists',
    'screening_list_refresh_failures',
    'screening_results',
    'compliance_checks',
  ]) {
    assert.ok(tables.includes(expected), `migration 0001_risk.sql created ${expected}`);
  }
  // No-op re-run (the substrate runner re-verifies immutability).
  const again = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  assert.equal(again.appliedMigrations().length, 1, 'the single risk migration is applied exactly once');
  again.close();
  db.close();
}

// ---------------------------------------------------------------------------
// (c) [test:risk-rule-persistence] — draft -> publish -> activate -> retire
// ---------------------------------------------------------------------------
function testRiskRulePersistence() {
  const dir = tempDir('rules');
  const db = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  const when = () => protocolTime(1, 1);

  const draft = authorRiskRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 10_000 },
    onBreach: 'DENY',
  });
  insertRiskRuleDraft(db, draft, when());
  assert.equal(findRiskRuleDraft(db, 'limit-usd').state, 'AUTHORED');

  // One draft per rule identity (partial unique index).
  assert.throws(() => insertRiskRuleDraft(db, draft, when()), /UNIQUE/);

  // Revision while AUTHORED, then publish with the store-assigned version.
  saveRiskRuleDraftDefinition(db, 'limit-usd', {
    ...draft.definition,
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 20_000 },
  });
  assert.equal(findRiskRuleDraft(db, 'limit-usd').definition.bound.amountMinor, 20_000);

  const version = nextRiskRuleVersion(db, 'limit-usd');
  assert.equal(version, 1, 'first published version is 1');
  const published = publishRiskRuleVersion(findRiskRuleDraft(db, 'limit-usd'), version);
  assert.ok(published.ok, 'publishing the draft is legal');
  publishRiskRuleRow(db, 'limit-usd', published.rule, when());
  assert.equal(findRiskRuleDraft(db, 'limit-usd'), undefined, 'the draft row is replaced by the version row');
  assert.equal(findRiskRule(db, 'limit-usd', 1).state, 'VERSIONED');

  // A second version of the same rule identity after a full lifecycle.
  const active = activateRiskRule(published.rule);
  assert.ok(active.ok);
  saveRiskRuleState(db, active.rule, when());
  assert.deepEqual(
    listRiskRulesInState(db, 'ACTIVE').map((rule) => [rule.ruleId, rule.version]),
    [['limit-usd', 1]],
  );
  const retired = risk.retireRiskRule(active.rule);
  assert.ok(retired.ok);
  saveRiskRuleState(db, retired.rule, when());
  assert.equal(findRiskRule(db, 'limit-usd', 1).state, 'RETIRED');

  const draft2 = authorRiskRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 30_000 },
    onBreach: 'REVIEW',
  });
  insertRiskRuleDraft(db, draft2, when());
  assert.equal(nextRiskRuleVersion(db, 'limit-usd'), 2, 'the next version continues the identity');
  const published2 = publishRiskRuleVersion(findRiskRuleDraft(db, 'limit-usd'), 2);
  publishRiskRuleRow(db, 'limit-usd', published2.rule, when());
  assert.equal(findRiskRule(db, 'limit-usd', 2).definition.onBreach, 'REVIEW');

  db.close();
}

// ---------------------------------------------------------------------------
// (d) [test:risk-list-refresh] — failed refreshes leave the prior version
//     active and are recorded (A16 lines 137-139)
// ---------------------------------------------------------------------------
function testListRefresh() {
  const dir = tempDir('lists');
  const db = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  const when = () => protocolTime(2, 2);

  insertScreeningList(db, createScreeningList('sanctions', 1, ['sdh.v1.' + 'a'.repeat(64)]), when());
  assert.equal(findLatestScreeningList(db, 'sanctions').version, 1);

  // A failed registration (invalid payload) is recorded, never silent.
  assert.throws(
    () => insertScreeningList(db, createScreeningList('sanctions', 2, [42]), when()),
    /non-empty string/,
  );
  const failure = recordScreeningListRefreshFailure(db, { listId: 'sanctions', reason: 'invalid payload' }, when());
  assert.equal(failure.priorVersion, 1, 'the failed refresh recorded the prior active version');
  assert.equal(countScreeningListRefreshFailures(db, 'sanctions'), 1);
  assert.equal(findLatestScreeningList(db, 'sanctions').version, 1, 'the prior version stays active');

  // Re-registering a recorded version is rejected (append-only versions).
  assert.throws(
    () => insertScreeningList(db, createScreeningList('sanctions', 1, []), when()),
    /append-only/,
  );
  recordScreeningListRefreshFailure(db, { listId: 'sanctions', reason: 'version 1 re-registered' }, when());
  assert.equal(countScreeningListRefreshFailures(db, 'sanctions'), 2);
  assert.equal(findLatestScreeningList(db, 'sanctions').version, 1, 'still active: v1');

  // The next version registers cleanly.
  insertScreeningList(db, createScreeningList('sanctions', 2, []), when());
  assert.equal(findLatestScreeningList(db, 'sanctions').version, 2);

  db.close();
}

// ---------------------------------------------------------------------------
// (e) [test:risk-screening-idempotency] — INV-16-1 at the screening level
// ---------------------------------------------------------------------------
function testScreeningIdempotency() {
  const dir = tempDir('screening');
  const db = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  const when = () => protocolTime(3, 3);

  const subject = subjectComplianceData({
    subjectId: 'intent-1',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 1 }],
  });
  const digest = deriveSubjectDataHash(subject);
  const list = createScreeningList('sanctions', 1, [digest]);
  insertScreeningList(db, list, when());

  const computed = risk.computeScreeningResult(list, digest);
  insertScreeningResult(db, computed, when());
  const resolved = risk.resolveScreeningResult(computed, list);
  saveScreeningResultState(db, resolved, when());
  assert.equal(resolved.state, 'HIT');
  assert.equal(resolved.matchedEntry, digest);

  // Re-computation of the identical input triple returns the recorded row.
  const recorded = findScreeningResult(db, 'sanctions', 1, digest);
  assert.equal(recorded.state, 'HIT');
  assert.equal(recorded.screeningId, computed.screeningId);

  // A different subject addresses a different row.
  const other = subjectComplianceData({
    subjectId: 'intent-2',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 2 }],
  });
  const otherDigest = deriveSubjectDataHash(other);
  const otherComputed = risk.computeScreeningResult(list, otherDigest);
  insertScreeningResult(db, otherComputed, when());
  assert.equal(risk.resolveScreeningResult(otherComputed, list).state, 'CLEAR');
  assert.notEqual(otherComputed.screeningId, computed.screeningId);

  db.close();
}

// ---------------------------------------------------------------------------
// (f) [test:risk-check-idempotency] — INV-16-4 end to end
// ---------------------------------------------------------------------------
async function testCheckIdempotency() {
  const dir = tempDir('checks');
  const double = new EvidenceSubmissionTestDouble();
  const authority = createRiskComplianceAuthority({
    evidence: double,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  const when = () => protocolTime(4, 4);

  const subject = subjectComplianceData({
    subjectId: 'intent-1',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 5_000 }],
  });
  authority.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when());

  const first = await authority.evaluateAndRecordCheck(subject, 'sanctions', when());
  assert.equal(first.state, 'EVALUATED');
  assert.equal(first.evaluation.outcome, 'AUTO_APPROVE');

  // Re-evaluation with the SAME (subject id, rule set version) — even with
  // DIFFERENT subject data — returns the recorded result (INV-16-4).
  const changedSubject = subjectComplianceData({
    subjectId: 'intent-1',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 999_999 }],
  });
  const second = await authority.evaluateAndRecordCheck(changedSubject, 'sanctions', when());
  assert.equal(second.checkId, first.checkId);
  assert.equal(second.subjectDataHash, first.subjectDataHash, 'the recorded result stands');
  assert.equal(double.byOperationType('SCREENING_COMPUTED').length, 1, 'no duplicate records on idempotent paths');

  // A NEW rule set version (another ACTIVE rule) opens a NEW check id.
  authority.authorRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 100 },
    onBreach: 'DENY',
  }, when());
  authority.publishRule('limit-usd', when());
  authority.activateRule('limit-usd', 1, when());
  const third = await authority.evaluateAndRecordCheck(subject, 'sanctions', when());
  assert.notEqual(third.checkId, first.checkId);
  assert.equal(third.evaluation.outcome, 'AUTO_DENY');

  authority.close();
}

// ---------------------------------------------------------------------------
// (g) [test:risk-hit-flow] — HIT -> MANUAL_REVIEW -> review -> gate
// ---------------------------------------------------------------------------
async function testHitFlow() {
  const dir = tempDir('hit');
  const double = new EvidenceSubmissionTestDouble();
  const authority = createRiskComplianceAuthority({
    evidence: double,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  const when = () => protocolTime(5, 5);

  const subject = subjectComplianceData({
    subjectId: 'intent-77',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 5_000 }],
  });
  authority.registerScreeningList(
    { listId: 'sanctions', version: 1, entries: [deriveSubjectDataHash(subject)] },
    when(),
  );

  const check = await authority.evaluateAndRecordCheck(subject, 'sanctions', when());
  assert.equal(check.evaluation.reasonCode, 'SCREENING_HIT');
  assert.equal(check.evaluation.outcome, 'MANDATORY_REVIEW');
  assert.equal(check.state, 'EVALUATED');

  // Gating negative: an undecided check blocks intent AUTHORIZATION (INV-16-3).
  let verdict = authority.checkGate('intent.AUTHORIZATION', 'intent-77');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.blockedBy, 'CHECK_UNDECIDED');

  // Auto-decision for the hit check is forbidden (runtime guard).
  await assert.rejects(() => authority.decideCheck(check.checkId, when()), /auto-decision is forbidden/);

  // Route to MANUAL_REVIEW (HIT creates a MANUAL_REVIEW check).
  const routed = await authority.routeCheckToReview(check.checkId, when());
  assert.equal(routed.state, 'MANUAL_REVIEW');
  const decidedRecords = double.byOperationType('CHECK_DECIDED');
  assert.equal(decidedRecords.length, 1);
  assert.equal(decidedRecords[0].record.outcome.result, 'MANUAL_REVIEW');
  assert.equal(decidedRecords[0].record.outcome.reasonCode, 'SCREENING_HIT');

  // Still blocked while in the durable review state.
  verdict = authority.checkGate('intent.AUTHORIZATION', 'intent-77');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.blockedBy, 'CHECK_UNDECIDED');

  // The reviewed decision resolves the gate.
  const reviewed = await authority.recordCheckReview(
    check.checkId,
    { reviewerAuthority: 'Compliance Review Board', decision: 'APPROVED', rationale: 'verified against primary sources' },
    when(),
  );
  assert.equal(reviewed.state, 'APPROVED');
  assert.equal(reviewed.review.reviewerAuthority, 'Compliance Review Board');
  const reviewRecords = double.byOperationType('REVIEW_RECORDED');
  assert.equal(reviewRecords.length, 1);
  assert.equal(reviewRecords[0].record.authority, 'Compliance Review Board');
  assert.equal(reviewRecords[0].record.outcome.result, 'APPROVED');
  assert.equal(reviewRecords[0].record.outcome.reasonCode, 'verified against primary sources');

  verdict = authority.checkGate('intent.AUTHORIZATION', 'intent-77');
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.checkId, check.checkId);

  authority.close();
}

// ---------------------------------------------------------------------------
// (h) [test:risk-auto-deny-flows] — clean approval and rule denial
// ---------------------------------------------------------------------------
async function testAutoDenyFlows() {
  const dir = tempDir('auto');
  const double = new EvidenceSubmissionTestDouble();
  const authority = createRiskComplianceAuthority({
    evidence: double,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  const when = () => protocolTime(6, 6);

  authority.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when());
  authority.authorRule('limit-usd', {
    kind: 'THRESHOLD',
    fact: { factClass: 'MONEY', currency: 'USD' },
    operator: 'GT',
    bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 10_000 },
    onBreach: 'DENY',
  }, when());
  authority.publishRule('limit-usd', when());
  authority.activateRule('limit-usd', 1, when());

  const clean = subjectComplianceData({
    subjectId: 'intent-clean',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 500 }],
  });
  const cleanCheck = await authority.evaluateAndRecordCheck(clean, 'sanctions', when());
  assert.equal(cleanCheck.evaluation.outcome, 'AUTO_APPROVE');
  const approved = await authority.decideCheck(cleanCheck.checkId, when());
  assert.equal(approved.state, 'APPROVED');
  assert.equal(authority.checkGate('intent.AUTHORIZATION', 'intent-clean').allowed, true);

  const heavy = subjectComplianceData({
    subjectId: 'intent-heavy',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 50_000 }],
  });
  const heavyCheck = await authority.evaluateAndRecordCheck(heavy, 'sanctions', when());
  assert.equal(heavyCheck.evaluation.outcome, 'AUTO_DENY');
  assert.equal(heavyCheck.evaluation.reasonCode, 'RULE_BREACH');
  const denied = await authority.decideCheck(heavyCheck.checkId, when());
  assert.equal(denied.state, 'DENIED');
  const verdict = authority.checkGate('intent.AUTHORIZATION', 'intent-heavy');
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.blockedBy, 'CHECK_DENIED');

  // A capability ACTIVATION gate for a subject with no check blocks.
  const capabilityVerdict = authority.checkGate('capability.ACTIVATION', 'cap-9');
  assert.equal(capabilityVerdict.allowed, false);
  assert.equal(capabilityVerdict.blockedBy, 'NO_APPROVED_CHECK');

  authority.close();
}

// ---------------------------------------------------------------------------
// (i) [test:risk-evidence-coupling] — a failed write fails the operation
// ---------------------------------------------------------------------------
async function testEvidenceCoupling() {
  const dir = tempDir('coupling');
  const double = new EvidenceSubmissionTestDouble();
  const authority = createRiskComplianceAuthority({
    evidence: double,
    store: { dbPath: join(dir, 'risk.sqlite') },
  });
  const when = () => protocolTime(7, 7);

  authority.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when());
  const subject = subjectComplianceData({
    subjectId: 'intent-c',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'USD', amountMinor: 100 }],
  });
  const check = await authority.evaluateAndRecordCheck(subject, 'sanctions', when());
  assert.equal(check.state, 'EVALUATED');

  // Arm the double: the CHECK_DECIDED submission fails, and the operation
  // must fail WITHOUT persisting the decision (submit-then-persist).
  double.failNextSubmissions(1);
  await assert.rejects(() => authority.decideCheck(check.checkId, when()), /evidence submission failed/);
  const after = authority.findCheck(check.checkId);
  assert.equal(after.state, 'EVALUATED', 'nothing persisted: the operation is not committed');
  assert.equal(authority.checkGate('intent.AUTHORIZATION', 'intent-c').allowed, false);

  // The same failure coupling holds for the screening resolution path:
  // a NOT-yet-screened subject's COMPUTED row is inserted, the
  // SCREENING_COMPUTED submission fails, and the terminal outcome is never
  // persisted. (A subject already screened terminal returns the recorded
  // result before any submission — the idempotent path.)
  const freshSubject = subjectComplianceData({
    subjectId: 'intent-c-fresh',
    subjectKind: 'INTENT',
    moneyFacts: [{ currency: 'EUR', amountMinor: 200 }],
  });
  const screeningCountBefore = double.byOperationType('SCREENING_COMPUTED').length;
  double.failNextSubmissions(1);
  await assert.rejects(
    () => authority.screenSubject(freshSubject, 'sanctions', when()),
    /evidence submission failed/,
  );
  const storeDb = openRiskStore({ dbPath: join(dir, 'risk.sqlite') });
  const screeningRow = findScreeningResult(storeDb, 'sanctions', 1, deriveSubjectDataHash(freshSubject));
  assert.notEqual(screeningRow, undefined, 'the COMPUTED screening row exists (durable state)');
  assert.equal(screeningRow.state, 'COMPUTED', 'the terminal outcome is not committed on a failed write');
  assert.equal(
    double.byOperationType('SCREENING_COMPUTED').length,
    screeningCountBefore,
    'no SCREENING_COMPUTED record was written for the failed operation',
  );
  storeDb.close();

  authority.close();
}

// ---------------------------------------------------------------------------
// (j) [test:risk-determinism-store] — two fresh stores, identical outcomes
// ---------------------------------------------------------------------------
async function testDeterminismAcrossStores() {
  const outcomes = [];
  for (let storeIndex = 0; storeIndex < 2; storeIndex += 1) {
    const dir = tempDir(`determinism-${storeIndex}`);
    const double = new EvidenceSubmissionTestDouble();
    const authority = createRiskComplianceAuthority({
      evidence: double,
      store: { dbPath: join(dir, 'risk.sqlite') },
    });
    const when = () => protocolTime(8, 8);

    authority.registerScreeningList(
      { listId: 'sanctions', version: 1, entries: [] },
      when(),
    );
    authority.authorRule('limit-usd', {
      kind: 'THRESHOLD',
      fact: { factClass: 'MONEY', currency: 'USD' },
      operator: 'GTE',
      bound: { boundClass: 'MONEY', currency: 'USD', amountMinor: 1_000 },
      onBreach: 'REVIEW',
    }, when());
    authority.publishRule('limit-usd', when());
    authority.activateRule('limit-usd', 1, when());

    const subject = subjectComplianceData({
      subjectId: 'intent-d',
      subjectKind: 'INTENT',
      moneyFacts: [{ currency: 'USD', amountMinor: 2_000 }],
    });
    const check = await authority.evaluateAndRecordCheck(subject, 'sanctions', when());
    const routed = await authority.routeCheckToReview(check.checkId, when());
    const reviewed = await authority.recordCheckReview(
      check.checkId,
      { reviewerAuthority: 'Compliance Review Board', decision: 'DENIED', rationale: 'threshold policy' },
      when(),
    );
    outcomes.push({
      checkId: reviewed.checkId,
      ruleSetVersion: reviewed.ruleSetVersion,
      state: reviewed.state,
      evaluation: reviewed.evaluation,
      evidence: double.submissions.map((entry) => entry.record),
    });
    authority.close();
  }
  assert.deepEqual(outcomes[0], outcomes[1], 'identical inputs produce identical recorded outcomes across fresh stores');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const cleanup = () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
};

async function main() {
  const cases = [
    ['risk-load', testRiskLoad],
    ['risk-store-migrations', testRiskStoreMigrations],
    ['risk-rule-persistence', testRiskRulePersistence],
    ['risk-list-refresh', testListRefresh],
    ['risk-screening-idempotency', testScreeningIdempotency],
    ['risk-check-idempotency', testCheckIdempotency],
    ['risk-hit-flow', testHitFlow],
    ['risk-auto-deny-flows', testAutoDenyFlows],
    ['risk-evidence-coupling', testEvidenceCoupling],
    ['risk-determinism-store', testDeterminismAcrossStores],
  ];
  const failures = [];
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`[test:${name}] ok`);
    } catch (error) {
      failures.push(name);
      console.error(`[test:${name}] FAILED: ${error && error.stack ? error.stack : error}`);
    }
  }
  cleanup();
  if (failures.length > 0) {
    console.error(`\n${failures.length} case(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll RTN-003 risk authority evidence cases passed.');
}

await main();
