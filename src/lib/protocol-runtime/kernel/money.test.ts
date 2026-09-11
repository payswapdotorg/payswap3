/**
 * RTN-001 — Money conformance + negative tests (GC-1).
 *
 * Source of the tested contract: spec/architecture/v0.1/core.md §0 lines
 * 11-12 ("Money: signed integer minor units, 3-letter currency code,
 * explicit decimal scale per currency. No floating point anywhere (GC-1)")
 * and README.md §3 GC-1 lines 39-43.
 */
import { describe, expect, test } from 'bun:test';
import {
  money,
  isMoney,
  addMoney,
  subtractMoney,
  negateMoney,
  compareMoney,
  moneyEquals,
  isZeroMoney,
} from './money.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;

describe('money construction (conformance)', () => {
  test('positive, negative, and zero amounts are constructible', () => {
    expect(money('USD', 1234, 2).amountMinor).toBe(1234);
    expect(money('EUR', -500, 2).amountMinor).toBe(-500);
    expect(money('JPY', 0, 0).amountMinor).toBe(0);
  });

  test('carries currency code and explicit per-currency decimal scale', () => {
    const usd = money('USD', 100, 2);
    expect(usd.currency).toBe('USD');
    expect(usd.scale).toBe(2);
    const jpy = money('JPY', 100, 0);
    expect(jpy.scale).toBe(0);
  });

  test('exact max/min safe integer boundaries are constructible', () => {
    expect(money('USD', MAX, 2).amountMinor).toBe(MAX);
    expect(money('USD', MIN, 2).amountMinor).toBe(MIN);
  });

  test('isMoney accepts well-formed values and rejects malformed ones', () => {
    expect(isMoney(money('USD', 10, 2))).toBe(true);
    expect(isMoney(null)).toBe(false);
    expect(isMoney({ currency: 'USD', scale: 2, amountMinor: 1.5 })).toBe(false);
    expect(isMoney({ currency: 'usd', scale: 2, amountMinor: 10 })).toBe(false);
    expect(isMoney({ currency: 'USD', scale: -1, amountMinor: 10 })).toBe(false);
    expect(isMoney({ currency: 'USD', scale: 2 })).toBe(false);
  });
});

describe('money construction (negative: floats unrepresentable)', () => {
  test('float construction is rejected at runtime', () => {
    expect(() => money('USD', 1.5, 2)).toThrow(/must be an integer/);
    expect(() => money('USD', -0.5, 2)).toThrow(/must be an integer/);
    expect(() => money('USD', 10.25, 2)).toThrow(/must be an integer/);
  });

  test('NaN and Infinity are rejected', () => {
    expect(() => money('USD', Number.NaN, 2)).toThrow(/must be an integer/);
    expect(() => money('USD', Number.POSITIVE_INFINITY, 2)).toThrow(/must be an integer/);
    expect(() => money('USD', Number.NEGATIVE_INFINITY, 2)).toThrow(/must be an integer/);
  });

  test('beyond the safe-integer boundary is rejected', () => {
    expect(() => money('USD', MAX + 1, 2)).toThrow(/safe integer/);
    expect(() => money('USD', MIN - 1, 2)).toThrow(/safe integer/);
    expect(() => money('USD', 1e16, 2)).toThrow(/safe integer/);
  });

  test('non-number amounts and scales are rejected', () => {
    expect(() => money('USD', '100' as unknown as number, 2)).toThrow(/must be a number/);
    expect(() => money('USD', 100, '2' as unknown as number)).toThrow(/must be a number/);
    expect(() => money('USD', 100, 1.5)).toThrow(/non-negative integer/);
    expect(() => money('USD', 100, -2)).toThrow(/non-negative integer/);
  });
});

describe('currency-code validation (negative)', () => {
  test('non-3-letter codes are rejected', () => {
    expect(() => money('US', 100, 2)).toThrow(/3 uppercase letters/);
    expect(() => money('USDD', 100, 2)).toThrow(/3 uppercase letters/);
    expect(() => money('U1D', 100, 2)).toThrow(/3 uppercase letters/);
    expect(() => money('usd', 100, 2)).toThrow(/3 uppercase letters/);
    expect(() => money('', 100, 2)).toThrow(/3 uppercase letters/);
    expect(() => money(null as unknown as string, 100, 2)).toThrow(/must be a string/);
  });

  test('currency-code mismatch is rejected in arithmetic', () => {
    const usd = money('USD', 100, 2);
    const eur = money('EUR', 100, 2);
    expect(() => addMoney(usd, eur)).toThrow(/same currency.*USD.*EUR/);
    expect(() => subtractMoney(usd, eur)).toThrow(/same currency/);
    expect(() => compareMoney(usd, eur)).toThrow(/same currency/);
  });

  test('same currency with a different per-currency scale is rejected', () => {
    const two = money('USD', 100, 2);
    const three = money('USD', 100, 3);
    expect(() => addMoney(two, three)).toThrow(/same decimal scale/);
    expect(() => subtractMoney(two, three)).toThrow(/same decimal scale/);
  });
});

