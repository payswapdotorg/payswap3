/**
 * DEP-005 — External rail connectivity: the environment-scoped rail
 * connectivity configuration resolver.
 *
 * Owned surface: src/lib/rail-connectivity/configuration.ts (work order
 * DEP-005 — "Credentials/configuration are environment-scoped"; "Sandbox and
 * production rail credentials/hosts cannot cross-contaminate").
 *
 * THE CONFIGURATION MODEL (spec/deployment/configuration.md — the closed
 * configuration list; every new externally configurable value lands WITH its
 * component's work item):
 *
 *   Per rail (rail id = uppercase alphanumeric segment, e.g. DEMOBANK):
 *
 *     PAYSWAP_RAIL_{SCOPE}_{RAIL}_HOST
 *         the host reference (non-secret endpoint reference; a URI-shaped
 *         string or the documented in-process simulated marker).
 *     PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF
 *         the credential REFERENCE — a NAME into the deployment-owned
 *         secret store (S2: "The repository and these specifications
 *         record secret names and categories only — never values").
 *         REQUIRED for production rails (F6: adapters fail closed without
 *         credentials); optional for sandbox rails (F5: simulated rails, no
 *         real credentials, no signing capability).
 *     PAYSWAP_RAIL_{SCOPE}_{RAIL}_TIMEOUT_MS
 *         the per-rail transmission deadline budget (REQUIRED, positive
 *         safe integer — "Timeouts ... are explicit": no default).
 *     PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_MAX_ATTEMPTS
 *         optional bounded retry attempts (1..MAX_RETRY_ATTEMPTS_BOUND,
 *         default DEFAULT_RETRY_MAX_ATTEMPTS).
 *     PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_BACKOFF_BASE_MS
 *         optional exponential-backoff base (positive safe integer, default
 *         DEFAULT_RETRY_BACKOFF_BASE_MS; capped by
 *         DEFAULT_RETRY_BACKOFF_MAX_MS).
 *
 *   {SCOPE} is exactly `SANDBOX` or `PRODUCTION` — the runtime environment
 *   allowlist values upper-cased. NOTHING ELSE is configurable in this
 *   family.
 *
 * SCOPE ISOLATION (the work order's cross-contamination acceptance, proven
 * structurally + by the harness):
 *
 *   1. Every resolved rail configuration carries an explicit `scopeTag`
 *      ('sandbox' | 'production').
 *   2. The resolver resolves a rail ONLY from the {SCOPE} prefix matching
 *      the runtime scope it was invoked with; it returns ONLY rails whose
 *      scopeTag equals that runtime scope.
 *   3. A declared rail whose variables exist ONLY under the OPPOSITE scope
 *      prefix is REFUSED with a typed scope-mismatch failure (resolution
 *      rejection — never a silent fallback, never an escalation).
 *   4. A declared rail configured under BOTH scope prefixes in one process
 *      environment is REFUSED with a typed contamination failure (a rail
 *      may never be simultaneously sandbox- and production-configured).
 *   5. The boundary binder (boundary.ts createConnectivityBoundary)
 *      re-checks the scope tag at binding time: a resolved config whose
 *      scopeTag does not equal the runtime scope cannot be bound — the
 *      belt-and-suspenders guard.
 *
 *   Consequently a sandbox process can never bind a production-scoped
 *   rail's hosts/credential references, and a production process can never
 *   bind a sandbox-scoped one: "sandbox/demo cannot reach production
 *   financial effects without separately authorized production
 *   configuration" (environments.md, the core guarantee).
 *
 * CREDENTIAL REFERENCES, NEVER VALUES (S1-S5): the resolver reads the
 * reference NAME from the environment and records it on the resolved
 * configuration; it never reads, validates, logs, serializes or exposes any
 * credential VALUE; no field for a value exists anywhere in this family.
 * Dereferencing the reference against the real secret store is the
 * externalized production binding (FUTURE-WORK in the deployment contract).
 * The resolved configuration itself is frozen (immutable) and carries no
 * secret material — the harness machine-checks both properties.
 *
 * FAIL-CLOSED LOADING (F6 + the work order's refuse-to-start rule): the
 * resolver is total and deterministic — `resolveRailConnectivityConfig`
 * returns a typed failure list for ANY malformed, missing, contradictory or
 * cross-scoping input (never a guess, never a silent default of a required
 * value), and `loadRailConnectivityConfigOrThrow` turns those failures into
 * a `RailConnectivityConfigurationError` the composition root must treat as
 * a refusal to start the connectivity boundary.
 *
 * Runtime note (the DEP-004 family precedent): this module is pure and
 * dependency-free — the process environment and the runtime scope are
 * INJECTED (the composition root derives the scope through the frozen
 * src/lib/environment.ts module; the family itself never reads
 * process.env), so the resolver is fully deterministic under test and loads
 * under plain Node with type stripping.
 *
 * Spec sources (binding): spec/deployment/configuration.md (S1-S5; the
 * closed-list rule; the future rail-credential category); spec/deployment/
 * environments.md (F1-F8, the sandbox/production separation, the core
 * guarantee); spec/deployment/topology.md (external-rail-adapters —
 * credentials live only in the production secret scope; adapters fail
 * closed without credentials); spec/system-work-orders/DEP-005.md
 * ("Credentials/configuration are environment-scoped"; "Sandbox and
 * production rail credentials/hosts cannot cross-contaminate").
 */

