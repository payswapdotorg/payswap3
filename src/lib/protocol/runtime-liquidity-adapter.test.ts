/**
 * UI-011 — RUNTIME LIQUIDITY ADAPTER product suite (bun).
 *
 * Proves the liquidity port's runtime re-anchoring: provider positions are
 * the A06 Liquidity Authority's own records, credit positions the A07's,
 * queue snapshots the A08's; values are quoted verbatim from the
 * authorities' reads; the oversight aggregates are authority-UNKNOWN by
 * the recorded read-surface gap; roles are mirrored (P8); and the
 * verification overrides script the read's availability axis only.
 */

import { describe, expect, test } from 'bun:test';
import { composeProductTestRuntime, type ProductTestComposition } from './product-adapter-test-compose';
import { createRuntimeLiquidityPortFactory } from './runtime-liquidity-adapter';
import { getLiquidityPort, registerLiquidityPortBacking } from './liquidity-port';
import type { NavAudience } from '@/lib/navigation';
import { money } from '../protocol-runtime/kernel/money.ts';

const REQUESTER: NavAudience = 'provider';

// Top-level awaited setup (bun's ESM test runtime; the ambient bun:test
// declaration exposes describe/test/expect only — no lifecycle hooks).
const composition = await composeProductTestRuntime();
registerLiquidityPortBacking(createRuntimeLiquidityPortFactory(composition.handle));
let poolOpened = false;

function positions(audience: NavAudience) {
  return getLiquidityPort().getProviderPositions({ kind: 'provider-positions', requester: audience });
}

describe('UI-011 runtime liquidity adapter — honest boundary + role mirror', () => {
  test('the binding reports the runtime adapter (LIVE) with the owning authorities', async () => {
    const result = await positions(REQUESTER);
    expect(result.kind === 'permitted' || result.kind === 'denied').toBe(true);
    const binding = getLiquidityPort().binding;
    expect(binding.runtime).toBe('LIVE');
    expect(binding.implementation).toBe('runtime-adapter');
    expect(binding.authorityOwners).toContain('Liquidity Authority');
    expect(binding.authorityOwners).toContain('Credit Authority');
  });

  test('cross-role requests are refused (P8 — never filtered-and-shown)', async () => {
    const denied = await positions('customer');
    expect(denied.kind).toBe('denied');
    if (denied.kind === 'denied') {
      expect(denied.reason).toContain('only the provider audience');
    }
  });

  test('operator oversight answers operators only', async () => {
    const denied = await getLiquidityPort().getOperatorOversight({
      kind: 'operator-oversight',
      requester: 'provider',
    });
    expect(denied.kind).toBe('denied');
  });
});

describe('UI-011 runtime liquidity adapter — A06/A07/A08 reads', () => {
  test('a runtime with no pools/lines/queues reports the authoritative empty views', async () => {
    const result = await positions(REQUESTER);
    expect(result.kind).toBe('permitted');
    if (result.kind === 'permitted') {
      expect(result.view.liquidity.length).toBe(0);
      expect(result.view.credit.length).toBe(0);
      expect(result.view.queues.length).toBe(0);
    }
  });

  test('a funded pool presents the authority\u2019s own position accounting (total/reserved/available)', async () => {
    // Open + fund a pool on the OWNING authority's command surface
    // (liquidity kinds are D-2 un-hosted — the composed-journey precedent;
    // every step still evidenced in the real A15 log).
    const opened = await composition.authorities.liquidity.openPool({
      poolId: 'pool-liq-suite',
      currency: 'USD',
      scale: 2,
    });
    expect(opened.ok).toBe(true);
    const funded = await composition.authorities.liquidity.recordConfirmedFunding({
      poolId: 'pool-liq-suite',
      source: { kind: 'INTERNAL_TRANSFER', referenceId: 'funding-ref-suite' },
      amount: money('USD', 5_000_00, 2),
    });
    expect(funded.ok).toBe(true);
    poolOpened = true;
    const result = await positions(REQUESTER);
    expect(result.kind).toBe('permitted');
    if (result.kind === 'permitted') {
      expect(result.view.liquidity.length).toBe(1);
      const position = result.view.liquidity[0];
      expect(position?.balance.kind).toBe('authority-quoted');
      if (position?.balance.kind === 'authority-quoted') {
        expect(position.balance.amount).toBe('5000.00');
        expect(position.balance.quotedBy).toBe('Liquidity Authority');
      }
      expect(position?.reserved.kind).toBe('authority-quoted');
      expect(position?.available.kind).toBe('authority-quoted');
      if (position?.available.kind === 'authority-quoted') {
        expect(position.available.amount).toBe('5000.00');
      }
    }
  });

  test('an activated credit line presents the A07 exposure view (limit/remaining)', async () => {
    const offered = await composition.authorities.credit.offerLine({
      lineId: 'line-credit-suite',
      limit: money('USD', 10_000_00, 2),
    });
    expect(offered.ok).toBe(true);
    const activated = await composition.authorities.credit.activateLine('line-credit-suite');
    expect(activated.ok).toBe(true);
    const result = await positions(REQUESTER);
    expect(result.kind).toBe('permitted');
    if (result.kind === 'permitted') {
      expect(result.view.credit.length).toBe(1);
      const line = result.view.credit[0];
      expect(line?.creditLimit.kind).toBe('authority-quoted');
      if (line?.creditLimit.kind === 'authority-quoted') {
        expect(line.creditLimit.amount).toBe('10000.00');
        expect(line.creditLimit.quotedBy).toBe('Credit Authority');
      }
      expect(line?.remaining.kind).toBe('authority-quoted');
      if (line?.remaining.kind === 'authority-quoted') {
        expect(line.remaining.amount).toBe('10000.00');
      }
    }
  });

  test('the oversight aggregates are authority-UNKNOWN by the recorded read-surface gap (never UI-side sums)', async () => {
    const result = await getLiquidityPort().getOperatorOversight({
      kind: 'operator-oversight',
      requester: 'operator',
    });
    expect(result.kind).toBe('permitted');
    if (result.kind === 'permitted') {
      expect(result.view.aggregates.length).toBe(3);
      for (const aggregate of result.view.aggregates) {
        expect(aggregate.value.kind).toBe('authority-unknown');
        if (aggregate.value.kind === 'authority-unknown') {
          expect(aggregate.value.explanation).toContain('aggregate read');
          expect(aggregate.value.reconciliation?.whoResolves).toContain('Authority');
        }
      }
      expect(result.view.scopeNote).toContain('read-surface');
    }
  });

  test('the verification overrides script the read\u2019s availability axis only (authority-UNKNOWN presentation)', async () => {
    expect(poolOpened).toBe(true);
    const result = await getLiquidityPort({
      unknownSources: ['provider.position.balance'],
    }).getProviderPositions({ kind: 'provider-positions', requester: REQUESTER });
    expect(result.kind).toBe('permitted');
    if (result.kind === 'permitted') {
      const position = result.view.liquidity[0];
      expect(position?.balance.kind).toBe('authority-unknown');
      if (position?.balance.kind === 'authority-unknown') {
        expect(position.balance.explanation).toContain('Scripted indeterminacy for verification');
      }
      // The unscripted axes still quote the authority's reads.
      expect(position?.available.kind).toBe('authority-quoted');
    }
  });
});
