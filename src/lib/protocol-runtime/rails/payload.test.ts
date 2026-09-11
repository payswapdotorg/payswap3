/**
 * RTN-004 — Payload discipline tests (INV-13-2) and reason-code vocabulary
 * tests. Pure — no store.
 *
 * Sources of the tested contracts — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §1 Area 13:
 *   lines 63-65 (INV-13-2): "operation payloads carry integer Money
 *    verbatim from the authorization; payload hash is recorded at
 *    submission and re-checked on every report."
 *   line 36-40 (GC-3 link): "AUTHORIZED: created by Settlement Authority
 *    (area 12) with a linked settlement instruction; this link is the
 *    explicit authorization required by GC-3."
 * kernel reason-codes discipline: area-specific codes are owned by the
 *   area's materialization work order; the vocabulary is frozen.
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import {
  canonicalRailPayload,
  hashRailPayload,
  validateRailOperationPayload,
  RAIL_PAYLOAD_ENCODING_VERSION,
} from './payload.ts';
import { RAILS_REASON_CODES, isRailsReasonCode } from './reason-codes.ts';

const PAYLOAD = {
  instructionId: 'instruction-pay',
  money: money('USD', -1500, 2),
  beneficiary: 'acct-pay',
};

describe('INV-13-2 — canonical payload encoding and hashing', () => {
  test('the canonical encoding is versioned and length-prefixed (unambiguous)', () => {
    const encoded = canonicalRailPayload(PAYLOAD);
    expect(encoded.startsWith(`v${RAIL_PAYLOAD_ENCODING_VERSION}|`)).toBe(true);
    expect(encoded).toContain('s15:instruction-pay');
    expect(encoded).toContain('n:-1500');
    expect(encoded).toContain('s8:acct-pay');
  });

  test('identical inputs hash identically; any semantic difference changes the hash', () => {
    expect(hashRailPayload(PAYLOAD)).toBe(hashRailPayload(PAYLOAD));
    expect(hashRailPayload(PAYLOAD)).toMatch(/^[0-9a-f]{64}$/);
    // Amount difference.
    expect(hashRailPayload({ ...PAYLOAD, money: money('USD', -1501, 2) })).not.toBe(
      hashRailPayload(PAYLOAD),
    );
    // Currency difference.
    expect(hashRailPayload({ ...PAYLOAD, money: money('EUR', -1500, 2) })).not.toBe(
      hashRailPayload(PAYLOAD),
    );
    // Scale difference.
    expect(hashRailPayload({ ...PAYLOAD, money: money('USD', -1500, 3) })).not.toBe(
      hashRailPayload(PAYLOAD),
    );
    // Beneficiary difference.
    expect(hashRailPayload({ ...PAYLOAD, beneficiary: 'acct-other' })).not.toBe(
      hashRailPayload(PAYLOAD),
    );
    // Instruction-link difference (the GC-3 authorization link).
    expect(
      hashRailPayload({ ...PAYLOAD, instructionId: 'instruction-other' }),
    ).not.toBe(hashRailPayload(PAYLOAD));
    // Memo presence is semantic: absent ≠ present; two memos differ.
    expect(hashRailPayload({ ...PAYLOAD, memo: 'ref-1' })).not.toBe(hashRailPayload(PAYLOAD));
    expect(hashRailPayload({ ...PAYLOAD, memo: 'ref-2' })).not.toBe(
      hashRailPayload({ ...PAYLOAD, memo: 'ref-1' }),
    );
  });

  test('unambiguous encoding: field-boundary collisions are impossible', () => {
    const a = canonicalRailPayload({
      instructionId: 'ab',
      money: money('USD', 1, 2),
      beneficiary: 'c',
    });
    const b = canonicalRailPayload({
      instructionId: 'a',
      money: money('USD', 1, 2),
      beneficiary: 'bc',
    });
    expect(a).not.toBe(b);
    expect(hashRailPayload({ instructionId: 'ab', money: money('USD', 1, 2), beneficiary: 'c' })).not.toBe(
      hashRailPayload({ instructionId: 'a', money: money('USD', 1, 2), beneficiary: 'bc' }),
    );
  });

  test('validateRailOperationPayload mints exact kernel Money and rejects malformed inputs', () => {
    const validated = validateRailOperationPayload(PAYLOAD);
    expect(validated.money.amountMinor).toBe(-1500);
    expect(validated.money.currency).toBe('USD');
    expect(validated.money.scale).toBe(2);
    expect(validated.instructionId).toBe('instruction-pay');
    expect(validated.beneficiary).toBe('acct-pay');
    expect(validated.memo).toBe(undefined);

    expect(() => validateRailOperationPayload(null)).toThrow(/payload must be an object/);
    expect(() =>
      validateRailOperationPayload({ ...PAYLOAD, instructionId: '' }),
    ).toThrow(/instructionId/);
    expect(() =>
      validateRailOperationPayload({ ...PAYLOAD, beneficiary: '' }),
    ).toThrow(/beneficiary/);
    expect(() =>
      validateRailOperationPayload({ ...PAYLOAD, money: { currency: 'usd', amountMinor: 1, scale: 2 } }),
    ).toThrow(/Money/);
    expect(() =>
      validateRailOperationPayload({ ...PAYLOAD, money: { currency: 'USD', amountMinor: 1.5, scale: 2 } }),
    ).toThrow(/Money/);
    expect(() => validateRailOperationPayload({ ...PAYLOAD, memo: 7 })).toThrow(/memo/);
  });
});

describe('rails reason-code vocabulary — frozen, owned by this surface', () => {
  test('the vocabulary is frozen and contains the spec-named causes and failure classes', () => {
    expect(Object.isFrozen(RAILS_REASON_CODES)).toBe(true);
    for (const code of [
      // Area 13 failure/UNKNOWN semantics (lines 42-44, 74-78).
      'PAYLOAD_MALFORMED',
      'RAIL_REJECTED_SUBMISSION',
      'TIMEOUT',
      'CONNECTION_LOSS',
      'AMBIGUOUS_RAIL_RESPONSE',
      'SILENCE',
      // INV-13-2.
      'PAYLOAD_HASH_MISMATCH',
      // Guard labels (implementation convention, CONTRACT-REVIEW).
      'ILLEGAL_TRANSITION',
      'DUPLICATE_RESOLUTION',
      'PROOF_REQUIRED',
      'RESOLUTION_NOT_APPLICABLE',
      'SEQUENCE_REGRESSION',
    ]) {
      expect(isRailsReasonCode(code)).toBe(true);
    }
  });

  test('the guard rejects non-members', () => {
    expect(isRailsReasonCode('SOME_INVENTED_CODE')).toBe(false);
    expect(isRailsReasonCode('')).toBe(false);
    expect(isRailsReasonCode(42)).toBe(false);
    expect(isRailsReasonCode(null)).toBe(false);
  });

  test('the shared GC-2 vocabulary stays the kernel\'s (no duplication here)', () => {
    // The rails vocabulary is area-owned; the shared UNKNOWN token belongs
    // to the kernel (reason-codes.ts there) — this surface does not
    // re-export or re-freeze it as a rails code.
    expect(RAILS_REASON_CODES.includes('UNKNOWN')).toBe(false);
  });
});
