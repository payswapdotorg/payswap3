/**
 * Presentation-only money and time formatting for the pay flow (UI-002).
 *
 * Formatting is presentation (allowed); computing fees, totals, acceptance,
 * or any financial truth is not (N1). Totals shown anywhere come from the
 * port's consequence report — never from local arithmetic here.
 */

const MONEY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Presentation format for a decimal-string amount. Not a computation. */
export function formatMoney(amount: string, currency: 'USD' = 'USD'): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return `${amount} ${currency}`;
  return MONEY_FORMATTER.format(parsed);
}

/** Presentation format for an ISO timestamp (UTC, labeled). */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${TIME_FORMATTER.format(date)} UTC`;
}

/** Input-format check only — the port re-validates at the boundary. */
export function isValidAmountFormat(amount: string): boolean {
  return /^\d{1,9}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
}