// ---------------------------------------------------------------------------
// The scope vocabulary (aligned with the frozen runtime allowlist)
// ---------------------------------------------------------------------------

/**
 * The connectivity scope tags: exactly the frozen runtime environment
 * allowlist values (src/lib/environment.ts: `PAYSWAP_ENV` recognizes exactly
 * `sandbox | production`). No third scope exists; no configuration may
 * invent one (F1 — the allowlist cannot be widened by configuration).
 */
export type RailConnectivityScopeTag = 'sandbox' | 'production';

/** The scope segment as it appears in variable names (upper-cased). */
export type RailConnectivityScopeSegment = 'SANDBOX' | 'PRODUCTION';

/** The runtime scope input (the composition root derives it from PAYSWAP_ENV). */
export interface RailConnectivityRuntimeScope {
  readonly scope: RailConnectivityScopeTag;
}

/** Runtime type guard for scope tags. */
export function isRailConnectivityScopeTag(value: unknown): value is RailConnectivityScopeTag {
  return value === 'sandbox' || value === 'production';
}

// ---------------------------------------------------------------------------
// The configuration names (names only — S2)
// ---------------------------------------------------------------------------

/** The variable-name template every rail connectivity variable derives from. */
export const RAIL_CONNECTIVITY_VARIABLE_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
  host: 'PAYSWAP_RAIL_{SCOPE}_{RAIL}_HOST',
  credentialRef: 'PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF',
  timeoutMs: 'PAYSWAP_RAIL_{SCOPE}_{RAIL}_TIMEOUT_MS',
  retryMaxAttempts: 'PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_MAX_ATTEMPTS',
  retryBackoffBaseMs: 'PAYSWAP_RAIL_{SCOPE}_{RAIL}_RETRY_BACKOFF_BASE_MS',
});

/** The production-scope pattern names recorded in the deployment contract (names only). */
export const RAIL_CONNECTIVITY_PRODUCTION_REQUIRED_NAMES: readonly string[] = Object.freeze([
  'PAYSWAP_RAIL_PRODUCTION_{RAIL}_HOST',
  'PAYSWAP_RAIL_PRODUCTION_{RAIL}_CREDENTIAL_REF',
  'PAYSWAP_RAIL_PRODUCTION_{RAIL}_TIMEOUT_MS',
]);

/** The bound on retry attempts (bounded by construction — the work order). */
export const MAX_RETRY_ATTEMPTS_BOUND = 10;

/** The default retry attempt bound (documented; overridable per rail). */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;

/** The default exponential-backoff base, in ms. */
export const DEFAULT_RETRY_BACKOFF_BASE_MS = 250;

/** The backoff cap, in ms (the engine never sleeps longer than this). */
export const DEFAULT_RETRY_BACKOFF_MAX_MS = 4_000;

/**
 * The documented in-process simulated host marker: the value a sandbox rail
 * uses to bind the protocol-owned simulated transport (topology.md
 * simulation rule — "same interface, no external transmission, no real
 * credentials, no signing capability"). It is a configuration VALUE (a
 * non-secret symbolic reference), documented here because it is the ONLY
 * sanctioned non-network host form in the repository.
 */
export const IN_PROCESS_SIMULATED_HOST_MARKER = 'in-process:simulated';

// ---------------------------------------------------------------------------
// The resolved configuration (frozen, reference-only)
// ---------------------------------------------------------------------------

