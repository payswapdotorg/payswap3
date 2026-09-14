/**
 * PC-004 — Deterministic presentation formatters for console views.
 *
 * Presentation-only: every function takes a figure the owning authority
 * already quoted (via a PC-003 read-model DTO) and renders it as a display
 * string. No totals are computed, no amounts are re-derived, no locale or
 * timezone is consulted — server and client would render identical strings,
 * following the established money/timestamp pattern of the product checkout
 * surface (deterministic string operations only).
 *
 * These helpers exist so console views never format authority figures
 * ad hoc: one place, one rule per shape.
 */

/** Authority-quoted decimal string + currency code, joined verbatim. */
export function formatConsoleQuotedAmount(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

/**
 * Authority-quoted money in integer minor units (e.g. cents) with the
 * currency code explicit. Sign/grouping only — no arithmetic beyond integer
 * display grouping, mirroring the product checkout surface's own pattern.
 */
export function formatConsoleMinorUnitsMoney(money: {
  readonly amountMinorUnits: number;
  readonly currency: string;
}): string {
  const sign = money.amountMinorUnits < 0 ? '-' : '';
  const absoluteMinor = Math.abs(Math.trunc(money.amountMinorUnits));
  const majorDigits = String(Math.floor(absoluteMinor / 100));
  const minorDigits = String(absoluteMinor % 100).padStart(2, '0');
  const groupedMajor = majorDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${groupedMajor}.${minorDigits} ${money.currency}`;
}

/**
 * Authority-quoted ISO-8601 timestamp, sliced directly (no Date parsing) so
 * the display is deterministic and never re-derives time truth.
 */
export function formatConsoleIsoTimestamp(iso: string): string {
  const [date, time = ''] = iso.split('T');
  const hhmm = time.slice(0, 5);
  return hhmm ? `${date} ${hhmm} UTC` : date;
}

/**
 * Authority-quoted epoch milliseconds, projected to the ISO-8601 UTC string
 * then sliced with the same rule (deterministic across runtimes — toISOString
 * is always UTC, never locale-dependent).
 */
export function formatConsoleEpochMs(epochMs: number): string {
  return formatConsoleIsoTimestamp(new Date(epochMs).toISOString());
}
