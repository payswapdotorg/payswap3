/**
 * RTN-004 — Rails: the deterministic reconciliation matching rules (INV-14-4).
 *
 * Spec source (binding) — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §2 Area 14:
 *   line 156-159 (INV-14-4, determinism):
 *     "matching rules are pure functions of (protocol record set, external
 *      statement set, rule version); identical inputs produce identical case
 *      decisions."
 *   line 126 (MATCHED): "MATCHED: protocol expectation and external
 *    statement agree."
 *   line 133-137 (cycle): "periodic matching run over a window of protocol
 *    records and external statements ... Discrepancies become cases."
 *   line 168-170 (untrusted statements): "Reconciliation consumes external
 *    statements that may themselves be incomplete or delayed."
 *   line 186-187 (CYCLE_CLOSED evidence): "(window bounds, matched counts,
 *    open case count)."
 *
 * Method: ONE exported pure function, `matchReconciliationRecords`, whose
 * result depends ONLY on (operations, statements, ruleVersion). All
 * iteration orders are canonicalized (operations by operationId; statements
 * by (sourceId, sequence)) so input array ORDER never affects the outcome;
 * `stableStringify` gives a canonical transcript form for the determinism
 * proof. Rule version 1 is the only supported version — any other version
 * is rejected (fail-closed), so a stored rule version can never silently
 * re-decide old cases under different rules.
 */

import type { ExternalStatementRecord } from './types.ts';
import type { RailOperationRecord } from './types.ts';
import { isRailReportClass } from './types.ts';

/**
 * The one and only supported matching rule version. INV-14-4 makes the rule
 * version an INPUT of the matching function; this surface implements
 * exactly version 1 and fails closed on any other version.
 *
 * Source: rails-adapters-reconciliation.md lines 156-159.
 */
export const RAILS_MATCHING_RULE_VERSION = 1;

/**
 * A matched pair: the protocol record and the external statement agree
 * (same outcome class AND same integer amount+currency).
 *
 * Source: rails-adapters-reconciliation.md line 126 — "MATCHED: protocol
 * expectation and external statement agree."
 */
export interface MatchedPair {
  readonly operationId: string;
  readonly statementRef: string;
  readonly outcomeClass: string;
}

/**
 * A discrepancy between protocol truth and an external statement — each one
 * becomes a reconciliation case ("Discrepancies become cases", line 137).
 *
 * The kinds (rule version 1):
 *   OUTCOME_MISMATCH   — paired, but the asserted outcome class differs
 *                        from the operation's recorded status.
 *   AMOUNT_MISMATCH    — paired, same outcome, but the asserted amount
 *                        differs from the payload money (integer
 *                        comparison — GC-1).
 *   MISSING_STATEMENT  — a protocol operation in the window has no
 *                        statement ("statements ... may themselves be
 *                        incomplete", lines 168-169).
 *   UNMATCHED_STATEMENT — a statement claims an effect with no matching
 *                        protocol operation.
 *   MALFORMED_STATEMENT — a statement that fails structural validation;
 *                        untrusted input is never trusted (it becomes a
 *                        case to investigate, never an exception).
 *
 * Source: rails-adapters-reconciliation.md lines 126-141, 168-170.
 */
export interface MatchDiscrepancy {
  readonly kind:
    | 'OUTCOME_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'MISSING_STATEMENT'
    | 'UNMATCHED_STATEMENT'
    | 'MALFORMED_STATEMENT';
  readonly operationId?: string;
  readonly statementRef?: string;
  readonly detail: string;
}

/**
 * The matching outcome: matched pairs + discrepancies, each canonicalized
 * into a deterministic order.
 *
 * Source: rails-adapters-reconciliation.md lines 126-137, 156-159.
 */
export interface MatchOutcome {
  readonly matched: readonly MatchedPair[];
  readonly discrepancies: readonly MatchDiscrepancy[];
}

/**
 * Canonical JSON-ish serialization with RECURSIVELY SORTED keys — the
 * transcript form for the INV-14-4 determinism proof ("identical inputs
 * produce identical case decisions"): any two value-deep-equal inputs
 * serialize identically regardless of key insertion order.
 *
 * Source: rails-adapters-reconciliation.md lines 156-159; README.md §3 GC-1
 * lines 41-43 ("Re-running any computation on identical inputs yields
 * identical outputs").
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => stableStringify(element)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function isValidStatement(statement: ExternalStatementRecord): boolean {
  return (
    typeof statement.sourceId === 'string' &&
    statement.sourceId.length > 0 &&
    Number.isInteger(statement.sequence) &&
    statement.sequence > 0 &&
    typeof statement.railReference === 'string' &&
    statement.railReference.length > 0 &&
    isRailReportClass(statement.outcomeClass) &&
    Number.isSafeInteger(statement.amountMinor) &&
    typeof statement.currency === 'string' &&
    statement.currency.length === 3 &&
    Number.isSafeInteger(statement.assertedAtWallMs)
  );
}

/**
 * The deterministic pairing rule (rule version 1): a statement pairs with
 * the operation identified by, in priority order:
 *   1. statement.operationId (explicit protocol reference),
 *   2. statement.idempotencyKey (the deterministic rail key — INV-13-3),
 *   3. statement.railReference (a rail reference the operation recorded).
 *
 * Both sides are canonicalized first, so this priority applies over a total
 * order and is therefore a pure function of the input SETS.
 *
 * Agreement (rule version 1): the statement's outcome class EQUALS the
 * operation's recorded status, and the statement's integer
 * (amountMinor, currency) EQUALS the operation payload money. Anything
 * else is a discrepancy of the corresponding kind.
 *
 * Source: rails-adapters-reconciliation.md lines 126 ("protocol expectation
 * and external statement agree"), 133-137, 156-159 (INV-14-4);
 * README.md §3 GC-1 (integer comparison).
 */
