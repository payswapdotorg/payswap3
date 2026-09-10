// src/lib/startup-config.ts — startup configuration validation (DEP-002).
//
// Contract source: spec/deployment/configuration.md (per-environment required
// configuration) and spec/deployment/environments.md (fail-closed rules).
//
// Fail-closed (F6): validation NEVER infers or guesses. In `production`, any
// missing required configuration name ⇒ NOT ok. In `sandbox`, the environment
// selection itself is the whole required configuration (F4: sandbox never
// performs production financial behavior, so it requires no production
// wiring).
//
// Secret boundary (S1–S5): this module declares secret NAMES only. It never
// reads, logs, serializes, or exposes secret VALUES — presence of a name in
// the process environment is the only signal it consumes. Values are injected
// at runtime by deployment mechanisms (F2/F4) and must never be
// source-controlled.

import { getEnvironment, type EnvironmentKind } from "@/lib/environment";

/** One named startup check. `id` is the check identifier reported by readiness. */
export interface StartupCheck {
  /**
   * Check identifier. For required-configuration checks this is exactly the
   * required secret NAME. Readiness failures are reported as ids only —
   * never values (F6, S4).
   */
  id: string;
  ok: boolean;
  /** Outcome description ("present" / "missing" / environment resolution). Never contains a value. */
  detail: string;
}

/** Result of startup configuration validation. */
export interface StartupConfigResult {
  ok: boolean;
  env: EnvironmentKind;
  checks: StartupCheck[];
}

/**
 * Per-environment required configuration — NAMES ONLY.
 *
 * `sandbox`: nothing beyond the environment selection itself.
 * `production`: every name below must be present at runtime. The names map
 * to the topology contract (spec/deployment/topology.md):
 *   - PAYSWAP_DATABASE_URL       → authoritative-state-store
 *   - PAYSWAP_QUEUE_URL           → durable-command-queue
 *   - PAYSWAP_EVIDENCE_STORE_URL  → evidence-object-store
 *   - PAYSWAP_RAIL_ADAPTERS_URL   → external-rail-adapters
 */
const REQUIRED_CONFIGURATION: Record<EnvironmentKind, readonly string[]> = {
  sandbox: [],
  production: [
    "PAYSWAP_DATABASE_URL",
    "PAYSWAP_QUEUE_URL",
    "PAYSWAP_EVIDENCE_STORE_URL",
    "PAYSWAP_RAIL_ADAPTERS_URL",
  ],
};

/**
 * Validate the startup configuration for the resolved runtime environment.
 *
 * Pure and synchronous: reads only the environment selection (via the frozen
 * `src/lib/environment.ts` module) and the PRESENCE of required names in the
 * process environment. Performs no I/O, never throws, never logs, and never
 * inspects configuration VALUES beyond presence.
 */
export function validateStartupConfig(): StartupConfigResult {
  // Environment resolution is delegated to the single frozen module
  // (F1: never re-implemented here). Unset/invalid ⇒ fail-safe sandbox.
  const env = getEnvironment();

  const checks: StartupCheck[] = [
    {
      id: "environment",
      ok: true,
      detail: `environment resolved as "${env}" via PAYSWAP_ENV (allowlist sandbox|production, fail-safe sandbox)`,
    },
  ];

  for (const name of REQUIRED_CONFIGURATION[env]) {
    const present = isNamePresent(name);
    checks.push({
      id: name,
      ok: present,
      detail: present
        ? "required configuration name present (value not read)"
        : "required configuration name missing",
    });
  }

  const ok = checks.every((check) => check.ok);

  return { ok, env, checks };
}

/**
 * Presence-of-name check only (S1–S5). A name that is unset, or set to an
 * empty string, counts as missing — an empty injection carries no
 * configuration and must fail closed (F6). The value itself is never read,
 * compared, logged, or returned.
 */
function isNamePresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}
