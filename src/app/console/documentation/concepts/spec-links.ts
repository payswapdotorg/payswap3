/**
 * PC-005 — The documentation concepts map: the protocol architecture’s own
 * files, linked — never duplicated or re-interpreted.
 *
 * The frozen architecture (spec/architecture/v0.1/) is authoritative for
 * protocol semantics. This inventory records the file set and, for each,
 * ONLY the reading pointer the architecture index itself states (its areas
 * and reading order). The documentation route-inventory test verifies every
 * referenced path EXISTS on disk — no dead links — and nothing here restates
 * or re-derives area semantics.
 */

export interface DocumentationSpecLink {
  /** The repository-relative path (verified to exist by the test). */
  readonly path: string;
  /** What the architecture index itself says the file covers. */
  readonly coverage: string;
}

/** The frozen architecture file set, in the index’s own reading order. */
export const DOCUMENTATION_SPEC_LINKS: readonly DocumentationSpecLink[] = Object.freeze([
  {
    path: 'spec/architecture/v0.1/README.md',
    coverage: 'The index and freeze record: scope, the binding global constraints GC-1..GC-7, the 24-area coverage map, machine-readable projections, and the ACR-only change control.',
  },
  {
    path: 'spec/architecture/v0.1/core.md',
    coverage: 'Areas 1–5 (reading order step 2): intent and demand, fulfillment policy, capability discovery and commitments, routing/compiler, reservations and concurrency.',
  },
  {
    path: 'spec/architecture/v0.1/liquidity-credit-queues.md',
    coverage: 'Areas 6–8 (reading order step 3): liquidity, credit, queued/delayed fulfillment — resources and waiting.',
  },
  {
    path: 'spec/architecture/v0.1/clearing-netting-settlement.md',
    coverage: 'Areas 9–12 (reading order step 4): clearing, obligations, bilateral and multilateral netting, settlement and finality — ledger through finality.',
  },
  {
    path: 'spec/architecture/v0.1/rails-adapters-reconciliation.md',
    coverage: 'Areas 13–14 (reading order step 5): external rail adapters and reconciliation — the external world and the resolution of UNKNOWN.',
  },
  {
    path: 'spec/architecture/v0.1/evidence-risk-compliance.md',
    coverage: 'Areas 15–17 (reading order step 6): evidence, risk/compliance, simulation/replay — proof and governance.',
  },
  {
    path: 'spec/architecture/v0.1/extensions-agents-merchant.md',
    coverage: 'Areas 18–20 (reading order step 7): extensions/capability marketplace, agents and mediation, merchant checkout/settlement primitives — growth surfaces.',
  },
  {
    path: 'spec/architecture/v0.1/disputes-federation-blockchain-emergence.md',
    coverage: 'Areas 21–24 (reading order step 8): disputes/recourse, federation, blockchain rails, capability emergence from unsupported demand — recourse and expansion.',
  },
]);

/**
 * The binding global constraints, quoted as ONE-LINE pointers (the full
 * binding text lives in the README — this map never restates it).
 */
export const DOCUMENTATION_GLOBAL_CONSTRAINTS: readonly { readonly id: string; readonly pointer: string }[] =
  Object.freeze([
    { id: 'GC-1', pointer: 'Exact, deterministic financial arithmetic (signed integer minor units; no floating point).' },
    { id: 'GC-2', pointer: 'UNKNOWN results go to reconciliation, never blind retry.' },
    { id: 'GC-3', pointer: 'External effects only behind the rail-adapter boundary, with explicit authorization.' },
    { id: 'GC-4', pointer: 'Single financial authority — product and deployment consume protocol projections.' },
    { id: 'GC-5', pointer: 'Every consequential operation produces exactly one evidence record.' },
    { id: 'GC-6', pointer: 'Simulation and replay are isolated and marked non-authoritative.' },
    { id: 'GC-7', pointer: 'Sandbox and demo isolation — sandbox cannot reach production financial effects.' },
  ]);