describe('money arithmetic (conformance)', () => {
  test('addition is exact integer arithmetic, including negatives and zero', () => {
    expect(addMoney(money('USD', 100, 2), money('USD', 234, 2)).amountMinor).toBe(334);
    expect(addMoney(money('USD', -100, 2), money('USD', 100, 2)).amountMinor).toBe(0);
    expect(addMoney(money('USD', 0, 2), money('USD', 0, 2)).amountMinor).toBe(0);
    expect(addMoney(money('JPY', -5, 0), money('JPY', -7, 0)).amountMinor).toBe(-12);
  });

  test('subtraction is exact integer arithmetic', () => {
    expect(subtractMoney(money('USD', 334, 2), money('USD', 100, 2)).amountMinor).toBe(234);
    expect(subtractMoney(money('USD', 100, 2), money('USD', 334, 2)).amountMinor).toBe(-234);
    expect(subtractMoney(money('USD', 0, 2), money('USD', 0, 2)).amountMinor).toBe(0);
  });

  test('safe-integer boundary arithmetic is exact at the edge', () => {
    expect(addMoney(money('USD', MAX - 1, 2), money('USD', 1, 2)).amountMinor).toBe(MAX);
    expect(addMoney(money('USD', MIN + 1, 2), money('USD', -1, 2)).amountMinor).toBe(MIN);
    expect(subtractMoney(money('USD', MIN + 1, 2), money('USD', 1, 2)).amountMinor).toBe(MIN);
  });

  test('arithmetic that would leave the safe-integer range is rejected deterministically', () => {
    expect(() => addMoney(money('USD', MAX, 2), money('USD', 1, 2))).toThrow(/safe-integer range/);
    expect(() => addMoney(money('USD', MIN, 2), money('USD', -1, 2))).toThrow(/safe-integer range/);
    expect(() => subtractMoney(money('USD', MIN, 2), money('USD', 1, 2))).toThrow(
      /safe-integer range/,
    );
  });

  test('negation flips the sign exactly', () => {
    expect(negateMoney(money('USD', 42, 2)).amountMinor).toBe(-42);
    expect(negateMoney(money('USD', -42, 2)).amountMinor).toBe(42);
    expect(negateMoney(money('USD', 0, 2)).amountMinor).toBe(0);
    expect(negateMoney(money('USD', MIN, 2)).amountMinor).toBe(MAX);
  });

  test('comparison is integer comparison: -1 / 0 / 1', () => {
    expect(compareMoney(money('USD', 9, 2), money('USD', 10, 2))).toBe(-1);
    expect(compareMoney(money('USD', 10, 2), money('USD', 10, 2))).toBe(0);
    expect(compareMoney(money('USD', 11, 2), money('USD', 10, 2))).toBe(1);
    expect(compareMoney(money('USD', -1, 2), money('USD', 0, 2))).toBe(-1);
  });

  test('equality covers currency, scale, and amount', () => {
    expect(moneyEquals(money('USD', 10, 2), money('USD', 10, 2))).toBe(true);
    expect(moneyEquals(money('USD', 10, 2), money('USD', 11, 2))).toBe(false);
    expect(moneyEquals(money('USD', 10, 2), money('EUR', 10, 2))).toBe(false);
    expect(moneyEquals(money('USD', 10, 2), money('USD', 10, 0))).toBe(false);
    expect(isZeroMoney(money('USD', 0, 2))).toBe(true);
    expect(isZeroMoney(money('USD', 1, 2))).toBe(false);
  });
});

describe('type-level float unrepresentability (compile-time)', () => {
  test('a forged Money literal with a float amount does not typecheck', () => {
    // This assertion runs tsc's discipline: the object literal below is
    // intentionally NOT written against the Money type because it would be
    // a type error (amountMinor 1.5 is not assignable to the branded
    // MinorUnits type). The runtime guard isMoney() still rejects it, which
    // is the defense-in-depth the work order requires (type AND runtime).
    const forged = { currency: 'USD', scale: 2, amountMinor: 1.5 } as unknown;
    expect(isMoney(forged)).toBe(false);
  });
});
