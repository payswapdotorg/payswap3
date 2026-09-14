/**
 * PC-001 — Console foundation types: principal, status, authority metadata,
 * and the read-result envelope (the frozen contracts every later console
 * phase consumes).
 *
 * Authority sources these contracts reuse (the exact inventory is recorded in
 * spec/console/PC-001-evidence.md):
 *   - Role vocabulary: `ROLES` / `Role` (src/lib/navigation.ts) — the existing
 *     repository role vocabulary is authoritative and matches design §6
 *     (customer, merchant, provider, operator, administrator) one-for-one.
 *   - Audience resolution: `resolveShellAudience()` (src/lib/shell-audience-server.ts).
 *   - Environment: `EnvironmentKind` / `ConfiguredEnvironment` /
 *     `EnvironmentReport` (src/lib/environment.ts).
 *   - Status vocabulary: aligned exactly with the product state-display
 *     contract `DISPLAY_STATES` (src/components/state/display-state.ts); the
 *     alignment is machine-checked in src/lib/console/dto.test.ts.
 *
 * The console introduces NO new financial authority, NO new state machine,
 * and NO persistence. These types are presentation-composition contracts
 * only (design §4: "a view-model is presentation composition, not a new
 * authority").
 */

import type { Role } from '@/lib/navigation';
import type { ConfiguredEnvironment, EnvironmentKind } from '@/lib/environment';

// ─────────────────────────────────────────────────────────────────────────────
// Principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The console principal, resolved exclusively server-side from the existing
 * shell audience authority. Unauthenticated or unknown viewers resolve to the
 * unauthenticated principal (least visibility, P8) — the console never
 * infers, self-assigns, or escalates a role from URL parameters, client
 * state, or hidden switches (design §6).
 */
export type ConsolePrincipal =
  | { readonly authenticated: false; readonly reason: 'unauthenticated' }
  | { readonly authenticated: true; readonly role: Role };

/** Principal narrowed to the authenticated case (post-guard). */
export interface AuthenticatedConsolePrincipal {
  readonly role: Role;
}

/**
 * Fail-closed authorization decision for one console module.
 * `allowed` is true ONLY when the module exists in the frozen registry AND
 * the principal's role is explicitly allowed for it (default-deny for
 * anything not explicitly allowed).
 */
