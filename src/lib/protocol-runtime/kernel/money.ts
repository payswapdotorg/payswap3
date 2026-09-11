/**
 * RTN-001 — Protocol runtime kernel: Money and MoneyBag.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/core.md §0 "Shared conventions (recap)", lines 11-14:
 *     "Money: signed integer minor units, 3-letter currency code, explicit
 *      decimal scale per currency. No floating point anywhere (GC-1)."
 *     "MoneyBag: set of (currency, integer amount) entries; addition and
 *      subtraction are entrywise and deterministic."
 *   spec/architecture/v0.1/README.md §3 GC-1, lines 39-43:
 *     "All monetary values are signed integers in minor units with an explicit
 *      currency code and scale. No floating point. Rate application uses
 *      integer multiplication and deterministic rounding. Re-running any
 *      computation on identical inputs yields identical outputs."
 *
 * Money is integer-only by construction:
 *   - the ONLY public constructor is `money()`, which rejects any amount that
 *     is not a safe integer at runtime (Number.isInteger + Number.isSafeInteger
 *     guards), and rejects any currency that is not exactly 3 uppercase
 *     letters (ISO-4217 alphabetic shape);
 *   - the branded field types (`MinorUnits`, `CurrencyCode`, `DecimalScale`)
 *     make a forged Money object literal with a float amount unrepresentable
 *     at the type level — the brands are unconstructible outside this module;
 *   - arithmetic (`addMoney`, `subtractMoney`) accepts only Money values of
 *     the SAME currency AND the same per-currency decimal scale, and guards
 *     the result against leaving the safe-integer range; no floating-point
 *     operation appears anywhere in the value path.
 *
 * Determinism (GC-1, "Re-running any computation on identical inputs yields
 * identical outputs"): every function below is a pure function of its
 * arguments; identical inputs always yield structurally identical outputs.
 *
 * Scope discipline: §0 defines representation plus addition/subtraction
 * semantics for Money and entrywise addition/subtraction for MoneyBag. It
 * does NOT define allocation/splitting, rate application, or rounding —
 * those are NOT implemented here (rate application belongs to the areas that
 * own conversions, e.g. area 4 "explicit, recorded conversion amounts").
 *
 * Deviation note (work order "adapt to what §0 actually requires and say so"):
 * Money and MoneyBag live in one module because core.md §0 defines them as
 * one adjacent pair of shared conventions (lines 11-14).
 */

/**
 * Signed integer amount in minor units of the currency.
 * Branded so a float cannot be assigned without an explicit cast; only
 * `money()` can mint this type (after the integer guards).
 *
 * Source: core.md §0 line 11 — "signed integer minor units";
 * README.md §3 GC-1 line 40 — "signed integers in minor units".
 */
export type MinorUnits = number & { readonly __kernelMinorUnits: 'integer-minor-units' };

/**
 * 3-letter currency code (ISO-4217 alphabetic shape: exactly 3 uppercase
 * letters). Branded; only `money()` / `moneyBag()` mint it after validation.
 *
 * Source: core.md §0 lines 11-12 — "3-letter currency code".
 */
export type CurrencyCode = string & { readonly __kernelCurrencyCode: 'three-letter-currency' };

/**
 * Explicit decimal scale (number of decimal minor positions) for one
 * currency. Non-negative integer. Branded; only `money()` mints it.
 *
 * Source: core.md §0 lines 11-12 — "explicit decimal scale per currency".
 */
export type DecimalScale = number & { readonly __kernelDecimalScale: 'non-negative-integer-scale' };

/**
 * Money — signed integer minor units + currency code + explicit per-currency
 * decimal scale. Immutable value object.
 *
 * Source: core.md §0 lines 11-12 (quoted in the module doc above).
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly scale: DecimalScale;
  readonly amountMinor: MinorUnits;
}

/**
 * One MoneyBag entry: (currency, integer amount). Note the bag entry carries
 * no scale — §0 line 13 defines bag entries as "(currency, integer amount)"
 * exactly; the per-currency decimal scale is a property of Money.
 *
 * Source: core.md §0 lines 13-14 — "set of (currency, integer amount) entries".
 */
