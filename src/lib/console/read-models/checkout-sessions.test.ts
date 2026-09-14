/**
 * PC-003 — Checkout sessions read-model tests: DTO schema conformance, the
 * frozen checkout display mapping, the EMPTY-list-is-a-VALUE vs
 * no-answer-is-UNKNOWN distinction, transport/authority-unreachable →
 * UNKNOWN, and source metadata. Delegation is proven by registering a test
 * backing at the checkout port's own register seam.
 */

import { describe, expect, test } from 'bun:test';

import { getCheckoutPort, registerCheckoutPortBacking } from '@/lib/protocol/checkout-port';
import type {
  CheckoutPort,
  CheckoutQueueResult,
  CheckoutStateRecord,
  CheckoutStatusResult,
} from '@/lib/protocol/checkout-port';
import { isConsoleStatus } from '../dto';
import { consoleSourceMetadata } from '../authority/sources';
import {
  readConsoleCheckoutSessionStatus,
  readConsoleCheckoutSessions,
} from './checkout-sessions';

// ── Test backing (the port's own register seam — no runtime is booted) ─────

function checkoutBacking(overrides: {
  list?: () => Promise<CheckoutQueueResult>;
  status?: (checkoutId: string) => Promise<CheckoutStatusResult>;
}): CheckoutPort {
  return {
    runtime: 'ARRIVING',
    authorityOwner: 'Checkout/Intent Authority (spec/architecture/v0.1)',
    nonAuthoritative: true,
    getOffer: async () => ({
      ok: false,
      error: 'checkout-not-found',
      detail: 'test backing',
      reportedBy: 'pc-003 test backing',
      runtime: 'ARRIVING',
    }),
    getStatus: async (request) =>
      overrides.status
        ? overrides.status(request.checkoutId)
        : {
            ok: false,
            error: 'checkout-not-found',
            detail: 'test backing holds no record',
            reportedBy: 'pc-003 test backing',
            runtime: 'ARRIVING',
          },
    listOpenCheckouts: async () =>
      overrides.list
        ? overrides.list()
        : {
            ok: false,
            error: 'authority-unreachable',
            detail: 'test backing unreachable',
            reportedBy: 'pc-003 test backing',
            runtime: 'ARRIVING',
          },
    submitDecision: async () => ({
      ok: false,
      error: 'decision-not-allowed',
      detail: 'test backing',
      reportedBy: 'pc-003 test backing',
      runtime: 'ARRIVING',
    }),
  };
}

function statusRecord(state: CheckoutStateRecord['state']): CheckoutStateRecord {
  return {
    checkoutId: 'cko_1',
    state,
    reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
    at: '2026-09-15T10:00:00.000Z',
    ...(state === 'failed' ? { reason: 'rail refused' } : {}),
    ...(state === 'unknown'
      ? { reconciliation: { whoResolves: 'ops', recheckTrigger: 'next run' } }
      : {}),
  };
}

// ── Sessions list ──────────────────────────────────────────────────────────

describe('PC-003 checkout sessions read model — list', () => {
  test('an items answer is a VALUE with verbatim port figures + boundary facts', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: true,
          items: [
            {
              checkoutId: 'cko_1',
              protocolReference: 'cko_1',
              title: 'Open offer — payment intent cko_1',
              receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
              validUntil: '2026-09-16T10:00:00.000Z',
            },
          ],
          reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
          runtime: 'ARRIVING',
        }),
      }),
    );
    const result = await readConsoleCheckoutSessions();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED'); // the read-level convention: the authority answered
    expect(result.value.sessions.length).toBe(1);
    expect(result.value.sessions[0]).toEqual({
      checkoutId: 'cko_1',
      protocolReference: 'cko_1',
      title: 'Open offer — payment intent cko_1',
      receiveAmount: { amountMinorUnits: 2500, currency: 'USD' },
      validUntil: '2026-09-16T10:00:00.000Z',
    });
    // The port's honest boundary facts ride along verbatim.
    expect(result.value.runtime).toBe('ARRIVING');
    expect(result.value.authorityOwner).toBe('Checkout/Intent Authority (spec/architecture/v0.1)');
    expect(result.value.reportedBy).toContain('A01 Intent Authority');
    expect(result.authority).toBe(consoleSourceMetadata('checkout-sessions'));
  });

  test('an EMPTY open-checkout list is a legitimate VALUE — not UNKNOWN, not fabricated', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: true,
          items: [],
          reportedBy: 'runtime checkout adapter over the composed A01 Intent Authority',
          runtime: 'ARRIVING',
        }),
      }),
    );
    const result = await readConsoleCheckoutSessions();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.status).toBe('SUCCEEDED');
    expect(result.value.sessions).toEqual([]);
  });

  test('authority-unreachable is a TRANSPORT failure → UNKNOWN, never a fabricated list', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: false,
          error: 'authority-unreachable',
          detail: 'The checkout authority boundary could not be reached.',
          reportedBy: 'pc-003 test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    const result = await readConsoleCheckoutSessions();
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('could not be reached');
    expect(result.note).toContain('not a business outcome');
    expect('status' in result).toBe(false);
  });

  test('a thrown port call is UNKNOWN — never FAILED/SUCCEEDED', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => {
          throw new Error('checkout port exploded');
        },
      }),
    );
    const result = await readConsoleCheckoutSessions();
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('checkout port exploded');
  });
});

