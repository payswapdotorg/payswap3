/**
 * RTN-001 — command envelope validation tests.
 *
 * Source of the tested contract: RTN-001 acceptance ("Command envelope
 * validates (authority target, subject ids, idempotency key, protocol
 * time)"), anchored on the A15 slot lines (evidence-risk-compliance.md
 * lines 27-29) and the DEP-003 enqueue contract (spec/durable/execution.md
 * §6 lines 125-133).
 */
import { describe, expect, test } from 'bun:test';
import {
  validateCommandEnvelope,
  commandEnvelopeToEnqueueInput,
} from './envelope.ts';
import { protocolTime } from './time.ts';
import { deriveIdempotencyKey } from './identity.ts';

function baseEnvelope(): Record<string, unknown> {
  return {
    kind: 'intent.create',
    authority: 'Intent Authority',
    subjectIds: ['intent-1'],
    idempotencyKey: deriveIdempotencyKey('intent.create', 'intent-1'),
    protocolTime: protocolTime(7, 1_700_000_000_000),
    body: { amountMinor: 100, currency: 'USD', scale: 2 },
  };
}

describe('command envelope validation (conformance)', () => {
  test('a well-formed envelope validates', () => {
    const result = validateCommandEnvelope(baseEnvelope());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.kind).toBe('intent.create');
      expect(result.envelope.authority).toBe('Intent Authority');
      expect(result.envelope.subjectIds).toEqual(['intent-1']);
      expect(result.envelope.protocolTime.sequence).toBe(7);
      expect(result.envelope.body).toEqual({ amountMinor: 100, currency: 'USD', scale: 2 });
    }
  });

  test('an empty subject list is valid (commands may address no prior subject)', () => {
    const value = baseEnvelope();
    value.subjectIds = [];
    const result = validateCommandEnvelope(value);
    expect(result.ok).toBe(true);
  });

  test('authority allow-lists are honored when provided', () => {
    const result = validateCommandEnvelope(baseEnvelope(), {
      allowedAuthorities: ['Intent Authority'],
    });
    expect(result.ok).toBe(true);
    const rejected = validateCommandEnvelope(baseEnvelope(), {
      allowedAuthorities: ['Evidence Authority'],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.field).toBe('authority');
    }
  });

  test('the JSON round-trip of a validated envelope still validates', () => {
    const first = validateCommandEnvelope(baseEnvelope());
    expect(first.ok).toBe(true);
    if (first.ok) {
      const roundTrip = JSON.parse(JSON.stringify(first.envelope)) as unknown;
      const second = validateCommandEnvelope(roundTrip);
      expect(second.ok).toBe(true);
    }
  });
});

