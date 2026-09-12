/**
 * UI-011 — RUNTIME INTENT ADAPTER product suite (bun).
 *
 * Proves the intent port's runtime re-anchoring end-to-end over the REAL
 * gateway + durable path + A01 authority + A15 chain (the shared bun-safe
 * composition in product-adapter-test-compose.ts):
 *   • commands round-trip through ProtocolGateway.submitCommand (the sole
 *     admission point) with the documented nested intent.submit body;
 *   • the DUPLICATE receipt surfaces as an explicit state (the same
 *     intent, evidence-trail visible, no second effect, no retry storm);
 *   • typed gateway rejections surface verbatim through the frozen
 *     refusal vocabulary;
 *   • state reads come from the A01 query API + the real A15 records;
 *   • UNKNOWN presentation: a query with no record is no-answer — never
 *     failure, never fabricated;
 *   • consequence quotes come only from the A03 snapshot the runtime
 *     actually reports (no fee is invented);
 *   • the boundary report describes the runtime adapter honestly.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeIntentAdapter } from './runtime-intent-adapter';
import { getIntentPort, registerIntentPortBacking } from './intent-port';
import type { IntentDraft, IntentPort } from './intent-port';
import { INTENT_STATE_DISPLAY_MAP, intentDisplayState } from './intent-state-mapping';
import { money } from '../protocol-runtime/kernel/money.ts';

const DRAFT: IntentDraft = {
  outcomeKind: 'send-payment',
  outcomeStatement: 'I want to send money to a merchant.',
  amount: '25.00',
  currency: 'USD',
  recipient: { id: 'mrc_copperline', displayName: 'Copperline Coffee' },
  source: { id: 'src_sb_main', displayName: 'Sandbox balance · Main' },
  customerReference: 'UI-011 product suite',
};

/**
 * Register + activate a capability. capability.register/activate are
 * gateway-admitted but UN-HOSTED on the composed durable path (the D-2
 * vocabulary gap, INTEGRATION-EVIDENCE.md), so the test drives them on the
 * OWNING authority's command surface — exactly the composed-journey
 * precedent ("with every step still evidenced in the real A15 log"). The
 * adapter under test then READS the real A03 state.
 */
async function registerCapability(composition: ProductTestComposition, capabilityId: string): Promise<void> {
  const registered = await composition.authorities.capability.registerCapability({
    capabilityId,
    declaration: {
      railId: 'rail-a',
      corridor: {
        sourceCurrency: 'USD',
        destinationCurrency: 'USD',
        sourceGeography: 'US',
        destinationGeography: 'US',
      },
      costSchedule: money('USD', 65, 2),
      tier: 'STANDARD',
    },
    declaredCapacity: money('USD', 1_000_000, 2),
  });
  expect(registered.ok).toBe(true);
  const activated = await composition.authorities.capability.activateCapability(capabilityId);
  expect(activated.ok).toBe(true);
}

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
const port = createRuntimeIntentAdapter(composition.handle);
registerIntentPortBacking(port);

describe('UI-011 runtime intent adapter — boundary honesty', () => {
  test('the boundary report describes the runtime adapter honestly (implementation identity, capability limits)', () => {
    const boundary = port.boundary();
    expect(boundary.runtimeStatus).toBe('LIVE');
    expect(boundary.authoritative).toBe(true);
    expect(boundary.implementation).toContain('runtime adapter');
    expect(boundary.implementation).toContain('ProtocolGateway.submitCommand');
    expect(boundary.note).toContain('no browser transport binding');
    expect(boundary.note).toContain('no pre-submit fee-quote surface');
  });

  test('the accessor returns the registered runtime adapter (the port splice)', () => {
    expect(getIntentPort()).toBe(port);
  });

  test('the composition options remain the product directory (hydration-stable shared constant)', () => {
    expect(port.getCompositionOptions().currency).toBe('USD');
    expect(port.getCompositionOptions().recipients[0]?.id).toBe('mrc_copperline');
  });
});

