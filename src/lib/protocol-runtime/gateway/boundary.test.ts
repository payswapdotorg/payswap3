/**
 * RTN-010 — Boundary review: proving no second admission path exists.
 *
 * Work order acceptance (RTN-010.md line 17): "The gateway is the only
 * module other code may call to submit protocol commands — enforced by
 * module boundary and documented contract." Required evidence (line 24):
 * "boundary review proving no second admission path exists."
 *
 * This suite is the MECHANICAL boundary review — it scans the repository
 * tree at test time and asserts:
 *
 *   1. NO second admission path: no source file outside the gateway prefix
 *      and the substrate itself calls the durable enqueue API or references
 *      DurableQueue (the substrate's enqueue is a transport primitive; the
 *      only protocol-command caller is the gateway).
 *   2. NO execution coupling: no gateway source constructs an authority or
 *      calls an authority command method (admission executes nothing —
 *      "no financial effect occurs at admission"; the transition path is
 *      RTN-011's owned surface).
 *   3. THE PRODUCT SPLICE BOUNDARY (amended by UI-011, the sanctioned
 *      splice — rtn-plan-rulings.md Q5/delta 6): src/lib/protocol/ PORT
 *      ADAPTERS are the sanctioned importers of the protocol runtime (via
 *      the composed barrel and its leaf modules); NOTHING ELSE under
 *      src/lib/protocol/ imports it; and src/app/ and src/components/
 *      STILL NEVER import it — mechanically enforced, invariant unchanged.
 *   4. The exported surface is exactly the documented contract: the barrel
 *      re-exports precisely the admission/receipt/registry/evidence/health/
 *      persistence symbols (enumerated at runtime), and the registry's kind
 *      catalogue is closed (112 distinct kinds; the rails alias re-exposes
 *      the same 7 kinds under the registry name by design).
 *   5. Every envelope authority resolves to an honest evidence authority
 *      (a member of EVIDENCE_AUTHORITIES) — no invented authority names
 *      (rtn-plan-rulings.md Q4).
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_AUTHORITIES } from '../evidence/record.ts';
import {
  GATEWAY_COMMAND_AUTHORITIES,
  GATEWAY_COMMAND_KIND_COUNT,
  GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE,
  GATEWAY_ENVELOPE_AUTHORITIES,
} from './registry.ts';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const GATEWAY_DIR = join(REPO_ROOT, 'src', 'lib', 'protocol-runtime', 'gateway');

function walk(dir: string, visit: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === 'var') {
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

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Strip comments AND string literals so doc descriptions (which cite authority method names as plain text) do not match the execution-pattern scan. */
function stripCommentsAndStrings(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

describe('RTN-010 boundary review — no second admission path exists', () => {
  test('no non-gateway, non-substrate, non-transition-runtime source calls the durable enqueue API or references DurableQueue', () => {
    // Tech-Lead integration amendment (RTN-011 parallel-sibling merge): the
    // transition runtime (src/lib/protocol-runtime/transition/ + hosting/) is
    // the DOCUMENTED dequeue-side execution path over the durable substrate
    // (RTN-011 work order; rtn-plan-rulings.md delta 5) — it is the substrate's
    // consumer, not a second ADMISSION path. Admission (external command entry
    // via enqueue) remains gateway-only; this whitelist addition changes
    // nothing about that invariant.
    const offenders: string[] = [];
    for (const file of sourceFilesUnder('src')) {
      const relative = file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
      const isGateway = relative.startsWith('src/lib/protocol-runtime/gateway/');
      const isSubstrate = relative.startsWith('src/lib/durable/');
      const isTransitionRuntime = relative.startsWith('src/lib/protocol-runtime/transition/')
        || relative.startsWith('src/lib/protocol-runtime/hosting/');
      if (isGateway || isSubstrate || isTransitionRuntime) {
        continue;
      }
      const content = read(file);
      if (/\.enqueue\(/.test(content) || /\bDurableQueue\b/.test(content)) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no gateway source constructs an authority or calls an authority command method (admission executes nothing)', () => {
    const offenders: string[] = [];
    const executionPatterns: RegExp[] = [
      /\bnew\s+(IntentAuthority|PolicyAuthority|CapabilityAuthority|RoutingAuthority|LiquidityAuthority|CreditAuthority|QueueAuthority|ClearingAuthority|ObligationLedgerAuthority|NettingAuthority|SettlementAuthority|RailAdapterAuthority|ReconciliationAuthority)\s*\(/,
      /\bopenReservationLedger\s*\(/,
      /\bcreateRiskComplianceAuthority\s*\(/,
      /\.(submitIntent|authorizeIntent|routeIntent|startFulfillingIntent|fulfillIntent|failIntent|cancelIntent)\s*\(/,
      /\.(authorPolicy|publishPolicyVersion|attachPolicy|evaluatePolicy|consumeEvaluation)\s*\(/,
      /\.(registerCapability|activateCapability|degradeCapability|retireCapability|offerCommitment|reserveCommitment|consumeCommitment|releaseCommitment|expireCommitment)\s*\(/,
      /\.(compileRoute|validatePlan|dispatchPlan|recordUnknownHop|resolveUnknownHop|completePlan|failPlan|abandonPlan)\s*\(/,
      /\.(declareResource|requestReservation|consumeReservation|releaseReservation|expireDueReservations)\s*\(/,
      /\.(openPool|freezePool|closePool|recordConfirmedFunding|openPendingFunding|resolvePendingFunding|requestPositionHold|consumeHold|releaseHold|expireDueHolds)\s*\(/,
      /\.(offerLine|activateLine|suspendLine|closeLine|evaluateCreditUsage|applyCreditDecision|consumeCreditReservation|releaseCreditReservation|expireDueCreditReservations)\s*\(/,
      /\.(createQueue|startDraining|pauseQueue|closeQueue|enqueueItem|evaluateEligibility|dispatchNext|resolveDispatchedItem|cancelItem|expireDueItems)\s*\(/,
      /\.(openBatch|addRecord|stageBatch|commitBatch|finalizeBatch)\s*\(/,
      /\.(applyClearingCommand|applyDisputeResolution|openDispute|applyRiskWriteOff|applyClearingCorrectionCancel|applySettlementFinality|applyNettingCommit|applySettlementInstruction)\s*\(/,
      /\.(openNettingSet|computeNettingSet|commitNettingSet|applyNetPositionSettlementInstruction|applyNetPositionSettlementFinality)\s*\(/,
      /\.(createSettlementInstruction|authorizeAttempt|submitAttempt|applyRailOutcome|applyResolution|declareFinality)\s*\(/,
      /\.(registerAdapter|activateAdapter|degradeAdapter|retireAdapter|authorizeOperation|submitRailOperation|recordReport)\s*\(/,
      /\.(investigateCase|resolveCase|registerSource|openCycle|collectStatements|runMatching|closeCycle)\s*\(/,
      /\.(authorRule|reviseRule|publishRule|activateRule|retireRule|registerScreeningList|screenSubject|evaluateAndRecordCheck|decideCheck|routeCheckToReview|recordCheckReview)\s*\(/,
    ];
    for (const file of sourceFilesUnder('src/lib/protocol-runtime/gateway')) {
      const relative = file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
      if (relative.endsWith('.test.ts')) {
        continue;
      }
      const content = stripCommentsAndStrings(read(file));
      for (const pattern of executionPatterns) {
        if (pattern.test(content)) {
          offenders.push(`${relative}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('src/lib/protocol/ port adapters are the sanctioned protocol-runtime importers; src/app/ and src/components/ still never import it (the product splice is UI-011, amended by UI-011)', () => {
    // UI-011 — the sanctioned product splice (rtn-plan-rulings.md
    // Q5/delta 6, spec/product/work-orders/UI-011.md acceptance): the
    // product ports were re-anchored to the composed protocol runtime.
    // The modules below are EXACTLY the sanctioned importers: the runtime
    // adapters (runtime-*-adapter.ts), the runtime handle, the server-side
    // composition root (server-runtime.ts), the shared adapter-boundary
    // constants, the intent port's runtime-vocabulary re-export, and the
    // product adapter test suites. Nothing else under src/lib/protocol/
    // may reference the protocol runtime, and src/app/ + src/components/
    // NEVER import it — mechanically enforced, invariant unchanged.
    const SANCTIONED_PRODUCT_ADAPTER_FILES = new Set([
      'src/lib/protocol/adapter-boundary.ts',
      'src/lib/protocol/runtime-handle.ts',
      'src/lib/protocol/runtime-intent-adapter.ts',
      'src/lib/protocol/runtime-checkout-adapter.ts',
      'src/lib/protocol/runtime-capability-adapter.ts',
      'src/lib/protocol/runtime-tracking-adapter.ts',
      'src/lib/protocol/runtime-waiting-adapter.ts',
      'src/lib/protocol/runtime-liquidity-adapter.ts',
      'src/lib/protocol/runtime-mediation-adapter.ts',
      'src/lib/protocol/server-runtime.ts',
      'src/lib/protocol/intent-port.ts',
      'src/lib/protocol/runtime-intent-adapter.test.ts',
      'src/lib/protocol/runtime-checkout-adapter.test.ts',
      'src/lib/protocol/runtime-capability-adapter.test.ts',
      'src/lib/protocol/runtime-tracking-adapter.test.ts',
      'src/lib/protocol/runtime-waiting-adapter.test.ts',
      'src/lib/protocol/runtime-liquidity-adapter.test.ts',
      'src/lib/protocol/runtime-mediation-adapter.test.ts',
      'src/lib/protocol/product-adapter-test-compose.ts',
    ]);
    const offenders: string[] = [];
    for (const root of ['src/app', 'src/lib/protocol', 'src/components']) {
      for (const file of sourceFilesUnder(root)) {
        const relative = file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
        if (root === 'src/lib/protocol' && SANCTIONED_PRODUCT_ADAPTER_FILES.has(relative)) {
          continue;
        }
        const content = read(file);
        if (/protocol-runtime/.test(content)) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the gateway barrel exports exactly the documented contract surface (parsed from index.ts — the static contract)', () => {
    // The barrel is parsed (not imported) because its persistence module
    // binds node:sqlite, which bun does not implement — the same split
    // every RTN domain observes; the boundary review inspects the SOURCE.
    const barrel = read(join(GATEWAY_DIR, 'index.ts'));
    const symbols: string[] = [];
    const valueExport = /^export \{([^}]+)\} from/gm;
    let match: RegExpExecArray | null;
    while ((match = valueExport.exec(barrel)) !== null) {
      for (const name of match[1].split(',')) {
        const trimmed = name.trim();
        if (trimmed.length > 0) {
          symbols.push(trimmed);
        }
      }
    }
    const exported = [...new Set(symbols)].sort();
    expect(exported).toEqual([
      'DEFAULT_GATEWAY_DB_PATH',
      'GATEWAY_ADMISSION_OUTCOMES',
      'GATEWAY_ADMISSION_REASON_CODES',
      'GATEWAY_ADMISSION_STATES',
      'GATEWAY_COMMAND_AUTHORITIES',
      'GATEWAY_COMMAND_KIND_COUNT',
      'GATEWAY_ENVELOPE_AUTHORITIES',
      'GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE',
      'GATEWAY_EVIDENCE_VOCABULARY',
      'GATEWAY_MIGRATIONS_DIR_ENV_VAR',
      'GATEWAY_MIGRATIONS_RELATIVE_DIR',
      'GATEWAY_STORE_DOMAIN',
      'GATEWAY_UNKNOWN_SUBJECT_TOKEN',
      'ProtocolGateway',
      'commandQueuePortFromDurableQueue',
      'commandReceipt',
      'commandReceiptId',
      'commandRejectedEvidence',
      'findAuthorityCommands',
      'findCommandSpec',
      'isCommandReceipt',
      'isGatewayAdmissionReasonCode',
      'noSubjects',
      'openGatewayStore',
      'readCommandReceipts',
      'resolveEvidenceAuthority',
      'resolveGatewayMigrationsDir',
      'subjectFields',
      'submitGatewayEvidence',
      'writeCommandReceipt',
    ]);
    expect(exported.length).toBe(30);
    // the type exports (checked as statements, not runtime symbols)
    for (const typeExport of [
      'GatewayAdmissionReasonCode',
      'FieldProblem',
      'FieldCheck',
      'FieldSpec',
      'OptionalField',
      'BodyInvariant',
      'BodyValidation',
      'GatewayAdmissionState',
      'GatewayAdmissionOutcome',
      'CommandReceipt',
      'CommandSpec',
      'AuthorityCommands',
      'SubjectResolver',
      'SubjectResolution',
      'CommandQueuePort',
      'CommandQueueEnqueueOutcome',
      'CommandAdmissionResult',
      'ProtocolGatewayDeps',
      'GatewayHealthSnapshot',
      'GatewayStoreOptions',
      'StoredCommandReceipt',
      'GatewayReceiptWrite',
    ]) {
      expect(barrel).toContain(typeExport);
    }
  });

  test('the registry catalogue is closed and consistent (16 authority entries; 112 distinct kinds; the rails alias re-exposes the same 7 kinds)', () => {
    expect(GATEWAY_COMMAND_AUTHORITIES.length).toBe(16);
    expect(GATEWAY_COMMAND_KIND_COUNT).toBe(112);
    const railAdapter = GATEWAY_COMMAND_AUTHORITIES.find((entry) => entry.authority === 'Rail Adapter Authority');
    const railAlias = GATEWAY_COMMAND_AUTHORITIES.find((entry) => entry.authority === 'Rail Authority');
    expect(railAdapter !== undefined).toBe(true);
    expect(railAlias !== undefined).toBe(true);
    if (railAdapter === undefined || railAlias === undefined) return;
    expect(railAdapter.commands.length).toBe(7);
    expect(railAlias.commands.length).toBe(7);
    const adapterKinds = railAdapter.commands.map((command) => command.kind).sort();
    const aliasKinds = railAlias.commands.map((command) => command.kind).sort();
    expect(adapterKinds).toEqual(aliasKinds);
    // no other authority shares kinds with another authority
    const kindOwners = new Map<string, number>();
    for (const entry of GATEWAY_COMMAND_AUTHORITIES) {
      for (const command of entry.commands) {
        kindOwners.set(command.kind, (kindOwners.get(command.kind) ?? 0) + 1);
      }
    }
    for (const [kind, owners] of kindOwners) {
      if (adapterKinds.includes(kind)) {
        expect(owners).toBe(2); // the module label + the registry alias, by design
      } else {
        expect(owners).toBe(1);
      }
    }
  });

  test('every envelope authority resolves to an honest evidence authority (no invented authority names — Q4)', () => {
    expect(GATEWAY_ENVELOPE_AUTHORITIES.length).toBe(16);
    for (const [envelopeAuthority, evidenceAuthority] of Object.entries(GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE)) {
      expect((EVIDENCE_AUTHORITIES as readonly string[]).includes(evidenceAuthority)).toBe(true);
      if (envelopeAuthority === 'Rail Adapter Authority') {
        expect(evidenceAuthority).toBe('Rail Authority');
      } else {
        expect(evidenceAuthority).toBe(envelopeAuthority);
      }
    }
  });
});