/** The per-rail transport retry policy (bounded, backoff, deadline-aware). */
export interface RailRetryPolicy {
  /** Total attempt bound (1 = never retransmit; hard max MAX_RETRY_ATTEMPTS_BOUND). */
  readonly maxAttempts: number;
  /** Exponential-backoff base in ms (delay = min(base * 2^(attempt-1), backoffMaxMs)). */
  readonly backoffBaseMs: number;
  /** The backoff cap in ms. */
  readonly backoffMaxMs: number;
}

/**
 * One resolved rail connectivity configuration — immutable (frozen at
 * resolution). Carries the host reference, the credential REFERENCE (a
 * name; never a value — no field for a value exists), the explicit
 * deadline budget, the bounded retry policy, and the scope tag the rail
 * may be used in.
 */
export interface ResolvedRailConfig {
  readonly railId: string;
  /** Where this rail may be used (must equal the runtime scope at binding). */
  readonly scopeTag: RailConnectivityScopeTag;
  /** The host reference (non-secret; URI-shaped or the simulated marker). */
  readonly hostRef: string;
  /** The credential reference NAME (production: required; sandbox: optional). */
  readonly credentialRef?: string;
  /** The transmission deadline budget in ms (explicit — no default). */
  readonly timeoutDeadlineMs: number;
  readonly retry: RailRetryPolicy;
}

// ---------------------------------------------------------------------------
// The typed resolution failures (fail-closed vocabulary)
// ---------------------------------------------------------------------------

/** The typed failure vocabulary of the resolver (DEP-005-owned). */
export type RailConnectivityResolutionFailure =
  | { readonly code: 'RAIL_NOT_DECLARED'; readonly railId: string; readonly detail: string }
  | { readonly code: 'SCOPE_INVALID'; readonly detail: string }
  | { readonly code: 'HOST_MISSING'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string }
  | { readonly code: 'HOST_MALFORMED'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string; readonly detail: string }
  | { readonly code: 'TIMEOUT_MISSING'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string }
  | { readonly code: 'TIMEOUT_MALFORMED'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string; readonly detail: string }
  | { readonly code: 'CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION'; readonly railId: string; readonly variable: string; readonly detail: string }
  | { readonly code: 'CREDENTIAL_REF_MALFORMED'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string; readonly detail: string }
  | { readonly code: 'RETRY_MALFORMED'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string; readonly detail: string }
  | { readonly code: 'RETRY_OUT_OF_BOUND'; readonly railId: string; readonly scopeTag: RailConnectivityScopeTag; readonly variable: string; readonly detail: string }
  | { readonly code: 'SCOPE_MISMATCH'; readonly railId: string; readonly runtimeScope: RailConnectivityScopeTag; readonly oppositeScope: RailConnectivityScopeTag; readonly detail: string }
  | { readonly code: 'SCOPE_CONTAMINATION'; readonly railId: string; readonly detail: string };

/** The resolution result: typed failures (refuse to start) or the frozen configuration. */
export type RailConnectivityResolution =
  | { readonly ok: true; readonly scopeTag: RailConnectivityScopeTag; readonly rails: readonly ResolvedRailConfig[] }
  | { readonly ok: false; readonly failures: readonly RailConnectivityResolutionFailure[] };

/**
 * The fail-closed loading error: the composition root treats this as a
 * refusal to start the connectivity boundary (F6 — never guess, never
 * default a required value, never escalate a scope).
 */
export class RailConnectivityConfigurationError extends Error {
  public readonly failures: readonly RailConnectivityResolutionFailure[];

  constructor(failures: readonly RailConnectivityResolutionFailure[]) {
    const summary =
      failures.length === 1
        ? `rail connectivity configuration error: ${failures[0].code}`
        : `rail connectivity configuration errors (${failures.length}): ${failures
            .map((failure) => failure.code)
            .join(', ')}`;
    super(summary);
    this.name = 'RailConnectivityConfigurationError';
    this.failures = Object.freeze([...failures]);
  }
}

// ---------------------------------------------------------------------------
// The resolver (pure, total, deterministic)
// ---------------------------------------------------------------------------

/** The input contract: the injected environment, the runtime scope, the declared rails. */
export interface RailConnectivityResolutionInput {
  /** The process environment (injected; the family never reads process.env itself). */
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  /** The runtime scope (the composition root derives it from PAYSWAP_ENV via the frozen module). */
  readonly runtimeScope: RailConnectivityRuntimeScope;
  /**
   * The declared rail registry (rail ids, lower-case alphanumeric-with-dashes
   * form). Only declared rails resolve; the closed-list discipline
   * (configuration.md: "anything not listed is not configurable").
   */
  readonly declaredRails: readonly RailDeclaration[];
}

