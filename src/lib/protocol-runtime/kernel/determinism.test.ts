/**
 * RTN-001 — repeated-run determinism test.
 *
 * Source of the tested contract: README.md §3 GC-1 lines 41-43 —
 * "Re-running any computation on identical inputs yields identical
 * outputs" — and core.md §0 lines 13-14 ("addition and subtraction are
 * entrywise and deterministic").
 *
 * Method: run the FULL kernel arithmetic/derivation/validation battery
 * TWICE inside one test run, aggregate every result into a transcript,
 * hash the transcript with sha256, and assert the two runs are identical
 * (both transcript strings and digests).
 */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  money,
  addMoney,
  subtractMoney,
  negateMoney,
  compareMoney,
  moneyEquals,
  moneyBag,
  moneyBagFromMoney,
  addMoneyBags,
  subtractMoneyBags,
  moneyBagEquals,
} from './money.ts';
import { protocolTime } from './time.ts';
import { deriveProtocolId, deriveIdempotencyKey } from './identity.ts';
import { validateCommandEnvelope } from './envelope.ts';
import type { Money } from './money.ts';

/**
 * The battery: a fixed input set exercising every kernel computation with an
 * aggregateable output. Pure — no clocks, no randomness — so any divergence
 * between two runs is a determinism defect.
 */
function runBattery(): string {
  const lines: string[] = [];

  const record = (label: string, value: unknown): void => {
    lines.push(`${label}=${JSON.stringify(value)}`);
  };

  const usd = (amountMinor: number): Money => money('USD', amountMinor, 2);
  const cases: ReadonlyArray<[number, number]> = [
    [0, 0],
    [1, 2],
    [-1, 1],
    [100, 234],
    [-100, -234],
    [Number.MAX_SAFE_INTEGER - 1, 1],
    [Number.MIN_SAFE_INTEGER + 1, -1],
  ];
  for (const [a, b] of cases) {
    record(`add(${a},${b})`, addMoney(usd(a), usd(b)).amountMinor);
    record(`sub(${a},${b})`, subtractMoney(usd(a), usd(b)).amountMinor);
    record(`neg(${a})`, negateMoney(usd(a)).amountMinor);
    record(`cmp(${a},${b})`, compareMoney(usd(a), usd(b)));
    record(`eq(${a},${b})`, moneyEquals(usd(a), usd(b)));
  }

  const bagA = moneyBag([
    { currency: 'USD', amountMinor: 100 },
    { currency: 'EUR', amountMinor: -50 },
    { currency: 'GBP', amountMinor: 0 },
  ]);
  const bagB = moneyBag([
    { currency: 'EUR', amountMinor: 50 },
    { currency: 'JPY', amountMinor: 7 },
  ]);
  record('bagAdd', addMoneyBags(bagA, bagB));
  record('bagSub', subtractMoneyBags(bagA, bagB));
  record('bagSubRev', subtractMoneyBags(bagB, bagA));
  record('bagEq', moneyBagEquals(addMoneyBags(bagA, bagB), addMoneyBags(bagA, bagB)));
  record('bagFromMoney', moneyBagFromMoney(money('CHF', 777, 2)));
  record('bagAddIdem', addMoneyBags(addMoneyBags(bagA, bagB), subtractMoneyBags(bagA, bagB)));

  record('time', protocolTime(41, 1_700_000_000_000));

  record('pid', deriveProtocolId('commitment', 'intent-1', 'cap-9'));
  record('pid2', deriveProtocolId('reservation', 'intent-1', 'hop-2', 'resource-3', 7));
  record('idem', deriveIdempotencyKey('intent.create', 'intent-1'));
  record('idem2', deriveIdempotencyKey('settlement.tick', 'default', 12345));

  const envelope = {
    kind: 'intent.create',
    authority: 'Intent Authority',
    subjectIds: ['intent-1', 'intent-2'],
    idempotencyKey: deriveIdempotencyKey('intent.create', 'intent-1'),
    protocolTime: protocolTime(7, 1_700_000_000_000),
    body: { amountMinor: 100, currency: 'USD', scale: 2 },
  };
  record('envelopeOk', validateCommandEnvelope(envelope).ok);
  record(
    'envelopeBad',
    validateCommandEnvelope({ ...envelope, idempotencyKey: '' }),
  );
  record(
    'envelopeBad2',
    validateCommandEnvelope({ ...envelope, protocolTime: { sequence: -1, wallMs: 0 } }),
  );

  return lines.join('\n');
}

describe('repeated-run determinism (GC-1)', () => {
  test('two full battery runs in one test run are identical', () => {
    const runOne = runBattery();
    const runTwo = runBattery();
    expect(runTwo).toBe(runOne);
  });

  test('the aggregated battery transcript hashes identically across runs', () => {
    const digestOne = createHash('sha256').update(runBattery(), 'utf8').digest('hex');
    const digestTwo = createHash('sha256').update(runBattery(), 'utf8').digest('hex');
    expect(digestTwo).toBe(digestOne);
    expect(digestOne).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the battery is non-trivial (covers every kernel computation family)', () => {
    const transcript = runBattery();
    expect(transcript.length).toBeGreaterThan(500);
    expect(transcript).toContain('add(');
    expect(transcript).toContain('bagAdd');
    expect(transcript).toContain('pid=');
    expect(transcript).toContain('idem=');
    expect(transcript).toContain('envelopeOk');
  });
});
