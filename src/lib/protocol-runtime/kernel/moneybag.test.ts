/**
 * RTN-001 — MoneyBag conformance + negative tests.
 *
 * Source of the tested contract: spec/architecture/v0.1/core.md §0 lines
 * 13-14 ("MoneyBag: set of (currency, integer amount) entries; addition and
 * subtraction are entrywise and deterministic").
 */
import { describe, expect, test } from 'bun:test';
import {
  money,
  moneyBag,
  emptyMoneyBag,
  moneyBagFromMoney,
  addMoneyBags,
  subtractMoneyBags,
  moneyBagEquals,
} from './money.ts';

describe('moneyBag construction (conformance)', () => {
  test('entries are stored once per currency, in ascending currency order', () => {
    const bag = moneyBag([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'EUR', amountMinor: 200 },
      { currency: 'GBP', amountMinor: 300 },
    ]);
    expect(bag.entries.map((entry) => entry.currency)).toEqual(['EUR', 'GBP', 'USD']);
    expect(bag.entries.map((entry) => entry.amountMinor)).toEqual([200, 300, 100]);
  });

  test('the ordering rule is stable across runs regardless of input order', () => {
    const one = moneyBag([
      { currency: 'ZAR', amountMinor: 1 },
      { currency: 'AUD', amountMinor: 2 },
      { currency: 'MXN', amountMinor: 3 },
    ]);
    const two = moneyBag([
      { currency: 'MXN', amountMinor: 3 },
      { currency: 'ZAR', amountMinor: 1 },
      { currency: 'AUD', amountMinor: 2 },
    ]);
    expect(moneyBagEquals(one, two)).toBe(true);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  test('negative and zero amounts are valid bag entries', () => {
    const bag = moneyBag([
      { currency: 'USD', amountMinor: -100 },
      { currency: 'EUR', amountMinor: 0 },
    ]);
    expect(bag.entries[0]).toEqual({ currency: 'EUR', amountMinor: 0 });
    expect(bag.entries[1]).toEqual({ currency: 'USD', amountMinor: -100 });
  });

  test('the empty bag is constructible and equals itself', () => {
    expect(emptyMoneyBag().entries).toEqual([]);
    expect(moneyBagEquals(emptyMoneyBag(), moneyBag([]))).toBe(true);
  });

  test('moneyBagFromMoney bridges a Money value into a one-entry bag', () => {
    const bag = moneyBagFromMoney(money('CHF', 777, 2));
    expect(bag.entries).toEqual([{ currency: 'CHF', amountMinor: 777 }]);
  });
});

describe('moneyBag construction (negative)', () => {
  test('float entry amounts are rejected', () => {
    expect(() => moneyBag([{ currency: 'USD', amountMinor: 1.5 }])).toThrow(/must be an integer/);
    expect(() => moneyBag([{ currency: 'USD', amountMinor: Number.NaN }])).toThrow(
      /must be an integer/,
    );
  });

  test('unsafe entry amounts are rejected', () => {
    expect(() =>
      moneyBag([{ currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER + 1 }]),
    ).toThrow(/safe integer/);
  });

  test('malformed currency codes are rejected', () => {
    expect(() => moneyBag([{ currency: 'usd', amountMinor: 100 }])).toThrow(/3 uppercase letters/);
    expect(() => moneyBag([{ currency: 'EURO', amountMinor: 100 }])).toThrow(/3 uppercase letters/);
  });

  test('duplicate currency entries are rejected (a bag is a set)', () => {
    expect(() =>
      moneyBag([
        { currency: 'USD', amountMinor: 100 },
        { currency: 'USD', amountMinor: 200 },
      ]),
    ).toThrow(/duplicate currency entry for USD/);
  });
});

describe('moneyBag arithmetic (conformance: entrywise, per-currency, deterministic)', () => {
  test('addition is entrywise across the currency union', () => {
    const a = moneyBag([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'EUR', amountMinor: 200 },
    ]);
    const b = moneyBag([
      { currency: 'EUR', amountMinor: 50 },
      { currency: 'GBP', amountMinor: 5 },
    ]);
    const sum = addMoneyBags(a, b);
    expect(sum.entries).toEqual([
      { currency: 'EUR', amountMinor: 250 },
      { currency: 'GBP', amountMinor: 5 },
      { currency: 'USD', amountMinor: 100 },
    ]);
  });

  test('subtraction is entrywise, per-currency, with implicit zero on one side', () => {
    const a = moneyBag([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'EUR', amountMinor: 200 },
    ]);
    const b = moneyBag([{ currency: 'EUR', amountMinor: 50 }]);
    const difference = subtractMoneyBags(a, b);
    expect(difference.entries).toEqual([
      { currency: 'EUR', amountMinor: 150 },
      { currency: 'USD', amountMinor: 100 },
    ]);
    // A currency present only in b counts as 0 in a.
    const reverse = subtractMoneyBags(b, a);
    expect(reverse.entries).toEqual([
      { currency: 'EUR', amountMinor: -150 },
      { currency: 'USD', amountMinor: -100 },
    ]);
  });

  test('entrywise arithmetic with negative amounts is exact', () => {
    const a = moneyBag([{ currency: 'USD', amountMinor: -100 }]);
    const b = moneyBag([{ currency: 'USD', amountMinor: -33 }]);
    expect(addMoneyBags(a, b).entries).toEqual([{ currency: 'USD', amountMinor: -133 }]);
    expect(subtractMoneyBags(a, b).entries).toEqual([{ currency: 'USD', amountMinor: -67 }]);
  });

  test('zero-amount entries are retained, never silently pruned', () => {
    const a = moneyBag([{ currency: 'USD', amountMinor: 100 }]);
    const b = moneyBag([{ currency: 'USD', amountMinor: -100 }]);
    const sum = addMoneyBags(a, b);
    expect(sum.entries).toEqual([{ currency: 'USD', amountMinor: 0 }]);
    expect(moneyBagEquals(sum, emptyMoneyBag())).toBe(false);
  });

  test('empty bag is the identity element of bag addition', () => {
    const bag = moneyBag([{ currency: 'USD', amountMinor: 100 }]);
    expect(moneyBagEquals(addMoneyBags(bag, emptyMoneyBag()), bag)).toBe(true);
    expect(moneyBagEquals(addMoneyBags(emptyMoneyBag(), emptyMoneyBag()), emptyMoneyBag())).toBe(
      true,
    );
  });

  test('results that leave the safe-integer range are rejected', () => {
    const maxBag = moneyBag([{ currency: 'USD', amountMinor: Number.MAX_SAFE_INTEGER }]);
    const oneBag = moneyBag([{ currency: 'USD', amountMinor: 1 }]);
    expect(() => addMoneyBags(maxBag, oneBag)).toThrow(/safe integer/);
  });

  test('equality is set equality over (currency, amount) entries', () => {
    const a = moneyBag([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'EUR', amountMinor: 200 },
    ]);
    const b = moneyBag([
      { currency: 'EUR', amountMinor: 200 },
      { currency: 'USD', amountMinor: 100 },
    ]);
    const c = moneyBag([{ currency: 'USD', amountMinor: 101 }]);
    expect(moneyBagEquals(a, b)).toBe(true);
    expect(moneyBagEquals(a, c)).toBe(false);
    expect(moneyBagEquals(a, emptyMoneyBag())).toBe(false);
  });
});
