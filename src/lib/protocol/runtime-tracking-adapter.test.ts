/**
 * UI-011 — RUNTIME TRACKING ADAPTER product suite (bun).
 *
 * Proves the tracking port's runtime re-anchoring: tracked states are the
 * A01 Intent Authority's own state reports; the plain-language history and
 * the proof trail are the REAL A15 chain's INTENT_* records; the
 * evidence-read availability scripting (the verification affordance)
 * renders the honest no-answer record view; references the runtime does
 * not know render not-found with UNKNOWN-honest wording.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeTrackingAdapter } from './runtime-tracking-adapter';
import { getTrackingPort, registerTrackingPortBacking } from './tracking-port';
import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { money } from '../protocol-runtime/kernel/money.ts';
import { demandDescriptor } from '../protocol-runtime/intent/descriptor.ts';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
{
  const port = createRuntimeTrackingAdapter(composition.handle);
  registerTrackingPortBacking(port);
}
const intentId = await (async () => {
  const idempotencyKey = 'tracking-suite-intent-1';
  const derivedId = deriveProtocolId('intent', idempotencyKey);
  const admission = await composition.submit(
    'intent.submit',
    'Intent Authority',
    {
      descriptor: demandDescriptor({
        amount: money('USD', 1_840, 2),
        source: { currency: 'USD', geography: 'US', account: 'src_sb_main' },
        destination: { currency: 'USD', geography: 'US', account: 'mrc_copperline' },
        constraints: {
          deadlineEpochMs: 60_000_000,
          allowedRails: ['rail-a'],
          costCeiling: money('USD', 2_000, 2),
        },
        idempotencyKey,
      }),
    },
    idempotencyKey,
  );
  expect(admission.ok).toBe(true);
  return derivedId;
})();

describe('UI-011 runtime tracking adapter — honest boundary', () => {
  test('describeBoundary reports the runtime adapter honestly', () => {
    const boundary = getTrackingPort().describeBoundary();
    expect(boundary.backingKind).toBe('runtime-adapter');
    expect(boundary.runtime).toBe('LIVE');
    expect(boundary.authoritative).toBe(true);
    expect(boundary.presentationOnly).toBe(false);
    expect(boundary.backingModule).toContain('runtime-tracking-adapter');
    expect(boundary.authorityOwner).toContain('Intent Authority');
    expect(boundary.authorityOwner).toContain('Evidence Authority');
  });
});

describe('UI-011 runtime tracking adapter — lookups resolve the runtime\u2019s own records', () => {
  test('an unknown reference renders not-found with UNKNOWN-honest wording (never a fabricated view)', async () => {
    const result = await getTrackingPort().lookupReference('PWS-DOES-NOT-EXIST', 'operator');
    expect(result.kind).toBe('not-found');
    if (result.kind === 'not-found') {
      expect(result.wording).toContain('never as a fabricated state');
      expect(result.wording).toContain('No tracked record matches');
      expect(result.reportedBy).toContain('A01');
    }
  });

  test('a recorded intent tracks with its real state, A15 history, and proof trail', async () => {
    const result = await getTrackingPort().lookupReference(intentId, 'customer');
    expect(result.kind).toBe('tracked');
    if (result.kind === 'tracked') {
      expect(result.view.protocolObject.objectType).toBe('PaymentIntent');
      expect(result.view.protocolObject.objectId).toBe(intentId);
      expect(result.view.currentState.state).toBe('waiting');
      expect(result.view.currentState.protocolObject.objectId).toBe(intentId);
      // The history is the real INTENT_CREATED record.
      expect(result.view.history.length).toBe(1);
      expect(result.view.history[0]?.wording).toContain('INTENT_CREATED');
      expect(result.view.history[0]?.authority).toBe('Intent Authority');
      // The proof trail is the real A15 record with its hash.
      expect(result.view.evidenceTrail.length).toBe(1);
      const evidence = result.view.evidenceTrail[0];
      expect(evidence?.kind).toBe('recorded');
      if (evidence?.kind === 'recorded') {
        expect(evidence.owningAuthority).toContain('Evidence Authority');
        expect(evidence.outcomeWording).toContain('DRAFT');
        expect(evidence.outcomeWording).toContain('hash ');
      }
    }
  });

  test('terminal transitions extend the history and flip the tracked state', async () => {
    const authorized = await composition.submit(
      'intent.authorize',
      'Intent Authority',
      { intentId, policyDecisionId: 'pid.v1.decision-tracking-suite' },
      `authorize-${intentId}`,
      [intentId],
    );
    expect(authorized.ok).toBe(true);
    const failed = await composition.submit(
      'intent.fail',
      'Intent Authority',
      { intentId, reasonCode: 'FULFILLMENT_FAILED' },
      `fail-${intentId}`,
      [intentId],
    );
    expect(failed.ok).toBe(true);
    const result = await getTrackingPort().lookupReference(intentId, 'merchant');
    expect(result.kind).toBe('tracked');
    if (result.kind === 'tracked') {
      expect(result.view.currentState.state).toBe('failed');
      if (result.view.currentState.state === 'failed') {
        expect(result.view.currentState.reason).toBe('FULFILLMENT_FAILED');
        expect(result.view.currentState.nextActions?.length).toBeGreaterThan(0);
      }
      expect(result.view.history.length).toBe(3);
      expect(result.view.history.some((entry) => entry.wording.includes('INTENT_AUTHORIZED'))).toBe(true);
      expect(result.view.history.some((entry) => entry.wording.includes('FULFILLMENT_FAILED'))).toBe(true);
      expect(result.view.evidenceTrail.length).toBe(3);
    }
  });
});

describe('UI-011 runtime tracking adapter — the evidence-read availability scripting (verification affordance)', () => {
  test('a scripted no-answer record renders the honest no-answer evidence view; reset restores the recorded view', async () => {
    const scripting = getTrackingPort() as ReturnType<typeof createRuntimeTrackingAdapter>;
    const before = await scripting.lookupReference(intentId, 'operator');
    if (before.kind !== 'tracked') throw new Error('expected tracked');
    const firstRecordId = before.view.evidenceTrail[0]?.recordId ?? '';
    scripting.scriptEvidenceAvailability(intentId, firstRecordId, 'no-answer');
    const scripted = await scripting.lookupReference(intentId, 'operator');
    if (scripted.kind !== 'tracked') throw new Error('expected tracked');
    const first = scripted.view.evidenceTrail[0];
    expect(first?.kind).toBe('no-answer');
    if (first?.kind === 'no-answer') {
      expect(first.explanation).toContain('scripted to no-answer');
      expect(first.reconciliation?.whoResolves).toContain('Evidence Authority');
    }
    scripting.resetScripting();
    const restored = await scripting.lookupReference(intentId, 'operator');
    if (restored.kind !== 'tracked') throw new Error('expected tracked');
    expect(restored.view.evidenceTrail[0]?.kind).toBe('recorded');
  });
});