export interface MoneyBagEntry {
  readonly currency: CurrencyCode;
  readonly amountMinor: MinorUnits;
}

/**
 * MoneyBag — a set of (currency, integer amount) entries.
 *
 * Ordering rule (implementation convention, chosen for cross-run stability):
 * entries are stored in ascending currency-code order (code-point order over
 * the 3 uppercase letters — e.g. EUR < USD). This ordering is a serialization
 * convention only; §0 requires addition/subtraction to be "entrywise and
 * deterministic", and a fixed total order over the entry set makes every
 * derived representation (JSON, hashing, display) stable across runs.
 *
 * Zero-amount entries are retained, never silently pruned: {USD: 0} and the
 * empty bag are different entry sets under §0's literal "set of entries"
 * wording, and pruning would be an implicit semantic interpretation.
 *
 * Source: core.md §0 lines 13-14 — "MoneyBag: set of (currency, integer
 * amount) entries; addition and subtraction are entrywise and deterministic."
 */
export interface MoneyBag {
  readonly entries: readonly MoneyBagEntry[];
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function fail(message: string): never {
  throw new TypeError(message);
}

function assertCurrencyCode(currency: unknown): asserts currency is CurrencyCode {
  if (typeof currency !== 'string') {
    fail(`money: currency must be a string (got ${typeof currency})`);
  }
  if (!CURRENCY_CODE_PATTERN.test(currency)) {
    fail(`money: currency must be exactly 3 uppercase letters (got ${JSON.stringify(currency)})`);
  }
}

function assertIntegerAmount(amountMinor: unknown, label: string): asserts amountMinor is number {
  if (typeof amountMinor !== 'number') {
    fail(`money: ${label} must be a number (got ${typeof amountMinor})`);
  }
  if (!Number.isInteger(amountMinor)) {
    fail(`money: ${label} must be an integer — floating point is forbidden by GC-1 (got ${amountMinor})`);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    fail(`money: ${label} must be a safe integer (got ${amountMinor})`);
  }
}

function assertScale(scale: unknown): asserts scale is number {
  if (typeof scale !== 'number') {
    fail(`money: scale must be a number (got ${typeof scale})`);
  }
  if (!Number.isInteger(scale) || scale < 0) {
    fail(`money: scale must be a non-negative integer (got ${scale})`);
  }
  if (!Number.isSafeInteger(scale)) {
    fail(`money: scale must be a safe integer (got ${scale})`);
  }
}

/**
 * Construct a Money value. The single public mint for the branded types.
 *
 * Rejects (deterministically, via TypeError):
 *   - non-number amounts, floats (e.g. 1.5), NaN, ±Infinity;
 *   - amounts outside the Number.isSafeInteger range;
 *   - currency codes that are not exactly 3 uppercase letters;
 *   - scales that are not non-negative integers.
 *
 * Source: core.md §0 lines 11-12; README.md §3 GC-1 lines 39-43 ("No
 * floating point", "signed integers in minor units").
 */
export function money(currency: string, amountMinor: number, scale: number): Money {
  assertCurrencyCode(currency);
  assertIntegerAmount(amountMinor, 'amountMinor');
  assertScale(scale);
  return { currency, scale, amountMinor } as Money;
}

/**
 * Runtime type guard: true iff the value is a well-formed Money (structurally
 * complete AND passing every constructor guard).
 *
 * Source: core.md §0 lines 11-12 (the Money convention defines what
 * "well-formed" means here).
 */
export function isMoney(value: unknown): value is Money {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Money>;
  return (
    typeof candidate.currency === 'string' &&
    CURRENCY_CODE_PATTERN.test(candidate.currency) &&
    typeof candidate.scale === 'number' &&
    Number.isInteger(candidate.scale) &&
    candidate.scale >= 0 &&
    Number.isSafeInteger(candidate.scale) &&
    typeof candidate.amountMinor === 'number' &&
    Number.isInteger(candidate.amountMinor) &&
    Number.isSafeInteger(candidate.amountMinor)
  );
}

function assertSameUnit(a: Money, b: Money, operation: string): void {
  if (a.currency !== b.currency) {
    fail(`money: ${operation} requires the same currency (got ${a.currency} vs ${b.currency})`);
  }
  if (a.scale !== b.scale) {
    fail(
      `money: ${operation} requires the same decimal scale for ${a.currency} ` +
        `(got ${a.scale} vs ${b.scale}; the scale is explicit per currency)`,
    );
  }
}

function assertSafeResult(total: number, operation: string): void {
  if (!Number.isSafeInteger(total)) {
    fail(`money: ${operation} leaves the safe-integer range (got ${total})`);
  }
}

/**
 * Add two Money values of the SAME currency and decimal scale.
 * Deterministic pure function; result guarded against unsafe-integer overflow.
 *
 * Source: core.md §0 lines 11-14 (integer arithmetic, deterministic);
 * README.md §3 GC-1 lines 41-43.
 */
export function addMoney(a: Money, b: Money): Money {
  assertSameUnit(a, b, 'addition');
  const total = a.amountMinor + b.amountMinor;
  assertSafeResult(total, 'addition');
  return { currency: a.currency, scale: a.scale, amountMinor: total } as Money;
}

/**
 * Subtract one Money value from another of the SAME currency and decimal
 * scale (a minus b). Deterministic pure function; result guarded against
 * unsafe-integer underflow.
 *
 * Source: core.md §0 lines 11-14 (signed integer arithmetic, deterministic).
 */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameUnit(a, b, 'subtraction');
  const total = a.amountMinor - b.amountMinor;
  assertSafeResult(total, 'subtraction');
  return { currency: a.currency, scale: a.scale, amountMinor: total } as Money;
}

