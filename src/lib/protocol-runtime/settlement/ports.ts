/**
 * RTN-009 — Settlement and Finality Authority: the composition ports.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12:
 *     lines 220-223 (Purpose: "Define how net obligations are executed
 *      externally through rail adapters, how results (including UNKNOWN)
 *      are handled, and how finality ... is declared solely by the
 *      protocol.").
 *     lines 281-289 (Boundaries, verbatim):
 *       "Settlement never computes netting or mutates obligations beyond
 *        lifecycle transitions.
 *        Settlement does not implement rail protocols; area 13 does.
 *        Finality is protocol-owned even when informed by rail or
 *        blockchain confirmation data.
 *        Depends on areas 10, 11, 13, 14, 15."
 *   spec/architecture/v0.1/rails-adapters-reconciliation.md §1 Area 13
 *   lines 36-40 ("AUTHORIZED: created by Settlement Authority (area 12)
 *   with a linked settlement instruction; this link is the explicit
 *   authorization required by GC-3"), §2 Area 14 lines 171-179 (the
 *   recovery paths the resolution port consumes).
 *   spec/registry/protocol-registry.json singleFinancialAuthority:
 *     "Only the Settlement and Finality Authority originates
 *      instructions for external value movement; only the Rail Authority
 *      executes them through adapters".
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - The singleFinancialAuthority discipline: rail execution requests
 *     flow ONLY to the A13 interface. This port IS the A13 interface as
 *     the settlement domain consumes it: authorizeOperation /
 *     submitRailOperation / getOperation (the RailAdapterAuthority
 *     commands) + caseForOperation (the Reconciliation Authority's
 *     case-model query the UNKNOWN hold and resolution reference need).
 *     The port is structurally satisfied by the merged RTN-004
 *     authorities (see settlementPortFromAuthorities below); the bun
 *     test suites bind a faithful in-memory double over the REAL
 *     SimulatedRail adapter, and the node harness
 *     (scripts/test_protocol_netting_settlement.mjs) proves the real
 *     composition.
 *   - The obligations and netting ports carry ONLY the lifecycle
 *     transitions area 12 is entitled to drive ("Settlement never
 *     computes netting or mutates obligations beyond lifecycle
 *     transitions") plus the read projections the amount-verbatim copy
 *     (INV-12-1) requires.
 */

import type {
  RailAdapterAuthority,
  ReconciliationAuthority,
  RailOperationRecord,
  RailsCommandResult,
  ReconciliationCaseRecord,
  SubmitRailOperationOutcome,
} from '../rails/index.ts';
import type { RailAdapterConnection } from '../rails/index.ts';
import type {
  NettingCommandResult,
  NetObligationRecord,
} from '../netting/netting.ts';
import type {
  ObligationCommandResult,
  ObligationRecord,
  SettlementFinalityInstruction,
  SettlementInstructionApplied,
} from '../obligations/obligations.ts';

/**
 * The A13/A14 interface the Settlement Authority composes with — the
 * ONLY path rail execution requests flow to ("only the Rail Authority
 * executes them through adapters"). authorizeOperation /
 * submitRailOperation / getOperation are the RailAdapterAuthority
 * commands; caseForOperation is the Reconciliation Authority's
 * case-model query (INV-14-1's exactly-one case per UNKNOWN operation).
 *
 * Source: rails-adapters-reconciliation.md lines 36-40, 50-54 (A13 owning
 * authority + the GC-3 link); lines 150-152 (INV-14-1);
 * clearing-netting-settlement.md lines 281-289.
 */
export interface SettlementRailsPort {
  /** Create (idempotently) the RailOperation linked to the instruction — the GC-3 authorization. */
  authorizeOperation(input: {
    readonly instructionId: string;
    readonly adapterId: string;
    readonly payload: unknown;
  }): RailsCommandResult<RailOperationRecord>;
  /** Submit one AUTHORIZED operation through the adapter connection — the ONLY external-effect path. */
  submitRailOperation(
    operationId: string,
    connection: RailAdapterConnection,
  ): RailsCommandResult<SubmitRailOperationOutcome>;
  /** The rail operation by id. */
  getOperation(operationId: string): RailOperationRecord | undefined;
  /** The automatically opened area-14 case for an operation's UNKNOWN, when one exists. */
  caseForOperation(operationId: string): ReconciliationCaseRecord | undefined;
}

/**
 * Bind the settlement rails port from the merged RTN-004 authorities
 * (the composition root's wiring helper — the real A13/A14 interface).
 *
 * Source: the singleFinancialAuthority rule (spec/registry/
 * protocol-registry.json); rails/runtime.ts createRailsAuthorities.
 */