export type ConsoleAccessDecision =
  | {
      readonly allowed: true;
      readonly role: Role;
      readonly moduleId: ConsoleModuleId;
    }
  | {
      readonly allowed: false;
      readonly reason: 'unauthenticated' | 'role-denied' | 'unknown-module';
      readonly moduleId: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Registry vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module identifiers for the frozen console information architecture
 * (design §5). The set of valid ids is exactly the ids present in
 * `CONSOLE_REGISTRY` (src/lib/console/registry.ts) — an id not in the
 * registry is an unknown module and authorization fails closed.
 */
export type ConsoleModuleId = string & { readonly __consoleModuleId: unique symbol };

/** Top-level information-architecture groups (design §5, frozen order). */
export const CONSOLE_GROUPS = [
  'overview',
  'payments',
  'checkout',
  'accounts',
  'capabilities',
  'developers',
  'operations',
  'documentation',
] as const;
export type ConsoleGroupId = (typeof CONSOLE_GROUPS)[number];

/**
 * Route availability. The first console release marks every composed feature
 * view `planned` until PC-004/PC-005 merge; only the `/console` foundation
 * root is `available` in PC-001 (registry summary + environment label, no
 * feature views).
 */
export type ConsoleRouteStatus = 'available' | 'planned';

/** One frozen information-architecture route entry. */
export interface ConsoleRouteEntry {
  /** Module id (unique across the registry). */
  readonly id: ConsoleModuleId;
  /** Route path reserved for this module (`[param]` tokens for dynamic segments). */
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly group: ConsoleGroupId;
  /** Roles explicitly allowed (from the design §6 role model). Default-deny. */
  readonly allowedRoles: readonly Role[];
  readonly status: ConsoleRouteStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The server-derived environment context console code consumes. Wraps
 * `describeEnvironment()` (src/lib/environment.ts) plus the startup
 * configuration validation summary (src/lib/startup-config.ts, DEP-002).
 *
 * `derivedBy: 'server'` is a literal marker: the ONLY derivation path is the
 * frozen server-side chain (PAYSWAP_ENV → getEnvironment()). No query
 * parameter, header, cookie, or client state can select production/test —
 * the producing function accepts no input at all
 * (src/lib/console/environment-context.ts).
 */
export interface ConsoleEnvironmentContext {
  readonly kind: EnvironmentKind;
  readonly configuredValue: ConfiguredEnvironment;
  readonly source: string;
  readonly derivedBy: 'server';
  /** Startup configuration validation for the resolved environment (names only, never values). */
  readonly startupConfiguration: {
    readonly ok: boolean;
    readonly env: EnvironmentKind;
    readonly checks: readonly {
      readonly id: string;
      readonly ok: boolean;
      readonly detail: string;
    }[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO status vocabulary (frozen)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The six console DTO statuses — EXACTLY the product state-display
 * vocabulary (UNKNOWN | WAITING | IN_PROGRESS | FAILED | SUCCEEDED |
 * ACTION_REQUIRED; design §7). Members and alignment with
 * `DISPLAY_STATES` are frozen in src/lib/console/dto.ts and machine-checked
 * in src/lib/console/dto.test.ts. A transport/fetch failure is NOT a
 * business failure: it must resolve to UNKNOWN, never FAILED/SUCCEEDED.
 */
export type ConsoleStatus =
  | 'UNKNOWN'
  | 'WAITING'
  | 'IN_PROGRESS'
  | 'FAILED'
  | 'SUCCEEDED'
  | 'ACTION_REQUIRED';

// ─────────────────────────────────────────────────────────────────────────────
// Authority metadata (nine-question discipline, design §16/§17)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authority metadata for every consequential console field/view. This is the
 * machine-readable form of the design §17 reconciliation-matrix columns,
 * which condense the product's nine-question mapping discipline
 * (spec/product/intent-mapping-records.md):
 *
 *   1. State identity          → `protocolObject` + `owningAuthority`
 *   2. Display resolution      → the DTO `status` on the value branch
 *   3. Mandatory content       → owned by the view (PC-004/PC-005)
 *   4. Wording boundaries      → owned by the view; UNKNOWN never worded as
 *                                success/failure (P5)
 *   5. User actions            → owned by the view; protocol-authorized only
 *   6. Evidence trail          → `evidenceReference`
 *   7. Reconciliation          → `unknownSemantics` (recovery/recheck path)
 *   8. Causes                  → authority-reported only; never client-inferred
 *   9. Ownership & boundary    → `owningAuthority` + `runtimeBoundary` +
 *                                `durableSource`
 *
 * No console DTO ships a consequential value without one of these attached.
 */
export interface ConsoleAuthorityMetadata {
  /** Which consequential view/field this value serves. */
  readonly view: string;
  /** The protocol object/state this value presents (authority vocabulary). */
  readonly protocolObject: string;
  /** The owning authority (exact symbol/module from the inventory). */
  readonly owningAuthority: string;
  /** The runtime boundary the read crosses (exact module/symbol). */
  readonly runtimeBoundary: string;
  /** The durable source of truth (store/ledger/registry, named exactly). */
  readonly durableSource: string;
  /** Recovery/UNKNOWN semantics: who resolves it and what re-checks. */
  readonly unknownSemantics: string;
  /** Evidence reference (record id family / document path). */
  readonly evidenceReference: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-result envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The stable console read envelope. Every console read model resolves to
 * exactly one of:
 *
 *   - `value`: the owning authority answered; `status` is the
 *     authority-reported business status (one of the six).
 *   - `unavailable`: no authoritative answer is available. The presentation
 *     status is the LITERAL 'UNKNOWN' — never FAILED, never SUCCEEDED. A
 *     transport/fetch failure MUST land here (via `consoleTransportFailure`),
 *     because a transport failure is not a business failure (design §9).
 *
 * The 'unavailable' branch carries no `status` field of type ConsoleStatus:
 * its presentation status is structurally pinned to UNKNOWN, so an
 * unavailable read cannot be worded, typed, or counted as failure/success.
 */
export type ConsoleReadResult<T> =
  | {
      readonly outcome: 'value';
      readonly value: T;
      readonly status: ConsoleStatus;
      readonly authority: ConsoleAuthorityMetadata;
    }
  | {
      readonly outcome: 'unavailable';
      readonly presentationStatus: 'UNKNOWN';
      readonly note: string;
      readonly authority: ConsoleAuthorityMetadata;
    };
