# DEP-005 — Rail connectivity evidence: the external rail connectivity boundary

Work order: `spec/system-work-orders/DEP-005.md` — "Operationalize external
rails safely while preserving the frozen adapter, execution,
reconciliation and evidence authorities."

This document is the rail-connectivity family's evidence surface (alongside
the family barrel `src/lib/rail-connectivity/index.ts` and the evidence
harness `scripts/test_rail_connectivity.mjs`). It records WHAT the boundary
does, the disciplines that make it safe, the conservative mapping into the
frozen A13 vocabulary, and the honest future-work boundaries.

- Base: main @ 5bda6c02a6302461908a5601da5b49f655a489c1 (the composed
  protocol runtime + the DEP-004 operational-jobs layer: RTN-001..012 +
  DEP-003/DEP-004 merged — the wave barrel
  `src/lib/protocol-runtime/index.ts` documents the composed surface).
- Form: in-process first (the DEP-001/002/003/RTN-012/DEP-004 precedent)
  — the boundary runs inside the web-api-boundary application as module
  surfaces: a typed transport port (an injected primitive), the
  environment-scoped configuration resolver, the retry/deadline safeguard
  engine, and the adapter-activity observability surface, composed into the
  FROZEN A13 `RailAdapterConnection` interface. The real network transport
  client, the production credential binding (secret-store dereference) and
  the externalized adapter-fleet process binding are recorded FUTURE-WORK
  in the deployment contract trio (updated together in this work item:
  `deploy/contracts/components.json` + `spec/deployment/topology.md` +
  `spec/deployment/configuration.md` + `scripts/validate_deployment.py`).
- Harness: `scripts/test_rail_connectivity.mjs` (plain Node ≥ 22.6, type
  stripping; node:sqlite only for the durable-journal scenario; exit 0 =
  all scenarios green).

## The boundary surface (what DEP-005 owns)

| Module | Duty | The work-order acceptance it delivers |
|---|---|---|
| `transport.ts` | the typed adapter-transport port: the request contract (absolute deadline + rail idempotency key + correlation ids) and the explicit result quadruple — `delivered-with-report` \| `timeout` \| `transport-failure` (typed reason taxonomy, phase-classified) \| `UNKNOWN` | "Timeouts and failures are explicit" — there is NO implicit success: every call resolves to exactly one typed outcome |
| `configuration.ts` | the environment-scoped per-rail resolver: `PAYSWAP_RAIL_{SCOPE}_{RAIL}_{HOST, CREDENTIAL_REF, TIMEOUT_MS, RETRY_*}` — shape validation, fail-closed loading, scope tags, cross-scope resolution refusals | "Credentials/configuration are environment-scoped"; "Sandbox and production rail credentials/hosts cannot cross-contaminate" |
| `retry.ts` | the safeguard engine: same-key retransmission only (INV-13-3), bounded, exponential backoff, deadline-aware, explicitly-retryable pre-effect failures only | "Retries respect existing idempotency rules"; the forbidden "blind UNKNOWN retry" is structurally impossible |
| `activity.ts` | the structured adapter-activity records (rail, key, outcome, latency, correlation, typed reason, deadline, attempt ordinal), queryable, dual-written to `durable_events` under owner `rail-connectivity` | "Adapter activity is observable and auditable" |
| `boundary.ts` | the composition: transport + config + retry + activity wrapped into the frozen `RailAdapterConnection` (adapter-local payload validation; the conservative frozen-vocabulary mapping; the binding-time scope re-check) | "External UNKNOWN is never translated to failure or success without reconciliation" — the mapping is conservative and machine-checked |

The boundary NEVER admits protocol commands (no gateway import — the
protocol-gateway stays the sole admission point), NEVER writes
authoritative state (no authority/store/persistence import — the
transition runtime stays the single writer; RailAdapter/RailOperation
state advances only through the A13 command surface, per the Q1/delta-1
ruling), NEVER performs network egress in the repository (the transport
primitive is an injected port; the harness binds deterministic doubles),
and NEVER holds a credential value (the resolver records REFERENCE names
only). All five disciplines are machine-checked by the harness's
static-discipline scan.

## The disciplines (mapped to the work order's acceptance criteria)

1. **Credentials/configuration are environment-scoped.** The resolver is a
   pure function of (injected environment, runtime scope, declared rails).
   The runtime scope comes from `PAYSWAP_ENV` through the frozen
   `src/lib/environment.ts` module (F1 allowlist `sandbox | production`;
   the family itself never reads `process.env`). Every resolved rail
   carries an explicit `scopeTag`; the resolver returns ONLY rails whose
   tag equals the runtime scope; the binder re-checks at binding time.