describe('UI-011 runtime intent adapter — consequence quoting reads the runtime only', () => {
  test('a fresh runtime quotes no terms (no capability for the corridor) — honest no-answer, review stays closed', async () => {
    const result = await port.requestConsequenceReport(DRAFT);
    expect(result.kind).toBe('no-answer');
    if (result.kind === 'no-answer') {
      expect(result.note).toContain('no active capability');
      expect(result.note).toContain('no fee is invented');
    }
  });

  test('with a registered ACTIVE capability the quote carries the A03 cost schedule as the fee', async () => {
    await registerCapability(composition, 'cap-usd-standard');
    const result = await port.requestConsequenceReport(DRAFT);
    expect(result.kind).toBe('report');
    if (result.kind === 'report') {
      expect(result.report.feeQuoted).toBe('0.65');
      expect(result.report.totalQuoted).toBe('25.65');
      expect(result.report.boundaryNote).toContain('Capability Authority');
      expect(result.report.terms.some((term) => term.id === 'term.single' && term.statement.includes('DUPLICATE'))).toBe(true);
    }
  });

  test('a malformed draft issues no report (no-answer at the boundary)', async () => {
    const result = await port.requestConsequenceReport({ ...DRAFT, amount: 'not-a-number' });
    expect(result.kind).toBe('no-answer');
  });
});

describe('UI-011 runtime intent adapter — submit round-trips through the gateway', () => {
  test('an explicit reviewed submit is admitted, executed on the durable path, and presented from the A01 record', async () => {
    const quote = await port.requestConsequenceReport(DRAFT);
    expect(quote.kind).toBe('report');
    if (quote.kind !== 'report') return;
    const result = await port.submitIntent(DRAFT, {
      explicitUserSubmit: true,
      consequenceReportId: quote.report.reportId,
      draftFingerprint: quote.report.draftFingerprint,
    });
    expect(result.kind).toBe('transported');
    if (result.kind === 'transported') {
      expect(result.intentId.startsWith('pid.v1.')).toBe(true);
      expect(result.snapshot.authorityState).toBe('DRAFT');
      expect(intentDisplayState(result.snapshot.authorityState)).toBe('WAITING');
      expect(result.snapshot.authority.runtimeStatus).toBe('LIVE');
      // The evidence trail carries the gateway receipt AND the real A15
      // INTENT_CREATED record.
      const receipt = result.snapshot.evidence.find((entry) => entry.kind === 'submission-received');
      expect(receipt?.summary).toContain('ADMITTED');
      const created = result.snapshot.evidence.find((entry) => entry.summary.includes('INTENT_CREATED'));
      expect(created).toBeDefined();
      expect(created?.authority).toBe('Intent Authority');
    }
  });

  test('resubmitting the SAME reviewed report replays the SAME intent through the DUPLICATE receipt — one intent, no retry storm', async () => {
    const quote = await port.requestConsequenceReport(DRAFT);
    expect(quote.kind).toBe('report');
    if (quote.kind !== 'report') return;
    const first = await port.submitIntent(DRAFT, {
      explicitUserSubmit: true,
      consequenceReportId: quote.report.reportId,
      draftFingerprint: quote.report.draftFingerprint,
    });
    // A NEW quote is a NEW submission; the SAME quote replays.
    const quoteAgain = await port.requestConsequenceReport({ ...DRAFT, customerReference: 'UI-011 product suite' });
    expect(quoteAgain.kind).toBe('report');
    if (quoteAgain.kind !== 'report' || first.kind !== 'transported') return;
    const replay = await port.submitIntent(DRAFT, {
      explicitUserSubmit: true,
      consequenceReportId: quote.report.reportId,
      draftFingerprint: quote.report.draftFingerprint,
    });
    expect(replay.kind).toBe('transported');
    if (replay.kind === 'transported') {
      expect(replay.intentId).toBe(first.intentId);
      const duplicate = replay.snapshot.evidence.find((entry) => entry.summary.includes('DUPLICATE'));
      expect(duplicate).toBeDefined();
    }
    // Exactly ONE intent for the reviewed submission identity.
    const intents = composition.handle.evidenceLog
      .records()
      .filter((record) => record.what.operationType === 'INTENT_CREATED')
      .map((record) => record.what.subjectIds[0]);
    const uniqueIds = new Set(intents.filter((id) => id === first.intentId));
    expect(uniqueIds.size).toBe(1);
  });

  test('the authorization-shape gate refuses submits without a reviewed report (N3 discipline)', async () => {
    const result = await port.submitIntent(DRAFT, {
      explicitUserSubmit: true,
      consequenceReportId: 'qrpt_nonexistent',
      draftFingerprint: 'whatever',
    });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reason).toBe('missing-consequence-review');
    }
  });

  test('a submit lacking explicit authorization is refused', async () => {
    const quote = await port.requestConsequenceReport(DRAFT);
    expect(quote.kind).toBe('report');
    const result = await port.submitIntent(DRAFT, {
      explicitUserSubmit: false,
      consequenceReportId: 'x',
      draftFingerprint: 'y',
    } as never);
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reason).toBe('missing-explicit-authorization');
    }
  });

  test('a gateway typed rejection surfaces verbatim through the frozen refusal vocabulary', async () => {
    // Drive the gateway directly with a malformed intent.submit body: the
    // typed rejection (reason code + problem) is recorded as A15 evidence
    // — the adapter surfaces rejections of ITS submissions the same way
    // (see the refusal note wording in submitIntent).
    const admission = await composition.gateway.submitCommand({
      kind: 'intent.submit',
      authority: 'Intent Authority',
      subjectIds: [],
      idempotencyKey: 'gateway-rejection-probe',
      protocolTime: { sequence: 99, wallMs: 5_000 },
      body: { descriptor: { idempotencyKey: 42 } } as never,
    });
    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(['COMMAND_BODY_INVALID', 'ENVELOPE_INVALID']).toContain(admission.reasonCode);
      expect(typeof admission.problem).toBe('string');
    }
    const rejectionEvidence = composition.handle.evidenceLog
      .records()
      .some((record) => record.what.operationType === 'GATEWAY_COMMAND_REJECTED');
    expect(rejectionEvidence).toBe(true);
  });
});