export function matchReconciliationRecords(
  operations: readonly RailOperationRecord[],
  statements: readonly ExternalStatementRecord[],
  ruleVersion: number,
): MatchOutcome {
  if (ruleVersion !== RAILS_MATCHING_RULE_VERSION) {
    throw new TypeError(
      `matchReconciliationRecords: unsupported rule version ${ruleVersion} (supported: ${RAILS_MATCHING_RULE_VERSION}) — INV-14-4 fail-closed`,
    );
  }

  const sortedOperations = [...operations].sort((a, b) =>
    a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0,
  );
  const sortedStatements = [...statements].sort((a, b) => {
    if (a.sourceId !== b.sourceId) {
      return a.sourceId < b.sourceId ? -1 : 1;
    }
    return a.sequence - b.sequence;
  });

  const byOperationId = new Map<string, RailOperationRecord>();
  const byIdempotencyKey = new Map<string, RailOperationRecord>();
  const byRailReference = new Map<string, RailOperationRecord>();
  for (const operation of sortedOperations) {
    byOperationId.set(operation.operationId, operation);
    byIdempotencyKey.set(operation.idempotencyKey, operation);
    for (const reference of operation.railReferences) {
      if (!byRailReference.has(reference)) {
        byRailReference.set(reference, operation);
      }
    }
  }

  const matched: MatchedPair[] = [];
  const discrepancies: MatchDiscrepancy[] = [];
  const matchedOperationIds = new Set<string>();

  const pairOperation = (statement: ExternalStatementRecord): RailOperationRecord | undefined => {
    if (statement.operationId !== undefined) {
      return byOperationId.get(statement.operationId);
    }
    if (statement.idempotencyKey !== undefined) {
      return byIdempotencyKey.get(statement.idempotencyKey);
    }
    return byRailReference.get(statement.railReference);
  };

  const statementRef = (statement: ExternalStatementRecord): string =>
    `statement:${statement.sourceId}:${statement.sequence}`;

  for (const statement of sortedStatements) {
    if (!isValidStatement(statement)) {
      discrepancies.push({
        kind: 'MALFORMED_STATEMENT',
        statementRef: statementRef(statement),
        detail: 'statement failed structural validation (untrusted input — becomes a case, never an exception)',
      });
      continue;
    }
    const operation = pairOperation(statement);
    if (operation === undefined) {
      discrepancies.push({
        kind: 'UNMATCHED_STATEMENT',
        statementRef: statementRef(statement),
        detail: `no protocol operation matches statement reference ${statement.railReference}`,
      });
      continue;
    }
    if (matchedOperationIds.has(operation.operationId)) {
      discrepancies.push({
        kind: 'UNMATCHED_STATEMENT',
        statementRef: statementRef(statement),
        detail: `duplicate statement for operation ${operation.operationId}`,
      });
      continue;
    }
    matchedOperationIds.add(operation.operationId);
    if (statement.outcomeClass !== operation.status) {
      discrepancies.push({
        kind: 'OUTCOME_MISMATCH',
        operationId: operation.operationId,
        statementRef: statementRef(statement),
        detail: `protocol expects ${operation.status}, statement asserts ${statement.outcomeClass}`,
      });
      continue;
    }
    if (
      statement.amountMinor !== operation.payload.money.amountMinor ||
      statement.currency !== operation.payload.money.currency
    ) {
      discrepancies.push({
        kind: 'AMOUNT_MISMATCH',
        operationId: operation.operationId,
        statementRef: statementRef(statement),
        detail: `protocol payload is ${operation.payload.money.amountMinor} ${operation.payload.money.currency}, statement asserts ${statement.amountMinor} ${statement.currency}`,
      });
      continue;
    }
    matched.push({
      operationId: operation.operationId,
      statementRef: statementRef(statement),
      outcomeClass: statement.outcomeClass,
    });
  }

  for (const operation of sortedOperations) {
    if (!matchedOperationIds.has(operation.operationId)) {
      discrepancies.push({
        kind: 'MISSING_STATEMENT',
        operationId: operation.operationId,
        detail: `no external statement for operation ${operation.operationId} (statements may be incomplete or delayed)`,
      });
    }
  }

  return { matched, discrepancies };
}