2. **Timeouts and failures are explicit.** Every transport call carries an
   absolute deadline; the engine never issues an attempt at/past it and
   never guesses an outcome after it — a deadline violation resolves the
   typed `timeout` result. Every transport failure carries one of the
   seven typed taxonomy reasons with its frozen phase classification
   (`pre-effect` — provably no external effect — vs `in-flight` —
   indeterminate). The per-rail `TIMEOUT_MS` is REQUIRED configuration
   (no default: explicitness is the contract).

3. **External UNKNOWN is never translated.** The explicit `UNKNOWN`
   transport result (an unclassifiable rail answer) maps to the A13
   UNKNOWN outcome class and surfaces upward verbatim; the A14
   reconciliation path owns the resolution (GC-2 / INV-14-4's
   no-guessing rule). The engine never retransmits after UNKNOWN; the
   harness proves both properties (the port's call count stays at 1; the
   composed A13 authority auto-opens the INV-14-1 case exactly as with the
   simulated adapter).

4. **Retries respect existing idempotency rules.** A retransmission
   re-sends the EXACT (idempotencyKey, payload, payloadHash) triple —
   never a re-derived identity — so INV-13-3's rail-side collapse makes
   the retry harmless (there is never a second external effect for one
   key). Retries are bounded (`maxAttempts` ≤ 10), backoff-scheduled (the
   pure exponential `min(base·2^(n−1), cap)`), deadline-aware (a
   retransmission is issued only when `now + backoff < deadline`), and
   restricted to explicitly-retryable pre-effect failures (DNS, host
   unreachable, connect refused, TLS handshake). A credential refusal is
   pre-effect but NOT retryable (retrying cannot fix configuration —
   fail-closed F6); in-flight failures are NEVER retried (their external
   effect is indeterminate).

5. **Adapter activity is observable and auditable.** One structured record
   per consequential event (every attempt, every resolution, every report
   fetch, the configuration resolution), each carrying the rail, the
   idempotency key, the outcome, the latency, the correlation ids, the
   typed failure reason, the deadline and the attempt ordinal. The log is
   queryable by rail / key / outcome / window, and dual-writes to the
   DEP-003 `durable_events` journal under owner `rail-connectivity` when
   a journal is bound (the DEP-004 owner-identity precedent; the family
   writes no A15 records directly — the A15 vocabulary is closed to
   registry authorities, and this family hosts none).

6. **Sandbox and production cannot cross-contaminate.** Four structural
   proofs, each machine-checked: (a) a declared rail configured only
   under the opposite scope prefix is REFUSED (`SCOPE_MISMATCH` — a
   sandbox process cannot bind a production-scoped rail's host or
   credential reference, and vice versa); (b) a rail configured under
   BOTH scope prefixes in one process environment is REFUSED
   (`SCOPE_CONTAMINATION`); (c) every resolved configuration carries the
   matching `scopeTag`; (d) the binder re-checks the tag and refuses
   cross-scope binding. Production rails additionally require the
   credential REFERENCE name to be present (F6 fail-closed); sandbox
   rails must bind the simulated transport (F5: the sandbox host
   reference is the documented `in-process:simulated` marker or a
   `sandbox:`-namespaced reference — a real endpoint cannot be smuggled
   into the sandbox scope).

## The conservative mapping into the frozen A13 vocabulary

The boundary adds NO protocol reason codes (the rails vocabulary is
frozen: "No member may be added without a cited spec line" —
`rails/reason-codes.ts`). Only frozen codes enter the A13 interface:

| Transport result | A13 outcome | Reason code (frozen) |
|---|---|---|
| `delivered-with-report` | `ACCEPTED { railReferences, duplicate }` | — (the envelope's class is the rail's own assertion, INV-13-4) |
| `timeout` | `UNKNOWN` | `TIMEOUT` |
| `transport-failure` (pre-effect, retry exhausted or non-retryable) | `UNKNOWN` | `CONNECTION_LOSS` |
| `transport-failure` (in-flight) | `UNKNOWN` | `CONNECTION_LOSS` |
| `UNKNOWN` | `UNKNOWN` | `AMBIGUOUS_RAIL_RESPONSE` |
| adapter-local payload validation failure | `REJECTED` | `PAYLOAD_MALFORMED` |
| `fetchReport` silence | UNKNOWN envelope | `SILENCE` |

The conservatism is deliberate: where the boundary privately knows a
failure was pre-effect, it still maps UNKNOWN-class at the protocol seam —
UNKNOWN is the no-guessing catch-all and reconciliation is the designed
resolution path; the precise transport taxonomy (DNS vs TLS vs in-flight
loss) and the retry trail live in the boundary's own typed results and
activity records, never in protocol state. The harness machine-checks the
full table.

