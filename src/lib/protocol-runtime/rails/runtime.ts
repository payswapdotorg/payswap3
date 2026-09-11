/**
 * RTN-004 — Rails: the composition root wiring the two authorities.
 *
 * The wiring contract: the Rail Adapter Authority's INV-14-1 auto-case
 * dependency (UnknownCaseOpener) is satisfied by the Reconciliation
 * Authority — "Every UNKNOWN rail operation automatically opens exactly
 * one case" is executed INSIDE the A13 command's store transaction, so the
 * case exists atomically with the UNKNOWN landing. Both authorities share
 * the ONE per-domain store (single-writer discipline: every state
 * mutation flows through exactly one authority command, one transaction).
 *
 * Spec sources (binding): spec/architecture/v0.1/
 * rails-adapters-reconciliation.md lines 80-81 ("1. Opens a reconciliation
 * case (area 14) automatically."), lines 124-126, 150-152 (INV-14-1);
 * rtn-plan-rulings.md Q1/delta 1 ("state advances only through the
 * authority's command surface"); spec/deployment/topology.md ("exactly one
 * authoritative-state writer").
 *
 * RTN-012 consumes this factory when composing the full runtime journey
 * (the rails surface's transitions executed through the single-writer
 * path); RTN-011's boundary review must cover the rails surface.
 */

import { openRailsStore } from './persistence.ts';
import type { RailsStoreOptions } from './persistence.ts';
import { RailsStore } from './store.ts';
import { RailAdapterAuthority } from './authority.ts';
import { ReconciliationAuthority } from './reconciliation.ts';
import type { EvidenceSubmission } from '../kernel/ports.ts';

/** The composed rails domain: both authorities over one store. */
export interface RailsAuthorities {
  readonly store: RailsStore;
  readonly reconciliation: ReconciliationAuthority;
  readonly railAuthority: RailAdapterAuthority;
}

/** Dependencies for creating the composed rails authorities. */
export interface RailsRuntimeDeps {
  /** The EvidenceSubmission port (RTN-002's log in production; an owned test double in tests). */
  readonly evidence: EvidenceSubmission;
  /** Injectable wall clock (epoch ms) for deterministic tests; default Date.now. */
  readonly wallClock?: () => number;
}

/**
 * Wire the two authorities over an ALREADY-OPENED store (the caller owns
 * the store's lifecycle — see openRailsAuthorities for the convenience
 * that opens it).
 *
 * Source: the INV-14-1 wiring contract (module doc).
 */
export function createRailsAuthorities(
  store: RailsStore,
  deps: RailsRuntimeDeps,
): RailsAuthorities {
  const reconciliation = new ReconciliationAuthority({
    store,
    evidence: deps.evidence,
    ...(deps.wallClock === undefined ? {} : { wallClock: deps.wallClock }),
  });
  const railAuthority = new RailAdapterAuthority({
    store,
    evidence: deps.evidence,
    caseOpener: reconciliation,
    ...(deps.wallClock === undefined ? {} : { wallClock: deps.wallClock }),
  });
  return { store, reconciliation, railAuthority };
}

/**
 * Open the rails store (per-domain persistence convention) and wire the
 * two authorities over it. The caller owns closing the store.
 *
 * Source: the RTN-001 per-domain persistence convention; rtn-plan-rulings
 * Q1/delta 1.
 */
export function openRailsAuthorities(
  options: RailsStoreOptions,
  deps: RailsRuntimeDeps,
): RailsAuthorities {
  return createRailsAuthorities(new RailsStore(openRailsStore(options)), deps);
}