/** One declared rail: the id plus whether a credential reference is expected. */
export interface RailDeclaration {
  readonly railId: string;
}

const RAIL_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HOST_REF_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+$|^[A-Za-z0-9][A-Za-z0-9._:-]+$/;

function railSegment(railId: string): string {
  return railId.toUpperCase().replaceAll('-', '_');
}

function variableName(scopeSegment: RailConnectivityScopeSegment, railId: string, suffix: string): string {
  return `PAYSWAP_RAIL_${scopeSegment}_${railSegment(railId)}_${suffix}`;
}

function parsePositiveSafeInteger(
  raw: string | undefined,
): { ok: true; value: number } | { ok: false; detail: string } {
  if (raw === undefined || raw.length === 0) {
    return { ok: false, detail: 'value is missing or empty' };
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, detail: `value ${JSON.stringify(raw)} is not a positive safe integer` };
  }
  return { ok: true, value: parsed };
}

/**
 * Resolve the rail connectivity configuration for one runtime scope. PURE
 * and deterministic: a pure function of (processEnv, runtimeScope,
 * declaredRails). Returns typed failures for every malformed, missing,
 * cross-scoped or contradictory input — the composition root refuses to
 * start the connectivity boundary on any failure (fail-closed, F6).
 *
 * Scope isolation is enforced here (see the module doc): only the matching
 * {SCOPE} prefix is resolved; opposite-scope-only rails are refused
 * (SCOPE_MISMATCH); both-scope rails are refused (SCOPE_CONTAMINATION).
 * Production rails additionally require the credential REFERENCE to be
 * present (CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION) — adapters fail closed
 * without credentials (F6).
 *
 * Source: configuration.md S1-S5 + the closed-list rule; environments.md
 * F1-F8; topology.md (credentials only in the production secret scope).
 */