/**
 * Negate a Money value (sign flip; integer-only by construction).
 *
 * Canonical zero: JavaScript negation of 0 produces -0 (a distinct bit
 * pattern under Object.is); this function canonicalizes the result so a
 * negated zero is exactly 0 — signed zero must never leak into the value
 * path, or "re-running any computation on identical inputs yields identical
 * outputs" (GC-1, README.md §3 line 43) would fail under strict identity.
 *
 * Source: core.md §0 line 11 — "signed integer minor units" (signedness is
 * part of the Money convention); README.md §3 GC-1 lines 39-43.
 */
export function negateMoney(a: Money): Money {
  const negated = a.amountMinor === 0 ? 0 : -a.amountMinor;
  return { currency: a.currency, scale: a.scale, amountMinor: negated } as Money;
}

/**
 * Three-way comparison of two Money values of the SAME currency and scale:
 * -1 (a < b), 0 (a = b), 1 (a > b). Integer comparison only.
 *
 * Source: core.md §0 lines 11-12 + INV-2-1 (core.md §2, lines 115-117):
 * "policy comparisons are integer comparisons".
 */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameUnit(a, b, 'comparison');
  if (a.amountMinor < b.amountMinor) {
    return -1;
  }
  if (a.amountMinor > b.amountMinor) {
    return 1;
  }
  return 0;
}

/**
 * Equality of two Money values: same currency, same scale, same amount.
 *
 * Source: core.md §0 lines 11-12 (the full Money representation participates
 * in identity).
 */
export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;
}

/**
 * True iff the amount is exactly zero.
 *
 * Source: core.md §0 line 11 (signed integers include zero; "no floating
 * point" makes zero-testing an exact integer comparison).
 */
export function isZeroMoney(a: Money): boolean {
  return a.amountMinor === 0;
}

/**
 * Construct a MoneyBag from raw entries. Each entry is validated exactly like
 * a Money amount (integer minor units, 3-letter currency). Duplicate
 * currencies in the input are rejected — a bag is a SET of entries, so one
 * entry per currency is the only unambiguous input. The stored order is
 * ascending currency code (see the MoneyBag interface doc).
 *
 * Source: core.md §0 lines 13-14 — "set of (currency, integer amount)
 * entries; addition and subtraction are entrywise and deterministic."
 */
