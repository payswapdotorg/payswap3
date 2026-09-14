/**
 * PC-001 — DTO contract tests: the frozen six-status vocabulary, rejection
 * of invented states, alignment with the product state-display contract,
 * and the transport-failure-is-not-business-failure rule.
 */

import { describe, expect, test } from 'bun:test';
import { DISPLAY_STATES } from '@/components/state';
import {
  CONSOLE_STATUSES,
  consoleTransportFailure,
  consoleUnavailable,
  consoleValue,
  isConsoleStatus,
  parseConsoleStatus,
  presentationStatus,
} from './dto';
import type { ConsoleAuthorityMetadata, ConsoleReadResult } from './types';

const AUTHORITY: ConsoleAuthorityMetadata = {
  view: 'PC-001 contract test',
  protocolObject: 'intent state (A01 vocabulary)',
  owningAuthority: 'Intent Authority (src/lib/protocol/intent-port.ts getIntentPort)',
  runtimeBoundary: 'runtime intent adapter (src/lib/protocol/runtime-intent-adapter.ts)',
  durableSource: 'durable substrate (src/lib/durable/db.ts)',
  unknownSemantics: 'no-answer → UNKNOWN with reconciliation path',
  evidenceReference: 'spec/product/intent-mapping-records.md',
};

describe('PC-001 console DTO — frozen status vocabulary', () => {
  test('the status union is EXACTLY the six design statuses', () => {
    expect([...CONSOLE_STATUSES]).toEqual([
      'UNKNOWN',
      'WAITING',
      'IN_PROGRESS',
      'FAILED',
      'SUCCEEDED',
      'ACTION_REQUIRED',
    ]);
  });

  test('aligned one-for-one with the existing product state-display contract (DISPLAY_STATES)', () => {
    // The product contract is the authority for state display; the console
    // vocabulary must be the SAME set — no more, no fewer.
    expect(new Set(CONSOLE_STATUSES)).toEqual(new Set(DISPLAY_STATES));
    expect(CONSOLE_STATUSES.length).toBe(DISPLAY_STATES.length);
    for (const status of DISPLAY_STATES) {
      expect(isConsoleStatus(status)).toBe(true);
    }
  });

  test('parseConsoleStatus accepts each frozen member', () => {
    for (const status of CONSOLE_STATUSES) {
      expect(parseConsoleStatus(status)).toBe(status);
    }
  });

  test('parseConsoleStatus rejects invented states — never coerced, never defaulted', () => {
    const invented: unknown[] = [
      'PENDING',
      'pending',
      'COMPLETED',
      'SUCCESS',
      'success',
      'ERROR',
      'FAILED_FINAL',
      'ACTION_REQUIRED ',
      ' ACTION_REQUIRED',
      'IN-PROGRESS',
      'unknown',
      '',
      null,
      undefined,
      0,
      42,
      true,
      {},
      ['UNKNOWN'],
      'UNKNOWN;WAITING',
    ];
    for (const value of invented) {
      expect(parseConsoleStatus(value)).toBe(null);
    }
    expect(isConsoleStatus('PENDING')).toBe(false);
  });
});

describe('PC-001 console DTO — read-result envelope', () => {
  test('the value branch carries the authority-reported business status', () => {
    const result = consoleValue({ intentId: 'ps_test' }, 'SUCCEEDED', AUTHORITY);
    expect(result.outcome).toBe('value');
    if (result.outcome === 'value') {
      expect(result.status).toBe('SUCCEEDED');
      expect(result.value).toEqual({ intentId: 'ps_test' });
    }
    expect(result.authority).toBe(AUTHORITY);
  });

  test('consoleValue rejects an invented status (defensive throw, nothing ships)', () => {
    expect(() =>
      consoleValue({}, 'PENDING' as never, AUTHORITY),
    ).toThrow('invented console status');
  });

  test('the unavailable branch is structurally UNKNOWN — it has no ConsoleStatus field', () => {
    const result: ConsoleReadResult<string> = consoleUnavailable(AUTHORITY, 'authority unreachable');
    expect(result.outcome).toBe('unavailable');
    if (result.outcome === 'unavailable') {
      // Literal type: the only possible presentation status is UNKNOWN.
      const presentation: 'UNKNOWN' = result.presentationStatus;
      expect(presentation).toBe('UNKNOWN');
      // The unavailable branch carries NO business-status field at all.
      expect(Object.keys(result)).not.toContain('status');
    }
  });

  test('a transport/fetch failure is NOT a business failure — the DTO stays UNKNOWN', () => {
    const failure = consoleTransportFailure(AUTHORITY, 'fetch failed: connection refused');
    expect(failure.outcome).toBe('unavailable');
    expect(presentationStatus(failure)).toBe('UNKNOWN');
    // Mechanically never a business verdict:
    expect(presentationStatus(failure)).not.toBe('FAILED');
    expect(presentationStatus(failure)).not.toBe('SUCCEEDED');
    if (failure.outcome === 'unavailable') {
      expect(failure.note).toContain('transport/infrastructure failure');
      expect(failure.note).toContain('UNKNOWN');
    }
  });

  test('every unavailable result presents UNKNOWN — scanned mechanically over the branch type', () => {
    const unavailableResults: ConsoleReadResult<unknown>[] = [
      consoleUnavailable(AUTHORITY, 'a'),
      consoleTransportFailure(AUTHORITY, 'b'),
      consoleTransportFailure(AUTHORITY, 'c'),
    ];
    for (const result of unavailableResults) {
      expect(presentationStatus(result)).toBe('UNKNOWN');
    }
  });

  test('presentationStatus resolves every envelope to exactly one of the six statuses', () => {
    const cases: ConsoleReadResult<unknown>[] = [
      consoleValue('x', 'WAITING', AUTHORITY),
      consoleValue('x', 'IN_PROGRESS', AUTHORITY),
      consoleValue('x', 'ACTION_REQUIRED', AUTHORITY),
      consoleUnavailable(AUTHORITY, 'no answer'),
    ];
    for (const result of cases) {
      expect(isConsoleStatus(presentationStatus(result))).toBe(true);
    }
  });

  test('authority metadata carries every nine-question-discipline field, non-empty', () => {
    const keys: (keyof ConsoleAuthorityMetadata)[] = [
      'view',
      'protocolObject',
      'owningAuthority',
      'runtimeBoundary',
      'durableSource',
      'unknownSemantics',
      'evidenceReference',
    ];
    for (const key of keys) {
      expect(typeof AUTHORITY[key]).toBe('string');
      expect((AUTHORITY[key] as string).length).toBeGreaterThan(0);
    }
  });
});