// ── Session status ─────────────────────────────────────────────────────────

describe('PC-003 checkout sessions read model — per-session status', () => {
  test('every authority state resolves through the frozen mapping to exactly one console status', async () => {
    const cases: readonly [CheckoutStateRecord['state'], string, string][] = [
      ['offered', 'ACTION_REQUIRED', 'cko-map-01'],
      ['accept-submitted', 'IN_PROGRESS', 'cko-map-02'],
      ['decline-submitted', 'IN_PROGRESS', 'cko-map-03'],
      ['accepted', 'SUCCEEDED', 'cko-map-04'],
      ['accepted-awaiting-payment', 'WAITING', 'cko-map-05'],
      ['declined', 'SUCCEEDED', 'cko-map-06'],
      ['failed', 'FAILED', 'cko-map-07'],
      ['unknown', 'UNKNOWN', 'cko-map-08'],
    ];
    for (const [state, expectedStatus, expectedRecord] of cases) {
      registerCheckoutPortBacking(
        checkoutBacking({ status: async () => ({ ok: true, record: statusRecord(state), runtime: 'ARRIVING' }) }),
      );
      const result = await readConsoleCheckoutSessionStatus('cko_1');
      expect(result.outcome).toBe('value');
      if (result.outcome !== 'value') continue;
      expect(isConsoleStatus(result.status)).toBe(true);
      expect(result.status).toBe(expectedStatus);
      expect(result.value.state).toBe(state);
      expect(result.value.displayStatus).toBe(expectedStatus);
      expect(result.value.mappingRecord).toBe(expectedRecord);
      expect(result.value.checkoutId).toBe('cko_1');
      expect(result.value.reportedBy).toContain('A01 Intent Authority');
      expect(result.authority).toBe(consoleSourceMetadata('checkout-session-status'));
    }
  });

  test('a failed state carries the authority reason verbatim', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({ status: async () => ({ ok: true, record: statusRecord('failed'), runtime: 'ARRIVING' }) }),
    );
    const result = await readConsoleCheckoutSessionStatus('cko_1');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.reason).toBe('rail refused');
  });

  test('an unknown state carries the reconciliation path', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({ status: async () => ({ ok: true, record: statusRecord('unknown'), runtime: 'ARRIVING' }) }),
    );
    const result = await readConsoleCheckoutSessionStatus('cko_1');
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.reconciliation).toEqual({ whoResolves: 'ops', recheckTrigger: 'next run' });
  });

  test('checkout-not-found is UNKNOWN for the reference — never a fabricated state, never "not found" failure', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        status: async () => ({
          ok: false,
          error: 'checkout-not-found',
          detail: 'The Intent Authority holds no intent record for cko_missing. No offer is presented — never a fabricated one.',
          reportedBy: 'pc-003 test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    const result = await readConsoleCheckoutSessionStatus('cko_missing');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('never a fabricated');
    expect('status' in result).toBe(false);
  });

  test('authority-unreachable on the status read is a transport failure → UNKNOWN', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        status: async () => ({
          ok: false,
          error: 'authority-unreachable',
          detail: 'The checkout authority boundary could not be reached.',
          reportedBy: 'pc-003 test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    const result = await readConsoleCheckoutSessionStatus('cko_1');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') return;
    expect(result.presentationStatus).toBe('UNKNOWN');
    expect(result.note).toContain('not a business outcome');
  });
});

// ── Adapter thinness ───────────────────────────────────────────────────────

describe('PC-003 checkout sessions read model — adapter thinness', () => {
  test('the read model derives its DTO from the backing registered at the port seam (getCheckoutPort())', async () => {
    registerCheckoutPortBacking(
      checkoutBacking({
        list: async () => ({
          ok: true,
          items: [
            {
              checkoutId: 'cko_distinctive_9',
              protocolReference: 'cko_distinctive_9',
              title: 'Distinctive',
              receiveAmount: { amountMinorUnits: 9900, currency: 'USD' },
              validUntil: '2026-09-17T10:00:00.000Z',
            },
          ],
          reportedBy: 'pc-003 test backing',
          runtime: 'ARRIVING',
        }),
      }),
    );
    expect(getCheckoutPort().authorityOwner).toBe('Checkout/Intent Authority (spec/architecture/v0.1)');
    const result = await readConsoleCheckoutSessions();
    expect(result.outcome).toBe('value');
    if (result.outcome !== 'value') return;
    expect(result.value.sessions[0]?.checkoutId).toBe('cko_distinctive_9');
    expect(result.value.sessions[0]?.receiveAmount.amountMinorUnits).toBe(9900);
  });
});
