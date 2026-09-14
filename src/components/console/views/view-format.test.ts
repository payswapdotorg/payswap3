/**
 * PC-004 — View formatting determinism tests.
 *
 * The formatters are the ONLY place console views format authority-quoted
 * figures: deterministic string operations only (no locale, no timezone
 * parsing) so server and client render identical strings — proven by fixed
 * expectations.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatConsoleQuotedAmount,
  formatConsoleMinorUnitsMoney,
  formatConsoleIsoTimestamp,
  formatConsoleEpochMs,
} from './view-format';

describe('PC-004 view formatters — deterministic presentation of authority-quoted figures', () => {
  test('a quoted decimal amount joins verbatim with its currency code', () => {
    expect(formatConsoleQuotedAmount('25.00', 'USD')).toBe('25.00 USD');
    expect(formatConsoleQuotedAmount('0.01', 'USD')).toBe('0.01 USD');
  });

  test('minor-unit money renders with grouping, sign, and explicit currency', () => {
    expect(formatConsoleMinorUnitsMoney({ amountMinorUnits: 2500, currency: 'USD' })).toBe('25.00 USD');
    expect(formatConsoleMinorUnitsMoney({ amountMinorUnits: 123456789, currency: 'USD' })).toBe(
      '1,234,567.89 USD',
    );
    expect(formatConsoleMinorUnitsMoney({ amountMinorUnits: -5, currency: 'USD' })).toBe('-0.05 USD');
    expect(formatConsoleMinorUnitsMoney({ amountMinorUnits: 0, currency: 'EUR' })).toBe('0.00 EUR');
  });

  test('ISO timestamps slice deterministically (no Date parsing, no locale)', () => {
    expect(formatConsoleIsoTimestamp('2026-09-15T10:03:00.000Z')).toBe('2026-09-15 10:03 UTC');
    expect(formatConsoleIsoTimestamp('2026-09-15')).toBe('2026-09-15');
  });

  test('epoch milliseconds project to the same UTC slice rule', () => {
    expect(formatConsoleEpochMs(Date.UTC(2026, 8, 15, 10, 3, 0))).toBe('2026-09-15 10:03 UTC');
  });
});