export function moneyBag(entries: ReadonlyArray<{ currency: string; amountMinor: number }>): MoneyBag {
  if (!Array.isArray(entries)) {
    fail(`moneyBag: entries must be an array (got ${typeof entries})`);
  }
  const byCurrency = new Map<string, MinorUnits>();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      fail(`moneyBag: each entry must be an object (got ${typeof entry})`);
    }
    const { currency, amountMinor } = entry as { currency: unknown; amountMinor: unknown };
    assertCurrencyCode(currency);
    assertIntegerAmount(amountMinor, 'bag entry amountMinor');
    if (byCurrency.has(currency)) {
      fail(`moneyBag: duplicate currency entry for ${currency} (a bag holds one entry per currency)`);
    }
    byCurrency.set(currency, amountMinor as MinorUnits);
  }
  return { entries: orderEntries(byCurrency) };
}

/**
 * The empty MoneyBag (the identity element of bag addition).
 *
 * Source: core.md §0 lines 13-14 (entrywise addition over the empty set).
 */
export function emptyMoneyBag(): MoneyBag {
  return { entries: [] };
}

/**
 * Bridge a Money value into a single-entry MoneyBag. The §0 conventions
 * define Money's amount as integer minor units of a currency and MoneyBag
 * entries as (currency, integer amount) — the bridge drops only the scale,
 * which is a per-currency property of Money construction, not part of the
 * bag-entry shape.
 *
 * Source: core.md §0 lines 11-14.
 */
export function moneyBagFromMoney(value: Money): MoneyBag {
  return { entries: [{ currency: value.currency, amountMinor: value.amountMinor }] };
}

function orderEntries(byCurrency: Map<string, MinorUnits>): readonly MoneyBagEntry[] {
  const currencies = [...byCurrency.keys()].sort();
  return currencies.map((currency) => ({
    currency: currency as CurrencyCode,
    amountMinor: byCurrency.get(currency) as MinorUnits,
  }));
}

function mergeBags(
  a: MoneyBag,
  b: MoneyBag,
  combine: (x: number, y: number) => number,
  operation: string,
): MoneyBag {
  const byCurrency = new Map<string, MinorUnits>();
  for (const entry of a.entries) {
    byCurrency.set(entry.currency, entry.amountMinor);
  }
  for (const entry of b.entries) {
    const existing = byCurrency.get(entry.currency) ?? (0 as MinorUnits);
    const combined = combine(existing, entry.amountMinor);
    assertIntegerAmount(combined, `${operation} result for ${entry.currency}`);
    byCurrency.set(entry.currency, combined as MinorUnits);
  }
  return { entries: orderEntries(byCurrency) };
}

/**
 * Entrywise addition of two MoneyBags: the result's entry set is the union of
 * both currencies, each amount being the integer sum of that currency's
 * amounts in the operands. Deterministic pure function; entries stay in
 * ascending currency order; zero entries are retained, never pruned.
 *
 * Source: core.md §0 lines 13-14 — "addition and subtraction are entrywise
 * and deterministic."
 */
export function addMoneyBags(a: MoneyBag, b: MoneyBag): MoneyBag {
  return mergeBags(a, b, (x, y) => x + y, 'bag addition');
}

/**
 * Entrywise subtraction of two MoneyBags (a minus b): the result's entry set
 * is the union of both currencies, each amount being the integer difference
 * of that currency's amounts (a minus b; currencies present only in b count
 * as 0 in a). Deterministic pure function; ascending currency order; zero
 * entries retained.
 *
 * Source: core.md §0 lines 13-14 — "addition and subtraction are entrywise
 * and deterministic."
 */
export function subtractMoneyBags(a: MoneyBag, b: MoneyBag): MoneyBag {
  return mergeBags(a, b, (x, y) => x - y, 'bag subtraction');
}

/**
 * Equality of two MoneyBags: same set of (currency, amount) entries. Because
 * both bags carry the canonical ascending-currency ordering, equality is an
 * elementwise comparison — deterministic.
 *
 * Source: core.md §0 lines 13-14 ("set of (currency, integer amount) entries").
 */
export function moneyBagEquals(a: MoneyBag, b: MoneyBag): boolean {
  if (a.entries.length !== b.entries.length) {
    return false;
  }
  for (let index = 0; index < a.entries.length; index += 1) {
    const left = a.entries[index] as MoneyBagEntry;
    const right = b.entries[index] as MoneyBagEntry;
    if (left.currency !== right.currency || left.amountMinor !== right.amountMinor) {
      return false;
    }
  }
  return true;
}
