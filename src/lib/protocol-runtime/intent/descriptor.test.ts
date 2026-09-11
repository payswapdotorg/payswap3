/**
 * RTN-005 — DemandDescriptor construction, immutability, and canonical
 * hash tests.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §1:
 *   lines 39-41: "DemandDescriptor — immutable attachment created at DRAFT:
 *    amount (Money), source and destination descriptors, constraints
 *    (deadline, allowed rails, cost ceiling), idempotency key."
 *   lines 74-75: "INTENT_CREATED (... proof: submitted descriptor hash)."
 *   README.md §3 GC-1 lines 39-43 ("Re-running any computation on
 *    identical inputs yields identical outputs"; integer-only money).
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import {
  demandDescriptor,
  demandDescriptorHash,
  canonicalDemandDescriptor,
  demandDescriptorEquals,
  endpointDescriptor,
  demandConstraints,
  DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION,
} from './descriptor.ts';

const DESCRIPTOR_INPUT = {
  amount: money('EUR', 1_000, 2),
  source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
  destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
  constraints: {
    deadlineEpochMs: 60_000,
    allowedRails: ['rail-b', 'rail-a', 'rail-c'],
    costCeiling: money('USD', 500, 2),
  },
  idempotencyKey: 'idem-1',
};

describe('DemandDescriptor — the immutable attachment created at DRAFT', () => {
  test('the mint accepts the spec field list and canonicalizes the rail order', () => {
    const descriptor = demandDescriptor(DESCRIPTOR_INPUT);
    expect(descriptor.amount).toBe(DESCRIPTOR_INPUT.amount);
    expect(descriptor.idempotencyKey).toBe('idem-1');
    // allowed rails are stored ascending — one representation per set (GC-1)
    expect([...descriptor.constraints.allowedRails]).toEqual(['rail-a', 'rail-b', 'rail-c']);
    expect(descriptor.source.currency).toBe('EUR');
    expect(descriptor.destination.geography).toBe('US');
  });

  test('the minted descriptor and its parts are deep-frozen (immutable at DRAFT)', () => {
    const descriptor = demandDescriptor(DESCRIPTOR_INPUT);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.constraints)).toBe(true);
    expect(Object.isFrozen(descriptor.source)).toBe(true);
    expect(() => {
      (descriptor as { idempotencyKey: string }).idempotencyKey = 'tampered';
    }).toThrow();
    expect(() => {
      (descriptor.constraints as { deadlineEpochMs: number }).deadlineEpochMs = 1;
    }).toThrow();
  });

  test('invalid inputs are rejected deterministically (TypeError)', () => {
    expect(() => demandDescriptor({ ...DESCRIPTOR_INPUT, amount: money('EUR', 0, 2) })).toThrow(/positive/);
    expect(() =>
      demandDescriptor({ ...DESCRIPTOR_INPUT, constraints: { ...DESCRIPTOR_INPUT.constraints, deadlineEpochMs: 1.5 } }),
    ).toThrow(/integer/);
    expect(() =>
      demandDescriptor({ ...DESCRIPTOR_INPUT, constraints: { ...DESCRIPTOR_INPUT.constraints, allowedRails: [] } }),
    ).toThrow(/allowedRails/);
    expect(() =>
      demandDescriptor({ ...DESCRIPTOR_INPUT, constraints: { ...DESCRIPTOR_INPUT.constraints, allowedRails: ['x', 'x'] } }),
    ).toThrow(/duplicate/);
    expect(() => demandDescriptor({ ...DESCRIPTOR_INPUT, idempotencyKey: '' })).toThrow(/idempotencyKey/);
    expect(() =>
      demandDescriptor({ ...DESCRIPTOR_INPUT, source: { currency: 'eu', geography: 'DE', account: 'a' } }),
    ).toThrow(/uppercase/);
  });

  test('endpointDescriptor and demandConstraints guards', () => {
    expect(() => endpointDescriptor({ currency: 'E', geography: 'DE', account: 'a' })).toThrow();
    expect(() => endpointDescriptor({ currency: 'EUR', geography: '', account: 'a' })).toThrow();
    expect(() => demandConstraints({ deadlineEpochMs: 0, allowedRails: ['a'], costCeiling: money('USD', 1, 2) })).not.toThrow();
  });
});

describe('the submitted descriptor hash — deterministic, versioned, injective', () => {
  test('identical descriptors derive identical hashes (GC-1)', () => {
    const a = demandDescriptor(DESCRIPTOR_INPUT);
    const b = demandDescriptor({
      ...DESCRIPTOR_INPUT,
      constraints: {
        ...DESCRIPTOR_INPUT.constraints,
        // the same set in a different input order canonicalizes identically
        allowedRails: ['rail-c', 'rail-a', 'rail-b'],
      },
    });
    expect(demandDescriptorHash(a)).toBe(demandDescriptorHash(b));
    expect(canonicalDemandDescriptor(a)).toBe(canonicalDemandDescriptor(b));
    expect(demandDescriptorEquals(a, b)).toBe(true);
  });

  test('any content difference derives a different hash', () => {
    const base = demandDescriptor(DESCRIPTOR_INPUT);
    const variants = [
      demandDescriptor({ ...DESCRIPTOR_INPUT, idempotencyKey: 'idem-2' }),
      demandDescriptor({ ...DESCRIPTOR_INPUT, amount: money('EUR', 1_001, 2) }),
      demandDescriptor({
        ...DESCRIPTOR_INPUT,
        destination: { currency: 'GBP', geography: 'US', account: 'acct-destination' },
      }),
      demandDescriptor({
        ...DESCRIPTOR_INPUT,
        constraints: { ...DESCRIPTOR_INPUT.constraints, deadlineEpochMs: 61_000 },
      }),
      demandDescriptor({
        ...DESCRIPTOR_INPUT,
        constraints: { ...DESCRIPTOR_INPUT.constraints, costCeiling: money('USD', 501, 2) },
      }),
    ];
    for (const variant of variants) {
      expect(demandDescriptorHash(variant)).not.toBe(demandDescriptorHash(base));
      expect(demandDescriptorEquals(variant, base)).toBe(false);
    }
  });

  test('the hash is version-prefixed (format changes detectable in storage)', () => {
    const hash = demandDescriptorHash(demandDescriptor(DESCRIPTOR_INPUT));
    expect(hash.startsWith(`ddh.v${DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION}.`)).toBe(true);
    expect(hash.length).toBe(`ddh.v1.`.length + 64);
  });
});