export function resolveRailConnectivityConfig(
  input: RailConnectivityResolutionInput,
): RailConnectivityResolution {
  const failures: RailConnectivityResolutionFailure[] = [];

  // The runtime scope itself must be a legal allowlist member.
  if (!isRailConnectivityScopeTag(input.runtimeScope.scope)) {
    return {
      ok: false,
      failures: [
        {
          code: 'SCOPE_INVALID',
          detail: `runtime scope ${JSON.stringify(input.runtimeScope.scope)} is not in the frozen allowlist (sandbox | production)`,
        },
      ],
    };
  }
  const runtimeScope = input.runtimeScope.scope;
  const scopeSegment: RailConnectivityScopeSegment = runtimeScope === 'production' ? 'PRODUCTION' : 'SANDBOX';
  const oppositeSegment: RailConnectivityScopeSegment = runtimeScope === 'production' ? 'SANDBOX' : 'PRODUCTION';
  const oppositeScope: RailConnectivityScopeTag = runtimeScope === 'production' ? 'sandbox' : 'production';

  const rails: ResolvedRailConfig[] = [];

  for (const declaration of input.declaredRails) {
    const railId = declaration.railId;
    if (typeof railId !== 'string' || !RAIL_ID_PATTERN.test(railId)) {
      failures.push({
        code: 'RAIL_NOT_DECLARED',
        railId: String(railId),
        detail: `rail id must match ${RAIL_ID_PATTERN} (lower-case kebab)`,
      });
      continue;
    }

    // ---- the scope-isolation proofs -------------------------------------
    const ownHostVar = variableName(scopeSegment, railId, 'HOST');
    const oppositeHostVar = variableName(oppositeSegment, railId, 'HOST');
    const ownHostPresent = input.processEnv[ownHostVar] !== undefined && input.processEnv[ownHostVar] !== '';
    const oppositeHostPresent =
      input.processEnv[oppositeHostVar] !== undefined && input.processEnv[oppositeHostVar] !== '';

    if (ownHostPresent && oppositeHostPresent) {
      // The rail is configured under BOTH scope prefixes in this process
      // environment: contamination — one rail may never be simultaneously
      // sandbox- and production-configured in one process.
      failures.push({
        code: 'SCOPE_CONTAMINATION',
        railId,
        detail: `rail ${railId} is configured under BOTH scope prefixes in this process environment (${ownHostVar}=set, ${oppositeHostVar}=set) — sandbox and production rail configuration cannot coexist`,
      });
      continue;
    }
    if (!ownHostPresent) {
      // Not configured under the runtime scope. If the OPPOSITE-scope
      // evidence exists at all, this is a scope mismatch; otherwise the
      // rail is simply missing its required configuration.
      const oppositeTimeoutVar = variableName(oppositeSegment, railId, 'TIMEOUT_MS');
      const oppositeCredentialVar = variableName(oppositeSegment, railId, 'CREDENTIAL_REF');
      const oppositeEvidence =
        oppositeHostPresent ||
        (input.processEnv[oppositeTimeoutVar] !== undefined && input.processEnv[oppositeTimeoutVar] !== '') ||
        (input.processEnv[oppositeCredentialVar] !== undefined && input.processEnv[oppositeCredentialVar] !== '');
      if (oppositeEvidence) {
        failures.push({
          code: 'SCOPE_MISMATCH',
          railId,
          runtimeScope,
          oppositeScope,
          detail: `rail ${railId} is configured only under the ${oppositeScope} scope prefix while the runtime scope is ${runtimeScope} — cross-scope resolution is refused (a ${runtimeScope} process cannot bind a ${oppositeScope}-scoped rail)`,
        });
      } else {
        failures.push({
          code: 'HOST_MISSING',
          railId,
          scopeTag: runtimeScope,
          variable: ownHostVar,
        });
      }
      continue;
    }

    // ---- host reference --------------------------------------------------
    const hostVar = ownHostVar;
    const hostRef = input.processEnv[hostVar] ?? '';
    if (!HOST_REF_PATTERN.test(hostRef)) {
      failures.push({
        code: 'HOST_MALFORMED',
        railId,
        scopeTag: runtimeScope,
        variable: hostVar,
        detail: `host reference must be URI-shaped or a symbolic reference (got ${JSON.stringify(hostRef)})`,
      });
      continue;
    }
    if (runtimeScope === 'sandbox' && hostRef !== IN_PROCESS_SIMULATED_HOST_MARKER && !hostRef.startsWith('sandbox:')) {
      // F5: sandbox rails bind simulated transports — a sandbox host
      // reference must be the documented simulated marker or an explicit
      // sandbox-namespaced reference; anything else would smuggle a real
      // endpoint into the sandbox.
      failures.push({
        code: 'HOST_MALFORMED',
        railId,
        scopeTag: runtimeScope,
        variable: hostVar,
        detail: `sandbox rails bind the simulated transport only: the host reference must be "${IN_PROCESS_SIMULATED_HOST_MARKER}" or a sandbox-namespaced reference (got ${JSON.stringify(hostRef)})`,
      });
      continue;
    }

    // ---- timeout (explicit, required, no default) -------------------------
    const timeoutVar = variableName(scopeSegment, railId, 'TIMEOUT_MS');
    const timeoutRaw = input.processEnv[timeoutVar];
    if (timeoutRaw === undefined || timeoutRaw.length === 0) {
      failures.push({
        code: 'TIMEOUT_MISSING',
        railId,
        scopeTag: runtimeScope,
        variable: timeoutVar,
      });
      continue;
    }
    const timeoutParsed = parsePositiveSafeInteger(timeoutRaw);
    if (!timeoutParsed.ok) {
      failures.push({
        code: 'TIMEOUT_MALFORMED',
        railId,
        scopeTag: runtimeScope,
        variable: timeoutVar,
        detail: timeoutParsed.detail,
      });
      continue;
    }

    // ---- credential reference (name only — never a value) -----------------
    const credentialVar = variableName(scopeSegment, railId, 'CREDENTIAL_REF');
    const credentialRaw = input.processEnv[credentialVar];
    let credentialRef: string | undefined;
    if (credentialRaw === undefined || credentialRaw.length === 0) {
      if (runtimeScope === 'production') {
        // F6: production adapters fail closed without credentials.
        failures.push({
          code: 'CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION',
          railId,
          variable: credentialVar,
          detail: `production rail ${railId} requires the credential reference ${credentialVar} (adapters fail closed without credentials — environments.md F6); the reference NAME is required at resolution; the VALUE lives only in the production secret scope`,
        });
        continue;
      }
      credentialRef = undefined; // F5: sandbox simulated rails need no credentials.
    } else {
      if (!CREDENTIAL_REF_PATTERN.test(credentialRaw)) {
        failures.push({
          code: 'CREDENTIAL_REF_MALFORMED',
          railId,
          scopeTag: runtimeScope,
          variable: credentialVar,
          detail: `credential reference must be a reference NAME (alphanumeric with . _ : - separators; got ${JSON.stringify(credentialRaw)}) — never a credential value`,
        });
        continue;
      }
      credentialRef = credentialRaw;
    }

    // ---- retry policy (bounded, defaulted, validated) ----------------------
    const maxAttemptsVar = variableName(scopeSegment, railId, 'RETRY_MAX_ATTEMPTS');
    const backoffVar = variableName(scopeSegment, railId, 'RETRY_BACKOFF_BASE_MS');
    let maxAttempts = DEFAULT_RETRY_MAX_ATTEMPTS;
    if (input.processEnv[maxAttemptsVar] !== undefined && (input.processEnv[maxAttemptsVar] ?? '').length > 0) {
      const parsed = parsePositiveSafeInteger(input.processEnv[maxAttemptsVar]);
      if (!parsed.ok) {
        failures.push({
          code: 'RETRY_MALFORMED',
          railId,
          scopeTag: runtimeScope,
          variable: maxAttemptsVar,
          detail: parsed.detail,
        });
        continue;
      }
      if (parsed.value > MAX_RETRY_ATTEMPTS_BOUND) {
        failures.push({
          code: 'RETRY_OUT_OF_BOUND',
          railId,
          scopeTag: runtimeScope,
          variable: maxAttemptsVar,
          detail: `retry max attempts must be <= ${MAX_RETRY_ATTEMPTS_BOUND} (got ${parsed.value})`,
        });
        continue;
      }
      maxAttempts = parsed.value;
    }
    let backoffBaseMs = DEFAULT_RETRY_BACKOFF_BASE_MS;
    if (input.processEnv[backoffVar] !== undefined && (input.processEnv[backoffVar] ?? '').length > 0) {
      const parsed = parsePositiveSafeInteger(input.processEnv[backoffVar]);
      if (!parsed.ok) {
        failures.push({
          code: 'RETRY_MALFORMED',
          railId,
          scopeTag: runtimeScope,
          variable: backoffVar,
          detail: parsed.detail,
        });
        continue;
      }
      backoffBaseMs = parsed.value;
    }

    const resolved: ResolvedRailConfig = Object.freeze({
      railId,
      scopeTag: runtimeScope,
      hostRef,
      ...(credentialRef === undefined ? {} : { credentialRef }),
      timeoutDeadlineMs: timeoutParsed.value,
      retry: Object.freeze({
        maxAttempts,
        backoffBaseMs,
        backoffMaxMs: DEFAULT_RETRY_BACKOFF_MAX_MS,
      }),
    });
    rails.push(resolved);
  }

  if (failures.length > 0) {
    return { ok: false, failures: Object.freeze(failures) };
  }
  return { ok: true, scopeTag: runtimeScope, rails: Object.freeze(rails) };
}