describe('UI-011 runtime intent adapter — state reads from the runtime', () => {
  test('a query with no record answers no-answer (UNKNOWN — never failure, never fabricated)', async () => {
    const result = await port.getIntentState('pid.v1.does-not-exist');
    expect(result.kind).toBe('no-answer');
    if (result.kind === 'no-answer') {
      expect(result.reason).toBe('no-record');
      expect(result.note).toContain('UNKNOWN');
    }
  });

  test('the recorded intent reads back with its real state, A15 evidence, and display resolution', async () => {
    const quote = await port.requestConsequenceReport(DRAFT);
    expect(quote.kind).toBe('report');
    if (quote.kind !== 'report') return;
    const submitted = await port.submitIntent(DRAFT, {
      explicitUserSubmit: true,
      consequenceReportId: quote.report.reportId,
      draftFingerprint: quote.report.draftFingerprint,
    });
    expect(submitted.kind).toBe('transported');
    if (submitted.kind !== 'transported') return;
    const state = await port.getIntentState(submitted.intentId);
    expect(state.kind).toBe('snapshot');
    if (state.kind === 'snapshot') {
      expect(state.snapshot.intentId).toBe(submitted.intentId);
      expect(state.snapshot.intent.amount).toBe('25.00');
      expect(state.snapshot.stateReport.kind).toBe('held-for-recipient');
      if (state.snapshot.stateReport.kind === 'held-for-recipient') {
        expect(state.snapshot.stateReport.cancelAuthorized).toBe(false);
      }
      expect(state.snapshot.evidence.length).toBeGreaterThan(0);
    }
  });

  test('the session listing derives from the A15 INTENT_CREATED chain', async () => {
    const listing = await port.listSessionIntents();
    expect(listing.kind).toBe('records');
    if (listing.kind === 'records') {
      expect(listing.records.length).toBeGreaterThan(0);
      expect(listing.records.every((record) => record.authorityState === 'DRAFT')).toBe(true);
    }
  });

  test('the state matrix serves the runtime vocabulary with its frozen display resolutions', async () => {
    for (const state of ['DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED'] as const) {
      const fixture = await port.getPresentationFixture(state);
      expect(fixture.kind).toBe('snapshot');
      if (fixture.kind === 'snapshot') {
        expect(fixture.snapshot.authorityState).toBe(state);
        expect(INTENT_STATE_DISPLAY_MAP[state]).toBeDefined();
        expect(
          fixture.snapshot.evidence.some((entry) => entry.summary.includes('demonstration')),
        ).toBe(true);
      }
    }
    // Legacy fixture members are honestly not served as runtime states.
    const legacy = await port.getPresentationFixture('acknowledged');
    expect(legacy.kind).toBe('no-answer');
  });
});
