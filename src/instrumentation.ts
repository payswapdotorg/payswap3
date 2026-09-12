/**
 * UI-011 — the web-boundary wiring of the sanctioned product splice
 * (rtn-plan-rulings.md Q5/delta 6).
 *
 * Next.js server bootstrap hook: when the Node.js server runtime starts,
 * compose the protocol runtime EXACTLY ONCE per process (per the composed
 * barrel's documented order — src/lib/protocol/server-runtime.ts, the one
 * composition root) and register the seven runtime adapters as the
 * product ports' backings. Guarded to the nodejs runtime: the composed
 * runtime binds the DEP-003 durable substrate over node:sqlite and is
 * never loaded in the Edge runtime or any client bundle.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { wireProductPortsToProtocolRuntime } = await import(
    './lib/protocol/server-runtime'
  );
  await wireProductPortsToProtocolRuntime();
}
