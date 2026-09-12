/**
 * UI-011 — RUNTIME CHECKOUT ADAPTER product suite (bun).
 *
 * Proves the checkout port's honest runtime re-anchoring: offers and
 * statuses read the composed A01 Intent Authority (real DemandDescriptor
 * terms), only authority-reported figures are quoted, and merchant
 * decisions fail closed with the recorded area-20 gap — nothing
 * committed, nothing fabricated.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeCheckoutAdapter } from './runtime-checkout-adapter';
import { getCheckoutPort, registerCheckoutPortBacking } from './checkout-port';
import type { CheckoutPort } from './checkout-port';
import { deriveProtocolId } from '../protocol-runtime/kernel/identity.ts';
import { money } from '../protocol-runtime/kernel/money.ts';
import { demandDescriptor } from '../protocol-runtime/intent/descriptor.ts';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
const port = createRuntimeCheckoutAdapter(composition.handle);
registerCheckoutPortBacking(port);
const intentId = await (async () => {
  // Create a real intent through the GATEWAY (the hosted D-1 binding).
  const idempotencyKey = 'checkout-suite-intent-1';
  const derivedId = deriveProtocolId('intent', idempotencyKey);
  const admission = await composition.submit(
    'intent.submit',
    'Intent Authority',
    {
      descriptor: demandDescriptor({
        amount: money('USD', 2_500, 2),
        source: { currency: 'USD', geography: 'US', account: 'src_sb_main' },
        destination: { currency: 'USD', geography: 'US', account: 'mrc_copperline' },
        constraints: {
          deadlineEpochMs: 60_000_000,
          allowedRails: ['rail-a'],
          costCeiling: money('USD', 2_600, 2),
        },
        idempotencyKey,
      }),
    },
    idempotencyKey,
  );
  expect(admission.ok).toBe(true);
  return derivedId;
})();

describe('UI-011 runtime checkout adapter — honest boundary', () => {
  test('the pinned runtime status stays honestly ARRIVING for the checkout authority surface, with the A01 read surface named', () => {
    expect(port.runtime).toBe('ARRIVING');
    expect(port.nonAuthoritative).toBe(true);
    expect(port.authorityOwner).toContain('A01 Intent Authority');
    expect(port.authorityOwner).toContain('RTN wave 2');
    expect(getCheckoutPort()).toBe(port);
  });
});

describe('UI-011 runtime checkout adapter — offers read the A01 record', () => {
  test('a fresh runtime (no matching record) reports checkout-not-found — never a fabricated offer', async () => {
    const result = await port.getOffer({ checkoutId: 'pid.v1.never-recorded' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('checkout-not-found');
      expect(result.detail).toContain('no intent record');
      expect(result.reportedBy).toContain('runtime checkout adapter');
    }
  });

  test('the recorded intent presents as the open offer with ONLY authority-reported figures', async () => {
    const result = await port.getOffer({ checkoutId: intentId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.checkoutId).toBe(intentId);
      expect(result.offer.quotedAmounts.length).toBe(1);
      expect(result.offer.quotedAmounts[0]?.key).toBe('customer-pays');
      expect(result.offer.quotedAmounts[0]?.amount.amountMinorUnits).toBe(2_500);
      expect(result.offer.conditions.some((condition) => condition.id === 'condition.no-fee-quote')).toBe(true);
      expect(result.reportedBy).toContain('A01 Intent Authority');
    }
  });

  test('the default offer resolves a recorded intent', async () => {
    const result = await port.getOffer({});
    expect(result.ok).toBe(true);
  });

  test('the open-checkout queue lists the DRAFT intent from the A15 chain', async () => {
    const result = await port.listOpenCheckouts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.some((item) => item.checkoutId === intentId)).toBe(true);
    }
  });

  test('the status of the DRAFT intent is offered, with real conditions', async () => {
    const result = await port.getStatus({ checkoutId: intentId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe('offered');
      expect(result.record.checkoutId).toBe(intentId);
    }
  });
});

describe('UI-011 runtime checkout adapter — decisions fail closed (the recorded gap)', () => {
  test('accept is refused with decision-not-allowed — nothing committed, no fabricated acceptance', async () => {
    const result = await port.submitDecision({ checkoutId: intentId, decision: 'accept' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('decision-not-allowed');
      expect(result.detail).toContain('no merchant-decision command surface');
      expect(result.detail).toContain('area-20');
    }
  });

  test('decline is refused the same honest way', async () => {
    const result = await port.submitDecision({ checkoutId: intentId, decision: 'decline' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('decision-not-allowed');
    }
  });

  test('a terminal intent presents its terminal checkout state with the authority\u2019s recorded reason', async () => {
    // Drive the intent to FAILED through the gateway (authorize is hosted
    // via the merged bindings; the composed test gate is permissive).
    const authorized = await composition.submit(
      'intent.authorize',
      'Intent Authority',
      { intentId, policyDecisionId: 'pid.v1.decision-checkout-suite' },
      `authorize-${intentId}`,
      [intentId],
    );
    expect(authorized.ok).toBe(true);
    const failed = await composition.submit(
      'intent.fail',
      'Intent Authority',
      { intentId, reasonCode: 'NO_VIABLE_ROUTE' },
      `fail-${intentId}`,
      [intentId],
    );
    expect(failed.ok).toBe(true);
    const status = await port.getStatus({ checkoutId: intentId });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.record.state).toBe('failed');
      expect(status.record.reason).toContain('FAILED');
      expect(status.record.nextActions?.length).toBeGreaterThan(0);
    }
  });
});