/**
 * The fail-closed load: resolve and THROW on any failure — the composition
 * root's refuse-to-start form (the in-process realization of "malformed or
 * missing configuration refuses to start"; F6).
 *
 * Source: DEP-005 work order acceptance; environments.md F6.
 */
export function loadRailConnectivityConfigOrThrow(
  input: RailConnectivityResolutionInput,
): readonly ResolvedRailConfig[] {
  const resolution = resolveRailConnectivityConfig(input);
  if (!resolution.ok) {
    throw new RailConnectivityConfigurationError(resolution.failures);
  }
  return resolution.rails;
}

/**
 * The scope-tag re-check every binding performs (belt-and-suspenders guard
 * #5 in the module doc): a resolved rail may bind ONLY in the runtime scope
 * whose tag it carries. Returns the typed rejection when the tags disagree.
 *
 * Source: the cross-contamination acceptance (DEP-005.md); environments.md
 * (the sandbox/production separation).
 */
export function assertRailScopeMatchesRuntime(
  rail: ResolvedRailConfig,
  runtimeScope: RailConnectivityScopeTag,
): { ok: true } | { ok: false; code: 'SCOPE_MISMATCH'; detail: string } {
  if (rail.scopeTag !== runtimeScope) {
    return {
      ok: false,
      code: 'SCOPE_MISMATCH',
      detail: `rail ${rail.railId} is scoped ${rail.scopeTag} but the runtime scope is ${runtimeScope} — cross-scope binding is refused`,
    };
  }
  return { ok: true };
}
