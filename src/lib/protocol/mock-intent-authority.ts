/**
 * ════════════════════════════════════════════════════════════════════════
 *  MOCK INTENT AUTHORITY — RETIRED (UI-011) · verification-support shim
 * ════════════════════════════════════════════════════════════════════════
 *
 * UI-011 retired the mock Intent Authority: the intent port
 * (src/lib/protocol/intent-port.ts) is now backed by the RUNTIME ADAPTER
 * over the composed protocol runtime (src/lib/protocol/
 * runtime-intent-adapter.ts) — commands through ProtocolGateway.submitCommand,
 * reads from the A01 query API + the real A15 chain. This module is no
 * longer a port backing and implements NO authority semantics.
 *
 * WHY THIS FILE STILL EXISTS (recorded deviation, stated honestly): the
 * read-only verification surfaces frozen by UI-002
 * (src/components/verification/intent-flow-harness.tsx) import this
 * module's harness-scripting API BY PATH. The work order forbids changing
 * product surfaces, so the module must remain importable. It retains ONLY
 * the frozen verification harness API — a script record the harness UI
 * reads and writes — and states plainly that scripting no longer drives
 * any authority state: the runtime adapter's states are the A01 Intent
 * Authority's own reports and cannot be scripted.
 */

import type { AuthorityState } from './intent-port';
import { LEGACY_FIXTURE_STATES } from './intent-port';

// ── Harness script (verification surfaces only) ──────────────────────────

export interface MockAuthorityScript {
  /**
   * Harness-only record of the outcome the verifier selected for the next
   * submit demonstration. RETIRED as an authority input: the runtime
   * adapter never reads it — intent states are the Intent Authority's own
   * reports over the A15 chain.
   */
  nextSubmitState: AuthorityState;
  /**
   * Harness-only record of the reachability the verifier selected.
   * RETIRED as an authority input: the runtime adapter is always wired
   * server-side; browser-context calls are transport-unavailable by
   * architecture, not by script.
   */
  authorityReachable: boolean;
}

const DEFAULT_SCRIPT: MockAuthorityScript = {
  nextSubmitState: 'acknowledged',
  authorityReachable: true,
};

let script: MockAuthorityScript = { ...DEFAULT_SCRIPT };

/**
 * VERIFICATION HARNESS ONLY: record the harness's selected demonstration
 * outcome. With the mock retired this has NO effect on the port — the
 * runtime-backed adapter reports the Intent Authority's real states.
 */
export function configureMockAuthority(next: Partial<MockAuthorityScript>): MockAuthorityScript {
  script = { ...script, ...next };
  return script;
}

/** VERIFICATION HARNESS ONLY: read the recorded harness script. */
export function readMockAuthorityScript(): MockAuthorityScript {
  return { ...script };
}

/**
 * The retired fixture vocabulary the harness's submit-outcome selector
 * still names (interface-compat members of the widened AuthorityState).
 */
export const RETIRED_FIXTURE_STATES = LEGACY_FIXTURE_STATES;
