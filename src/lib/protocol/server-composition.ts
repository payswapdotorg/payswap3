/**
 * ════════════════════════════════════════════════════════════════════════
 *  SYS-001 — THE SERVER-ONLY SHARED COMPOSITION MODULE (the D-2 remediation)
 * ════════════════════════════════════════════════════════════════════════
 *
 * THE module the routes import (deferral-ledger D-2's requested disposition,
 * verbatim: "a server-only shared module the routes import, performing the
 * registration idempotently"). The pre-SYS-001 splice registered the seven
 * runtime adapters ONLY in src/instrumentation.ts's module graph; Turbopack
 * compiles instrumentation.ts and each route into SEPARATE module graphs,
 * and in the built app the register seams were dead-code-eliminated from
 * the instrumentation graph entirely — every port call in the running app
 * resolved the transport-unavailable backing
 * (src/lib/protocol/unavailable-backing.ts). This module restores the
 * reachability: importing it from server code performs the registration
 * INTO THAT GRAPH's port-module instances, over the ONE process-global
 * composition (src/lib/protocol/server-runtime.ts's globalThis slot — one
 * runtime, one worker fleet, one set of var/web-runtime/ SQLite stores per
 * process, shared across every graph).
 *
 * USAGE (server code only — API routes and server components):
 *
 *     import { ensureProductPortsWired } from '@/lib/protocol/server-composition';
 *     ...
 *     await ensureProductPortsWired();   // idempotent; first call awaits boot
 *     const port = getMediationPort();   // NOW resolves the runtime adapter
 *
 * Idempotence: per module-graph instance (module-level flag) for the
 * registration and per process (server-runtime.ts's globalThis slot) for
 * the composition — a second call in the same graph is a no-op, and
 * concurrent first calls across graphs coalesce onto the same boot
 * promise. Browser contexts NEVER import this module: it transitively
 * binds the node:sqlite durable substrate (server-runtime.ts), so it must
 * never be imported from a 'use client' module — the 'use client' port
 * consumers keep the honest transport-unavailable backing (P5).
 *
 * The D-1 HTTP binding (src/app/api/protocol/commands/route.ts) imports
 * this module too: the gateway it exposes is THE composed runtime's sole
 * admission point, reached through the same wiring.
 *
 * Deferral-ledger disposition: D-2 (the registration reachability) — and
 * the drain() the adapters call after submissions is the D-3 bounded tick
 * pass implemented in server-runtime.ts.
 */

import {
  getProtocolRuntimeHandle,
  wireProductPortsToProtocolRuntime,
} from './server-runtime';
import type { ProtocolGateway } from './runtime-handle';

/** Per-graph idempotence flag: ensureProductPortsWired() runs once per module graph. */
let ensuredInThisGraph = false;

/**
 * Ensure THIS module graph's product ports resolve the RUNTIME-backed
 * adapters (the D-2 acceptance): await the one process-global composition
 * (creating it if this is the first call anywhere in the process) and
 * register the seven runtime adapters into THIS graph's port-module
 * instances. Idempotent per graph; safe under concurrency (all callers
 * await the same boot promise).
 *
 * Fail-closed: if the composition boot fails, this throws — the caller's
 * port accessors keep the transport-unavailable backing (honest UNKNOWN,
 * never fabricated state), and a later call retries.
 */
export async function ensureProductPortsWired(): Promise<void> {
  if (ensuredInThisGraph) {
    return;
  }
  await wireProductPortsToProtocolRuntime();
  ensuredInThisGraph = true;
}

/**
 * The composed runtime's gateway — THE sole admission point for protocol
 * commands (COMMAND-SURFACE.md), reached through the same process-global
 * composition. The D-1 HTTP binding (src/app/api/protocol/commands/route.ts)
 * uses this accessor; it composes NO new authority and adds NO validation
 * of its own — submitCommand's A01 admission contract (authority
 * attribution, per-authority schema validation, idempotent receipts) is
 * entirely the gateway's.
 */
export async function getServerProtocolGateway(): Promise<ProtocolGateway> {
  const handle = await getProtocolRuntimeHandle();
  return handle.gateway;
}
