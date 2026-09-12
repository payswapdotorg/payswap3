/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK WAITING AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock waiting authority: the waiting port
 * (src/lib/protocol/waiting-port.ts) is now backed by the RUNTIME
 * ADAPTER over the composed A08 Queue Authority with A06/A07 reads
 * (src/lib/protocol/runtime-waiting-adapter.ts — re-checks submit
 * queues.eligibility.evaluate and cancels submit queues.item.cancel
 * through the protocol gateway). This module is no longer a port backing
 * and implements NO authority semantics and holds NO sandbox snapshots.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only verification surface frozen by UI-006
 * (src/components/verification/waiting-flow-harness.tsx) imports this
 * module's scripting API BY PATH, and the work order forbids changing
 * product surfaces. The retained exports are the harness's script
 * records and request-log shapes: scriptWaitingOutcome now records the
 * harness's selected demonstration phase WITHOUT any effect on the port
 * (waiting snapshots are the A08 authority's own reports and cannot be
 * scripted), and the request log records what the harness observed —
 * post-retirement the live requests route through the runtime adapter,
 * so the log stays empty unless the harness itself replays results.
 */

import type { WaitingRecoveryActionId, WaitingViewerRole } from './waiting-port';

export const MOCK_WAITING_AUTHORITY_OWNER =
  'Fulfillment/Queue Authority (spec/architecture/v0.1, liquidity-credit-queues.md) — re-anchored by UI-011 to the composed A08 Queue Authority' as const;

export const MOCK_WAITING_RUNTIME = 'LIVE' as const;

/** The honest boundary note wherever waiting data is presented. */
export const MOCK_WAITING_NON_AUTHORITATIVE_NOTE =
  'Runtime-backed (UI-011): waiting snapshots are the A08 Queue Authority\u2019s own records over the composed protocol ' +
  'runtime; re-checks and cancels submit through the protocol gateway (queues.eligibility.evaluate / queues.item.cancel). ' +
  'The mock backing is retired; no sandbox snapshots exist. Where the runtime exposes no command surface (retry/escalate), ' +
  'the adapter denies with the recorded gap — never fabricated.';

/** The fulfillment phases the harness's selector names (script records only). */
export type WaitingScriptOutcome =
  | 'queued-liquidity-credit'
  | 'queued-provider-availability'
  | 'waiting-settlement-confirmation'
  | 'delayed-liquidity-window'
  | 'delayed-provider-backoff'
  | 'unknown-pending-reconciliation'
  | 'unknown-after-wait-timeout'
  | 'resolved-completed'
  | 'resolved-failed'
  | 'resolved-still-unknown'
  | 'queued-minimum-wait-window';

/** Summary of the reference catalog, for the verification harness. */
export interface MockWaitingReferenceSummary {
  readonly referenceId: string;
  readonly scenarioKey: WaitingScriptOutcome;
  readonly intentSummary: string;
  readonly allowedViewerRoles: readonly WaitingViewerRole[];
}

/**
 * The verification-harness reference catalog (the legacy sandbox ids,
 * honestly labeled): post-UI-011 the lookups resolve against the composed
 * runtime, which records the queue-item ids / intent ids it actually
 * holds — a fresh runtime reports no record for these legacy ids
 * (not-found, the honest answer through the frozen vocabulary).
 */
export const MOCK_WAITING_REFERENCES: readonly MockWaitingReferenceSummary[] = [
  {
    referenceId: 'TRK-4410-QUEUED-LIQ',
    scenarioKey: 'queued-liquidity-credit',
    intentSummary: 'Payout waiting on the queue\u2019s liquidity/credit release conditions (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4411-QUEUED-PROV',
    scenarioKey: 'queued-provider-availability',
    intentSummary: 'Capability fulfillment waiting for an available provider (legacy sandbox id)',
    allowedViewerRoles: ['merchant', 'provider', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4412-WAITING-CONFIRM',
    scenarioKey: 'waiting-settlement-confirmation',
    intentSummary: 'Payout awaiting settlement confirmation (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4413-DELAYED-LIQ-WINDOW',
    scenarioKey: 'delayed-liquidity-window',
    intentSummary: 'Payout delayed past its liquidity window (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4414-DELAYED-PROV-BACKOFF',
    scenarioKey: 'delayed-provider-backoff',
    intentSummary: 'Capability fulfillment in provider retry backoff (legacy sandbox id)',
    allowedViewerRoles: ['merchant', 'provider', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4415-UNKNOWN-RECON',
    scenarioKey: 'unknown-pending-reconciliation',
    intentSummary: 'Payout whose queue position is being reconciled (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4416-UNKNOWN-TIMEOUT',
    scenarioKey: 'unknown-after-wait-timeout',
    intentSummary: 'Fulfillment whose wait closed without an authority report (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4417-RESOLVED-COMPLETED',
    scenarioKey: 'resolved-completed',
    intentSummary: 'Fulfillment graduated by the downstream operation (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4418-RESOLVED-FAILED',
    scenarioKey: 'resolved-failed',
    intentSummary: 'Fulfillment cancelled by confirmed failure (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4419-RESOLVED-STILL-UNKNOWN',
    scenarioKey: 'resolved-still-unknown',
    intentSummary: 'Fulfillment still unknown after reconciliation (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
  {
    referenceId: 'TRK-4420-NO-ACTION',
    scenarioKey: 'queued-minimum-wait-window',
    intentSummary: 'Queued with no action available yet (legacy sandbox id)',
    allowedViewerRoles: ['customer', 'merchant', 'operator', 'administrator'],
  },
] as const;

export interface MockWaitingRequestLogEntry {
  readonly index: number;
  readonly kind: 'recovery' | 'inquiry';
  readonly referenceId: string;
  readonly actionId?: WaitingRecoveryActionId;
  readonly requestedByRole: WaitingViewerRole;
  readonly result: 'accepted' | 'denied' | 'rejected';
  readonly reason?: string;
}

const scriptRecords = new Map<string, WaitingScriptOutcome>();
const requestLog: MockWaitingRequestLogEntry[] = [];
let logCounter = 0;

/**
 * Record the harness's selected demonstration phase. RETIRED as an
 * authority input: the runtime adapter never reads it — waiting snapshots
 * are the A08 Queue Authority's own reports over the composed runtime.
 */
export function scriptWaitingOutcome(
  referenceId: string,
  outcome: WaitingScriptOutcome,
): void {
  scriptRecords.set(referenceId, outcome);
}

/** Clear all script records and the request log (verification harness reset). */
export function clearWaitingScriptting(): void {
  scriptRecords.clear();
  requestLog.length = 0;
}

/** Readonly copy of the request log (the harness's own observed requests). */
export function getMockWaitingRequestLog(): readonly MockWaitingRequestLogEntry[] {
  return [...requestLog];
}

/** VERIFICATION ONLY: append an observed request result to the log. */
export function recordMockWaitingRequest(entry: Omit<MockWaitingRequestLogEntry, 'index'>): void {
  logCounter += 1;
  requestLog.push({ index: logCounter, ...entry });
}
