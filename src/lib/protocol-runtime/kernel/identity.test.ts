/**
 * RTN-001 — deterministic identity derivation tests.
 *
 * Source of the tested contract: the v0.1 INV idempotency contracts
 * (core.md INV-1-2/1-3 lines 57-62, INV-3-3 lines 182-184, INV-4-3 lines
 * 248-249, INV-5-3 lines 310-312; evidence-risk-compliance.md INV-15-4
 * lines 56-58) and spec/durable/execution.md §6 lines 130-133
 * ("Financially meaningful work MUST always carry a key derived from domain
 * identity").
 */
import { describe, expect, test } from 'bun:test';
import {
  DERIVATION_FORMAT_VERSION,
  canonicalDerivationInput,
  deriveProtocolId,
  deriveIdempotencyKey,
  isDerivedProtocolId,
  isDerivedIdempotencyKey,
} from './identity.ts';

describe('identity derivation (conformance: deterministic, versioned)', () => {
  test('identical inputs yield identical ids and keys', () => {
    expect(deriveProtocolId('commitment', 'intent-1', 'cap-9')).toBe(
      deriveProtocolId('commitment', 'intent-1', 'cap-9'),
    );
    expect(deriveIdempotencyKey('intent.create', 'intent-1')).toBe(
      deriveIdempotencyKey('intent.create', 'intent-1'),
    );
  });

  test('any input difference yields a different derivation', () => {
    expect(deriveProtocolId('commitment', 'intent-1', 'cap-9')).not.toBe(
      deriveProtocolId('commitment', 'intent-2', 'cap-9'),
    );
    expect(deriveIdempotencyKey('intent.create', 'intent-1')).not.toBe(
      deriveIdempotencyKey('intent.create', 'intent-2'),
    );
    expect(deriveIdempotencyKey('a', 'b')).not.toBe(deriveIdempotencyKey('b', 'a'));
  });

  test('the canonical encoding is unambiguous (no delimiter collisions)', () => {
    // ('ab', 'c') and ('a', 'bc') must NOT share an encoding or a derivation.
    expect(canonicalDerivationInput(['ab', 'c'])).not.toBe(canonicalDerivationInput(['a', 'bc']));
    expect(deriveProtocolId('ab', 'c')).not.toBe(deriveProtocolId('a', 'bc'));
    // string '1' and integer 1 are different parts.
    expect(canonicalDerivationInput(['1'])).not.toBe(canonicalDerivationInput([1]));
    expect(deriveIdempotencyKey('x', '1')).not.toBe(deriveIdempotencyKey('x', 1));
  });

  test('derived values carry the versioned format prefix', () => {
    const id = deriveProtocolId('reservation', 'intent-1', 'hop-2', 'resource-3');
    const key = deriveIdempotencyKey('intent.create', 'intent-1');
    expect(id.startsWith(`pid.v${DERIVATION_FORMAT_VERSION}.`)).toBe(true);
    expect(key.startsWith(`idem.v${DERIVATION_FORMAT_VERSION}.`)).toBe(true);
    expect(id).toMatch(/^pid\.v1\.[0-9a-f]{64}$/);
    expect(key).toMatch(/^idem\.v1\.[0-9a-f]{64}$/);
  });

  test('ids and idempotency keys live in distinct namespaces', () => {
    expect(deriveProtocolId('x')).not.toBe(deriveIdempotencyKey('x'));
    expect(isDerivedProtocolId(deriveProtocolId('x'))).toBe(true);
    expect(isDerivedProtocolId(deriveIdempotencyKey('x'))).toBe(false);
    expect(isDerivedIdempotencyKey(deriveIdempotencyKey('x'))).toBe(true);
    expect(isDerivedIdempotencyKey(deriveProtocolId('x'))).toBe(false);
  });

  test('type guards reject foreign values', () => {
    expect(isDerivedProtocolId('pid.v999.deadbeef')).toBe(false);
    expect(isDerivedIdempotencyKey('not-a-key')).toBe(false);
    expect(isDerivedProtocolId(null)).toBe(false);
    expect(isDerivedIdempotencyKey(42)).toBe(false);
  });

  test('integer parts of any magnitude within safe range are accepted', () => {
    expect(canonicalDerivationInput([0, 1, -1, Number.MAX_SAFE_INTEGER])).toBe(
      canonicalDerivationInput([0, 1, -1, Number.MAX_SAFE_INTEGER]),
    );
    expect(deriveProtocolId(0, 1, -1)).toBe(deriveProtocolId(0, 1, -1));
  });
});

describe('identity derivation (negative: non-integer inputs rejected)', () => {
  test('float numeric parts are rejected', () => {
    expect(() => deriveProtocolId('commitment', 1.5)).toThrow(/must be an integer/);
    expect(() => deriveIdempotencyKey('tick', Number.NaN)).toThrow(/must be an integer/);
    expect(() => canonicalDerivationInput([0.1])).toThrow(/must be an integer/);
  });

  test('unsafe numeric parts are rejected', () => {
    expect(() => deriveProtocolId('x', Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
  });

  test('non-string/non-number parts are rejected', () => {
    expect(() => deriveProtocolId('x', null as unknown as number)).toThrow(
      /must be a string or integer/,
    );
    expect(() => deriveIdempotencyKey('x', true as unknown as number)).toThrow(
      /must be a string or integer/,
    );
    expect(() => canonicalDerivationInput([{}] as unknown as string[])).toThrow(
      /must be a string or integer/,
    );
  });
});
