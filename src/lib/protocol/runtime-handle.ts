/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — THE RUNTIME HANDLE (the adapter-facing view of the composed runtime)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The single typed seam through which every runtime adapter
 * (src/lib/protocol/runtime-*-adapter.ts) reaches the composed protocol
 * runtime (src/lib/protocol-runtime/ — RTN-012's merged wave barrel).
 *
 * DISCIPLINE (frozen by the UI-011 work order):
 *   • Commands flow EXCLUSIVELY through `gateway.submitCommand` with a
 *     kernel CommandEnvelope (COMMAND-SURFACE.md: "the ONLY function other
 *     code may call to submit a protocol command"). No adapter ever calls
 *     an authority command method directly and no adapter ever touches the
 *     durable substrate — the single-writer path is gateway → durable
 *     queue → worker → transition runtime → owning authority.
 *   • State reads use the runtime's PUBLIC READ SURFACE ONLY: the owning
 *     authorities' own query methods (getIntent, snapshot, pool, …) and
 *     the A15 evidence log (`evidenceLog.records()`) for proof trails.
 *     Nothing here fabricates authority state, acceptance, or settlement
 *     wording (N1, N3, N5).
 *   • The handle NEVER constructs the runtime: it is HANDED a composition
 *     created exactly once per process by
 *     src/lib/protocol/server-runtime.ts (per the barrel's documented
 *     composition order: substrate → evidence → authorities → persist
 *     hooks → bindings → transition → gateway → scheduler) or by a bun
 *     test composition over the leaf modules (the repository's documented
 *     bun/Node split: bun suites import the leaf modules directly). There
 *     is no second composition root.
 *
 * BUN/BROWSER SAFETY: this module imports the composed barrel for TYPES
 * ONLY (`import type`) — TypeScript erases those imports, so this module
 * (and every runtime-*-adapter.ts) loads under bun test and would never
 * reach a browser bundle. The Node-only composition lives in
 * server-runtime.ts.
 */

import type {
  CapabilityAuthority,
  CommandEnvelope,
  CreditAuthority,
  EvidenceLog,
  IntentAuthority,
  LiquidityAuthority,
  ObligationLedgerAuthority,
  ProtocolGateway,
  QueueAuthority,
  ReconciliationAuthority,
} from '../protocol-runtime/index.ts';

export type {
  CommandEnvelope,
  CommandAdmissionResult,
  CommandReceipt,
  IntentAuthority,
  CapabilityAuthority,
  LiquidityAuthority,
  CreditAuthority,
  QueueAuthority,
  ObligationLedgerAuthority,
  ReconciliationAuthority,
  EvidenceLog,
  ProtocolGateway,
} from '../protocol-runtime/index.ts';

/**
 * The adapter-facing runtime handle: the composed runtime's public
 * command surface (the gateway — sole admission point), its public read
 * surface (the owning authorities' query methods + the A15 evidence log),
 * and one bounded drain helper over the durable command path.
 */
export interface ProtocolRuntimeHandle {
  /** The sole protocol-command admission point (COMMAND-SURFACE.md). */
  readonly gateway: ProtocolGateway;
  /** The A15 evidence log — the read surface for proof trails. */
  readonly evidenceLog: EvidenceLog;
  /** The owning authorities the product ports read from (public query APIs). */
  readonly authorities: {
    /** A01 — owns PaymentIntent state (intent state presentation). */
    readonly intent: IntentAuthority;
    /** A03 — owns CapabilityRecord state (capability presentation). */
    readonly capability: CapabilityAuthority;
    /** A06 — owns liquidity positions (liquidity presentation). */
    readonly liquidity: LiquidityAuthority;
    /** A07 — owns credit lines and exposure (credit presentation). */
    readonly credit: CreditAuthority;
    /** A08 — owns fulfillment queues and queued items (waiting presentation). */
    readonly queues: QueueAuthority;
    /** A10 — owns obligations (dispute presentation, A10 dispute primitive). */
    readonly obligations: ObligationLedgerAuthority;
    /** A14 — owns reconciliation cases (the UNKNOWN resolution owner). */
    readonly reconciliation: ReconciliationAuthority;
  };
  /**
   * One bounded drain pass over the durable command path so admitted
   * commands get executed (the worker's own pass; the server runtime also
   * auto-polls — this accelerates reads-after-submit deterministically).
   */
  drain(): Promise<void>;
}

/** The handle's authority-subset type used by single-authority adapters. */
export type RuntimeAuthorities = ProtocolRuntimeHandle['authorities'];