export function settlementPortFromAuthorities(
  railAuthority: RailAdapterAuthority,
  reconciliation: ReconciliationAuthority,
): SettlementRailsPort {
  return {
    authorizeOperation: (input) => railAuthority.authorizeOperation(input),
    submitRailOperation: (operationId, connection) =>
      railAuthority.submitRailOperation(operationId, connection),
    getOperation: (operationId) => railAuthority.getOperation(operationId),
    caseForOperation: (operationId) =>
      reconciliation.getCaseByOriginOperation(operationId),
  };
}

/**
 * The A10 obligations-ledger port: the read projection (the verbatim
 * amount copy — INV-12-1) and the two lifecycle transitions area 12
 * drives ("Settlement never ... mutates obligations beyond lifecycle
 * transitions"). Structurally satisfied by the merged
 * ObligationLedgerAuthority (RTN-008).
 *
 * Source: clearing-netting-settlement.md lines 97-99 ("SETTLEMENT_
 * PENDING: a settlement instruction (area 12) exists." / "SETTLED:
 * settlement finality recorded (area 12)."), lines 281-289.
 */
export interface SettlementObligationLedgerPort {
  /** The obligation record by id (the ledger projection read). */
  obligation(obligationId: string): ObligationRecord | undefined;
  /** The -> SETTLEMENT_PENDING lifecycle transition (a no-op typed result when already pending). */
  applySettlementInstruction(
    instruction: SettlementInstructionApplied,
  ): Promise<ObligationCommandResult<{ obligation: ObligationRecord; applied: boolean }>>;
  /** The SETTLEMENT_PENDING -> SETTLED finality advance ("exactly once" — INV-12-4). */
  applySettlementFinality(
    instruction: SettlementFinalityInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>>;
}

/**
 * The A11 netting-domain port: the read projection of the net
 * obligations (the verbatim amount copy — INV-12-1) and the two
 * lifecycle transitions area 12 drives on the net positions' obligation
 * form. Structurally satisfied by the NettingAuthority (RTN-009's own
 * netting module).
 *
 * Source: clearing-netting-settlement.md lines 224-225 ("for one
 * obligation or net position"), lines 236-240 ("FINAL advances the
 * obligation to SETTLED exactly once"), lines 281-289.
 */
export interface SettlementNettingPort {
  /** The net obligation record by id (the netting domain's projection read). */
  netObligation(netObligationId: string): NetObligationRecord | undefined;
  /** The net obligation's -> SETTLEMENT_PENDING lifecycle transition (typed no-op when already pending). */
  applyNetPositionSettlementInstruction(input: {
    readonly netObligationId: string;
    readonly settlementInstructionId: string;
  }): Promise<NettingCommandResult<{ netObligation: NetObligationRecord; applied: boolean }>>;
  /** The net obligation's SETTLEMENT_PENDING -> SETTLED finality advance ("exactly once" — INV-12-4). */
  applyNetPositionSettlementFinality(input: {
    readonly netObligationId: string;
    readonly finalityRecordId: string;
  }): Promise<NettingCommandResult<NetObligationRecord>>;
}

/**
 * Bind the obligations port from the merged ObligationLedgerAuthority.
 *
 * Source: clearing-netting-settlement.md lines 97-99, 281-289.
 */
export function obligationLedgerPortFromAuthority(authority: {
  obligation(obligationId: string): ObligationRecord | undefined;
  applySettlementInstruction(
    instruction: SettlementInstructionApplied,
  ): Promise<ObligationCommandResult<{ obligation: ObligationRecord; applied: boolean }>>;
  applySettlementFinality(
    instruction: SettlementFinalityInstruction,
  ): Promise<ObligationCommandResult<ObligationRecord>>;
}): SettlementObligationLedgerPort {
  return {
    obligation: (obligationId) => authority.obligation(obligationId),
    applySettlementInstruction: (instruction) => authority.applySettlementInstruction(instruction),
    applySettlementFinality: (instruction) => authority.applySettlementFinality(instruction),
  };
}

/**
 * Bind the netting port from the NettingAuthority.
 *
 * Source: clearing-netting-settlement.md lines 224-225, 236-240.
 */
export function nettingPortFromAuthority(authority: {
  netObligation(netObligationId: string): NetObligationRecord | undefined;
  applyNetPositionSettlementInstruction(input: {
    readonly netObligationId: string;
    readonly settlementInstructionId: string;
  }): Promise<NettingCommandResult<{ netObligation: NetObligationRecord; applied: boolean }>>;
  applyNetPositionSettlementFinality(input: {
    readonly netObligationId: string;
    readonly finalityRecordId: string;
  }): Promise<NettingCommandResult<NetObligationRecord>>;
}): SettlementNettingPort {
  return {
    netObligation: (netObligationId) => authority.netObligation(netObligationId),
    applyNetPositionSettlementInstruction: (input) =>
      authority.applyNetPositionSettlementInstruction(input),
    applyNetPositionSettlementFinality: (input) =>
      authority.applyNetPositionSettlementFinality(input),
  };
}
