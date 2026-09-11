/**
 * RTN-004 — Adapter interface tests: transmission-and-reporting-only
 * conformance (rulings delta 1) and the NO-EGRESS verification (pure — no
 * store, no network).
 *
 * Sources of the tested contracts:
 *   spec/development-state/rtn-plan-rulings.md Q1/delta 1 (binding):
 *     "the adapter interface ... is strictly TRANSMISSION-AND-REPORTING:
 *      no code path in the adapter interface creates or mutates
 *      RailAdapter/RailOperation state"
 *   spec/deployment/topology.md, Simulation rule:
 *     "development, test/CI, sandbox and staging use protocol-owned
 *      simulated rails — same interface, no external transmission, no real
 *      credentials, no signing capability."
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md lines 70-72
 *     (INV-13-4 no guessing), lines 74-78 (failure semantics), lines 66-69
 *     (INV-13-3 duplicate collapse).
 *   RTN-004 acceptance: "Simulated rails produce scripted
 *    CONFIRMED/FAILED/PENDING/UNKNOWN; no socket egress exists in the
 *    module (verified by review + test)."
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { money } from '../kernel/money.ts';
import { deriveIdempotencyKey } from '../kernel/identity.ts';
import { hashRailPayload } from './payload.ts';
import { SimulatedRail, createSimulatedRailAdapter, submissionReportClass } from './adapters.ts';
import type { RailTransmissionRequest } from './adapters.ts';
import type { RailOperationPayload } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALL = 1_700_000_000_000;

const PAYLOAD = {
  instructionId: 'instruction-adapter-test',
  money: money('USD', 2500, 2),
  beneficiary: 'acct-abc',
};

function requestFor(instructionId: string, payload = PAYLOAD): RailTransmissionRequest {
  return {
    idempotencyKey: deriveIdempotencyKey('rail.submit', instructionId),
    payload,
    payloadHash: hashRailPayload(payload),
  };
}

describe('INV-13-4 no-guessing mapping (pure function)', () => {
  test('every submission maps to exactly one report class; acceptance is NEVER CONFIRMED', () => {
    const accepted = {
      class: 'ACCEPTED',
      railReferences: ['simrail.r.1'],
      duplicate: 'FIRST',
    } as const;
    expect(submissionReportClass(accepted)).toBe('PENDING');
    const rejected = {
      class: 'REJECTED',
      reasonCode: 'RAIL_REJECTED_SUBMISSION',
      detail: 'no',
    } as const;
    expect(submissionReportClass(rejected)).toBe('FAILED');
    const unknown = { class: 'UNKNOWN', reasonCode: 'TIMEOUT', detail: 't/o' } as const;
    expect(submissionReportClass(unknown)).toBe('UNKNOWN');
  });
});

describe('simulated rails — scripted deterministic scenarios', () => {
  test('ACCEPT_REPORT_CONFIRMED: transmit ACCEPTED, report CONFIRMED with payload proof', () => {
    const key = deriveIdempotencyKey('rail.submit', 'instruction-confirmed');
    const rail = new SimulatedRail('s1', { [key]: 'ACCEPT_REPORT_CONFIRMED' });
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const request = requestFor('instruction-confirmed');
    const outcome = connection.transmit(request);
    expect(outcome.class).toBe('ACCEPTED');
    if (outcome.class === 'ACCEPTED') {
      expect(outcome.railReferences).toEqual(['simrail.s1.1']);
      expect(outcome.duplicate).toBe('FIRST');
    }
    const report = connection.fetchReport(key);
    expect(report.outcomeClass).toBe('CONFIRMED');
    expect(report.payloadHash).toBe(request.payloadHash);
    expect(report.railReferences).toEqual(['simrail.s1.1']);
    expect(report.reportedAtWallMs).toBe(WALL);
  });

  test('ACCEPT_REPORT_FAILED / ACCEPT_REPORT_UNKNOWN / ACCEPT_NO_REPORT (PENDING) classes', () => {
    for (const [scenario, expectedClass] of [
      ['ACCEPT_REPORT_FAILED', 'FAILED'],
      ['ACCEPT_REPORT_UNKNOWN', 'UNKNOWN'],
      ['ACCEPT_NO_REPORT', 'PENDING'],
    ] as const) {
      const key = deriveIdempotencyKey('rail.submit', `instruction-${scenario}`);
      const rail = new SimulatedRail('s2', { [key]: scenario });
      const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
      const outcome = connection.transmit(requestFor(`instruction-${scenario}`));
      expect(outcome.class).toBe('ACCEPTED');
      const report = connection.fetchReport(key);
      expect(report.outcomeClass).toBe(expectedClass);
      if (scenario === 'ACCEPT_REPORT_UNKNOWN') {
        expect(report.reasonCode).toBe('AMBIGUOUS_RAIL_RESPONSE');
      }
    }
  });

  test('REJECT_AT_SUBMISSION maps to REJECTED before any rail ledger entry', () => {
    const key = deriveIdempotencyKey('rail.submit', 'instruction-rejected');
    const rail = new SimulatedRail('s3', { [key]: 'REJECT_AT_SUBMISSION' });
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const outcome = connection.transmit(requestFor('instruction-rejected'));
    expect(outcome.class).toBe('REJECTED');
    if (outcome.class === 'REJECTED') {
      expect(outcome.reasonCode).toBe('RAIL_REJECTED_SUBMISSION');
    }
    // The rail never received it: silence → UNKNOWN (never a guess).
    expect(rail.receivedKeys().length).toBe(0);
    const report = connection.fetchReport(key);
    expect(report.outcomeClass).toBe('UNKNOWN');
    expect(report.reasonCode).toBe('SILENCE');
  });

  test('the three UNKNOWN causes (timeout / connection loss / ambiguous response) map to UNKNOWN with reason codes', () => {
    for (const [scenario, reason] of [
      ['TRANSMIT_TIMEOUT', 'TIMEOUT'],
      ['TRANSMIT_CONNECTION_LOSS', 'CONNECTION_LOSS'],
      ['TRANSMIT_AMBIGUOUS_RESPONSE', 'AMBIGUOUS_RAIL_RESPONSE'],
    ] as const) {
      const instructionId = `instruction-${scenario}`;
      const key = deriveIdempotencyKey('rail.submit', instructionId);
      const rail = new SimulatedRail('s4', { [key]: scenario });
      const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
      const outcome = connection.transmit(requestFor(instructionId));
      expect(outcome.class).toBe('UNKNOWN');
      if (outcome.class === 'UNKNOWN') {
        expect(outcome.reasonCode).toBe(reason);
      }
      // The rail never received anything — silence maps to UNKNOWN, never
      // an inferred CONFIRMED or FAILED (INV-13-4).
      expect(rail.receivedKeys().length).toBe(0);
      expect(connection.fetchReport(key).outcomeClass).toBe('UNKNOWN');
    }
  });

  test('unscripted keys default to ACCEPT_NO_REPORT; silence-after-transmit maps to UNKNOWN', () => {
    const key = deriveIdempotencyKey('rail.submit', 'instruction-unscripted');
    const rail = new SimulatedRail('s5');
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    expect(rail.scenarioFor(key)).toBe('ACCEPT_NO_REPORT');
    const outcome = connection.transmit(requestFor('instruction-unscripted'));
    expect(outcome.class).toBe('ACCEPTED');
    // The rail accepted but has no statement: PENDING is derived from the
    // rail's accepted-not-final ledger state.
    expect(connection.fetchReport(key).outcomeClass).toBe('PENDING');
    // A key the adapter never transmitted is pure silence → UNKNOWN.
    const stranger = deriveIdempotencyKey('rail.submit', 'instruction-never-sent');
    const strangerReport = connection.fetchReport(stranger);
    expect(strangerReport.outcomeClass).toBe('UNKNOWN');
    expect(strangerReport.reasonCode).toBe('SILENCE');
  });

  test('INV-13-3: duplicate submissions at the rail collapse to the same rail reference', () => {
    const instructionId = 'instruction-collapse';
    const key = deriveIdempotencyKey('rail.submit', instructionId);
    const rail = new SimulatedRail('s6', { [key]: 'ACCEPT_REPORT_CONFIRMED' });
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const request = requestFor(instructionId);
    const first = connection.transmit(request);
    const second = connection.transmit(request);
    expect(first.class).toBe('ACCEPTED');
    expect(second.class).toBe('ACCEPTED');
    if (first.class === 'ACCEPTED' && second.class === 'ACCEPTED') {
      expect(first.duplicate).toBe('FIRST');
      expect(second.duplicate).toBe('COLLAPSED');
      expect(second.railReferences).toEqual(first.railReferences);
    }
    // One ledger entry, one rail reference — collapsed.
    expect(rail.receivedKeys()).toEqual([key]);
  });

  test('idempotency key reused with a DIFFERENT payload is rejected by the rail', () => {
    const instructionId = 'instruction-key-reuse';
    const key = deriveIdempotencyKey('rail.submit', instructionId);
    const rail = new SimulatedRail('s7');
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const request = requestFor(instructionId);
    expect(connection.transmit(request).class).toBe('ACCEPTED');
    const tampered = requestFor(instructionId, {
      ...PAYLOAD,
      money: money('USD', 9999, 2),
    });
    const outcome = connection.transmit({ ...tampered, idempotencyKey: key });
    expect(outcome.class).toBe('REJECTED');
    if (outcome.class === 'REJECTED') {
      expect(outcome.reasonCode).toBe('RAIL_REJECTED_SUBMISSION');
      expect(outcome.detail).toContain('idempotency key reused');
    }
  });

  test('adapter-local validation: a malformed/tampered request is REJECTED before any rail interaction', () => {
    const rail = new SimulatedRail('s8');
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const request = requestFor('instruction-malformed');
    // Tampered hash: the recomputed hash does not match.
    const tampered = connection.transmit({ ...request, payloadHash: 'deadbeef' });
    expect(tampered.class).toBe('REJECTED');
    if (tampered.class === 'REJECTED') {
      expect(tampered.reasonCode).toBe('PAYLOAD_MALFORMED');
    }
    // Malformed payload (bad money shape — deliberately untyped: the
    // adapter-local validation must reject it BEFORE any rail interaction).
    const malformedMoney = {
      ...PAYLOAD,
      money: { currency: 'US', amountMinor: 1, scale: 2 },
    } as unknown as RailOperationPayload;
    const badPayload = connection.transmit({
      idempotencyKey: request.idempotencyKey,
      payload: malformedMoney,
      payloadHash: 'irrelevant',
    });
    expect(badPayload.class).toBe('REJECTED');
    // Empty key.
    const noKey = connection.transmit({
      idempotencyKey: '',
      payload: PAYLOAD,
      payloadHash: request.payloadHash,
    });
    expect(noKey.class).toBe('REJECTED');
    // "Before any external effect occurs": the rail ledger is empty.
    expect(rail.receivedKeys().length).toBe(0);
  });

  test('rail reference determinism: the Nth distinct key gets simrail.<id>.<N>', () => {
    const rail = new SimulatedRail('det');
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const ids = ['instruction-det-1', 'instruction-det-2', 'instruction-det-3'];
    for (const [index, instructionId] of ids.entries()) {
      const outcome = connection.transmit(requestFor(instructionId));
      expect(outcome.class).toBe('ACCEPTED');
      if (outcome.class === 'ACCEPTED') {
        expect(outcome.railReferences).toEqual([`simrail.det.${index + 1}`]);
      }
    }
  });
});

describe('delta 1 — transmission-only conformance (no protocol state reach)', () => {
  test('the adapter module imports nothing from the authority/store/persistence surfaces', () => {
    const source = readFileSync(join(HERE, 'adapters.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+[^;]*?from\s+'([^']+)';/gm)].map((match) =>
      match[1],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier.includes('authority')).toBe(false);
      expect(specifier.includes('reconciliation')).toBe(false);
      expect(specifier.includes('store')).toBe(false);
      expect(specifier.includes('persistence')).toBe(false);
      expect(specifier.includes('runtime')).toBe(false);
      expect(specifier.includes('index')).toBe(false);
    }
    // The only imports are pure-data modules (types/payload) and the kernel
    // money module for payload validation.
    expect(imports.every((specifier) => specifier.startsWith('./') || specifier.startsWith('../kernel/'))).toBe(true);
  });

  test('the connection interface exposes exactly two pure-data methods and takes no authority/store object', () => {
    const rail = new SimulatedRail('shape');
    const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
    const keys = Object.keys(connection).sort();
    expect(keys).toEqual(['fetchReport', 'transmit']);
  });
});

describe('NO-EGRESS verification — static source proof', () => {
  const RAILS_SOURCES = [
    'adapters.ts',
    'authority.ts',
    'index.ts',
    'matching.ts',
    'payload.ts',
    'persistence.ts',
    'reason-codes.ts',
    'reconciliation.ts',
    'runtime.ts',
    'store.ts',
    'types.ts',
  ];

  /**
   * Strip // line comments and /* block comments so the scan examines CODE
   * only: the modules' own doc-comments legitimately state the prohibitions
   * ("no external transmission", "CREDENTIAL-FREE", ...) — those words are
   * documentation OF the discipline, not violations of it.
   */
  function codeOnly(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  }

  test('no network client import or call exists anywhere in the rails runtime surface', () => {
    const forbiddenPatterns: ReadonlyArray<[string, RegExp]> = [
      ['node:net import', /from\s+'node:net'|require\('node:net'\)/],
      ['node:http(s) import', /from\s+'node:https?'|require\('node:https?'\)/],
      ['node:tls import', /from\s+'node:tls'|require\('node:tls'\)/],
      ['node:dns import', /from\s+'node:dns'|require\('node:dns'\)/],
      ['node:dgram import', /from\s+'node:dgram'|require\('node:dgram'\)/],
      ['undici import', /from\s+'undici'|require\('undici'\)/],
      ['fetch call', /(?<![.\w])fetch\s*\(/],
      ['WebSocket construction', /new\s+WebSocket\s*\(/],
      ['XMLHttpRequest construction', /new\s+XMLHttpRequest\s*\(/],
      ['globalThis.fetch access', /globalThis\s*\.\s*fetch/],
    ];
    for (const file of RAILS_SOURCES) {
      const source = codeOnly(readFileSync(join(HERE, file), 'utf8'));
      for (const [label, pattern] of forbiddenPatterns) {
        expect(`${file}: ${label} must be clean`).toBe(`${file}: ${label} must be clean`);
        expect(pattern.test(source)).toBe(false);
      }
    }
  });

  test('no rail credential-shaped identifiers exist in the rails runtime surface code', () => {
    // topology.md simulation rule: "no real credentials". The scan rejects
    // credential-shaped identifiers in CODE (comments stripped). ("idempotency
    // Key" is identity material, not a credential — the patterns below do
    // not match it.)
    const credentialPattern = /\b(api[_-]?key|secret|password|passwd|credential|bearer|access[_-]?token)\b/i;
    for (const file of RAILS_SOURCES) {
      const source = codeOnly(readFileSync(join(HERE, file), 'utf8'));
      expect(credentialPattern.test(source)).toBe(false);
    }
  });

  test('no socket egress exists in the ADAPTER module code specifically (work-order acceptance wording)', () => {
    const source = codeOnly(readFileSync(join(HERE, 'adapters.ts'), 'utf8'));
    expect(/socket/i.test(source)).toBe(false);
    expect(/net\s*\.connect|tls\s*\.connect/i.test(source)).toBe(false);
    expect(/dns\s*\.lookup/i.test(source)).toBe(false);
  });
});

describe('NO-EGRESS verification — behavioral proof', () => {
  test('a full transmit/fetch cycle runs with the network globals patched to throw', () => {
    const originalFetch = globalThis.fetch;
    const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    const boom = (): never => {
      throw new Error('NO-EGRESS violation: network API reached from the rails surface');
    };
    (globalThis as { fetch?: unknown }).fetch = boom;
    (globalThis as { WebSocket?: unknown }).WebSocket = boom;
    try {
      const key = deriveIdempotencyKey('rail.submit', 'instruction-no-egress');
      const rail = new SimulatedRail('s9', { [key]: 'ACCEPT_REPORT_FAILED' });
      const connection = createSimulatedRailAdapter(rail, { wallClock: () => WALL });
      const outcome = connection.transmit(requestFor('instruction-no-egress'));
      expect(outcome.class).toBe('ACCEPTED');
      const report = connection.fetchReport(key);
      expect(report.outcomeClass).toBe('FAILED');
      // Same request twice: the rail-side collapse path also stays local.
      expect(connection.transmit(requestFor('instruction-no-egress')).class).toBe('ACCEPTED');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
      (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    }
  });
});