## The composition (how the boundary composes onto the runtime)

```
PAYSWAP_ENV ──(frozen src/lib/environment.ts)──► runtime scope
   processEnv + declared rails
        │
        ▼ resolveRailConnectivityConfig          (typed failures refuse the start, F6)
   ResolvedRailConfig[]  (scope-tagged, frozen, reference-only)
        │
        ▼ createAdapterActivityLog({ audit })    (query surface + durable_events dual-write)
   transportFactory(rail) → RailTransportPort    (the root binds the primitive: harness doubles
        │                                        today; the real network client FUTURE-WORK)
        ▼ createConnectivityBoundary             (scope re-check at binding)
   Map<railId, RailAdapterConnection>            ← THE FROZEN INTERFACE
        │
        ▼ consumed exactly as the simulated adapter:
   A13 submitRailOperation(operationId, connection)   (the only external-effect path)
   A12 submitAttempt(instructionId, connection)        (the settlement composition)
```

The evidence harness realizes this order end-to-end: the A13 authority's
`submitRailOperation` consumes the connectivity-bound connection over a
scripted transport double, landing AUTHORIZED → SUBMITTED → PENDING /
UNKNOWN exactly as with the protocol-owned simulated adapter — plus the
INV-14-1 auto-case on the UNKNOWN path.

## The honest future work (recorded in the deployment contract)

1. **The real transport primitive.** The repository binds deterministic
   in-process transport doubles (the harness). The real network client
   (HTTP/TLS, signing, provider protocols) is the externalized production
   binding — FUTURE-WORK in `deploy/contracts/components.json`
   (`external-rail-adapters.future_work`), exactly as every other
   externalized process binding in the contract. The port's synchrony
   matches the frozen in-process interface; the async transport form
   belongs to the externalized binding.
2. **Production credential binding.** The resolver records credential
   REFERENCE names only; dereferencing them against the deployment-owned
   secret store, and the credentials themselves, exist solely in the
   production secret scope (S2/F4/F6) — never in the repository, work-item
   text, tests or reports.
3. **DEP-002+ observability binding.** The adapter-activity query surface
   is the programmatic contract; binding it to metrics endpoints and
   alerting (circuit state, rail reachability, acknowledgment rate) is the
   recorded DEP-002+ deployment work.

## The harness scenarios (`scripts/test_rail_connectivity.mjs`)

| Scenario | Proves |
|---|---|
| `test:family-barrel` | the family barrel loads under plain Node; the static discipline scan (no authority/gateway/store imports, no network primitives, no secret-shaped strings in the family source) |
| `test:configuration-resolution` | the env-scoped resolution happy path; every typed failure (missing host, malformed host/timeout/retry, missing timeout, production credential-ref requirement, invalid rail ids) |
| `test:scope-isolation` | THE credential/host isolation proof: opposite-scope refusal, both-scope contamination refusal, matching scope tags, the binding-time re-check, and no credential VALUES anywhere in the resolved configuration |
| `test:timeout-explicitness` | the deadline discipline: elapsed-before-start, in-transport exhaustion, the typed `timeout` result, the A13 `UNKNOWN`/`TIMEOUT` mapping |
| `test:failure-taxonomy` | all seven typed reasons, their phase/retryable classification, non-retryable surfacing, and the frozen-vocabulary-only mapping table |
| `test:unknown-never-translated` | THE UNKNOWN discipline: the engine never retransmits after UNKNOWN; the boundary maps UNKNOWN-class only; the REAL A13 authority lands the operation UNKNOWN and auto-opens the INV-14-1 case (the A14 reconciliation path engages — never a retry) |
| `test:retry-idempotency` | same-key retransmission (byte-identical request across attempts), bounded attempts, the pure backoff schedule, the deadline-aware cutoff, exhaustion surfacing, and the rail-side COLLAPSE of the retransmitted key (INV-13-3) |
| `test:adapter-observability` | the structured activity records (rail/key/outcome/latency/correlation/reason/deadline/attempt), the query axes, the durable journal rows under owner `rail-connectivity` on the REAL DEP-003 substrate, and the no-credential-value audit scan |
| `test:composed-journey` | the frozen seam: the REAL A13 authority consumes the connectivity-bound connection — delivered (ACCEPTED → PENDING), payload-malformed (REJECTED before any transmission), timeout (UNKNOWN + INV-14-1 case) |
| `test:determinism` | the whole scenario battery runs twice; the transcripts are identical (GC-1) |