describe('command envelope validation (negative: malformed envelopes rejected)', () => {
  test('non-object input is rejected', () => {
    expect(validateCommandEnvelope('nope').ok).toBe(false);
    expect(validateCommandEnvelope(null).ok).toBe(false);
    expect(validateCommandEnvelope([]).ok).toBe(false);
  });

  test('kind problems are reported on the kind field', () => {
    const missing = baseEnvelope();
    delete missing.kind;
    const missingResult = validateCommandEnvelope(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.field).toBe('kind');
    }

    const shaped = baseEnvelope();
    shaped.kind = 'Intent Create!';
    const shapedResult = validateCommandEnvelope(shaped);
    expect(shapedResult.ok).toBe(false);
    if (!shapedResult.ok) {
      expect(shapedResult.field).toBe('kind');
    }
  });

  test('authority problems are reported on the authority field', () => {
    const missing = baseEnvelope();
    delete missing.authority;
    const result = validateCommandEnvelope(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('authority');
    }

    const empty = baseEnvelope();
    empty.authority = '';
    expect(validateCommandEnvelope(empty).ok).toBe(false);
  });

  test('subject id problems are reported on the subjectIds field', () => {
    const notArray = baseEnvelope();
    notArray.subjectIds = 'intent-1';
    const notArrayResult = validateCommandEnvelope(notArray);
    expect(notArrayResult.ok).toBe(false);
    if (!notArrayResult.ok) {
      expect(notArrayResult.field).toBe('subjectIds');
    }

    const emptyElement = baseEnvelope();
    emptyElement.subjectIds = ['intent-1', ''];
    const emptyElementResult = validateCommandEnvelope(emptyElement);
    expect(emptyElementResult.ok).toBe(false);
    if (!emptyElementResult.ok) {
      expect(emptyElementResult.field).toBe('subjectIds');
    }

    const nonString = baseEnvelope();
    nonString.subjectIds = [42];
    expect(validateCommandEnvelope(nonString).ok).toBe(false);
  });

  test('idempotency key problems are reported on the idempotencyKey field', () => {
    const missing = baseEnvelope();
    delete missing.idempotencyKey;
    const missingResult = validateCommandEnvelope(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.field).toBe('idempotencyKey');
    }

    // A null key is the DEP-003 dedupe opt-out — forbidden on protocol commands.
    const nullKey = baseEnvelope();
    nullKey.idempotencyKey = null;
    const nullKeyResult = validateCommandEnvelope(nullKey);
    expect(nullKeyResult.ok).toBe(false);
    if (!nullKeyResult.ok) {
      expect(nullKeyResult.field).toBe('idempotencyKey');
      expect(nullKeyResult.problem).toContain('never opt out of dedupe');
    }

    const empty = baseEnvelope();
    empty.idempotencyKey = '';
    expect(validateCommandEnvelope(empty).ok).toBe(false);
  });

  test('malformed protocol time is reported on the protocolTime field', () => {
    const missing = baseEnvelope();
    delete missing.protocolTime;
    const missingResult = validateCommandEnvelope(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.field).toBe('protocolTime');
    }

    const floatSequence = baseEnvelope();
    floatSequence.protocolTime = { sequence: 1.5, wallMs: 0 };
    expect(validateCommandEnvelope(floatSequence).ok).toBe(false);

    const negativeSequence = baseEnvelope();
    negativeSequence.protocolTime = { sequence: -1, wallMs: 0 };
    expect(validateCommandEnvelope(negativeSequence).ok).toBe(false);

    const floatWall = baseEnvelope();
    floatWall.protocolTime = { sequence: 1, wallMs: 0.5 };
    expect(validateCommandEnvelope(floatWall).ok).toBe(false);
  });

  test('an undefined body is rejected (JSON round-trip stability)', () => {
    const value = baseEnvelope();
    value.body = undefined;
    const result = validateCommandEnvelope(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('body');
    }
  });
});

describe('command envelope → DEP-003 enqueue mapping (1:1)', () => {
  test('the enqueue input carries exactly kind, payload, idempotencyKey', () => {
    const validated = validateCommandEnvelope(baseEnvelope());
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error('precondition failed: base envelope must validate');
    }
    const input = commandEnvelopeToEnqueueInput(validated.envelope);
    expect(Object.keys(input).sort()).toEqual(['idempotencyKey', 'kind', 'payload']);
    expect(input.kind).toBe('intent.create');
    expect(input.idempotencyKey).toBe(validated.envelope.idempotencyKey);
    // The payload IS the envelope (self-describing command payload).
    expect(input.payload).toEqual(validated.envelope);
  });

  test('the payload JSON round-trips: enqueue → store → parse → validate', () => {
    const validated = validateCommandEnvelope(baseEnvelope());
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error('precondition failed');
    }
    const input = commandEnvelopeToEnqueueInput(validated.envelope);
    const stored = JSON.parse(JSON.stringify(input.payload)) as unknown;
    const revalidated = validateCommandEnvelope(stored);
    expect(revalidated.ok).toBe(true);
  });

  test('the dedupe identity is (idempotencyKey, kind) — different kind, same key', () => {
    // Same idempotency key under a different kind is a DIFFERENT dedupe
    // identity: this mirrors the UNIQUE (idempotency_key, kind) constraint.
    const validated = validateCommandEnvelope(baseEnvelope());
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error('precondition failed');
    }
    const input = commandEnvelopeToEnqueueInput(validated.envelope);
    const other = commandEnvelopeToEnqueueInput({
      ...validated.envelope,
      kind: 'intent.cancel',
    });
    expect(other.kind).not.toBe(input.kind);
    expect(other.idempotencyKey).toBe(input.idempotencyKey);
  });
});
