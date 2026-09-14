# PC-005 evidence — developer controls, credentials, webhooks, logs, and docs

**Task:** PC-005 (spec/console-work-orders/PC-005.md)
**Branch:** `pc-005/developer-controls`
**Parent revision:** `3ddcede` (frontier after PC-004 merged + Lead registry flip)
**Design:** docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md (APPROVED) — §11 (developer controls/credentials), §14 (documentation in the shell)
**Delivery:** families 1–2 by the original worker (timed out mid-family-3); family 3 finished, audited, and fixed + families 4–5 by the finisher worker

## 1. Credential / redaction / audit architecture (the §11 rulings, as implemented)

- **The dedicated credential boundary (family 2, commit 3cc2d79).** All
  credential operations cross one server boundary —
  `POST/GET/DELETE /api/console/developers/api-keys` and
  `…/webhooks` (`src/app/api/console/developers/`). The boundary order is
  design §8: server-side role check FIRST (fail-closed 404 `{ok:false}` with
  no content — the console never confirms the module's existence to a caller
  outside the frozen merchant-only grant), then the operation, then the
  response envelope `{ok, principal, environment, result}` (the PC-003 outer
  shape, reused through `consoleDeveloperWriteResponseBody`).
- **Secret-once, structurally.** Plaintext tokens
  (`payswap_dev_…`) and signing secrets (`payswap_whsec_…`) are generated
  server-side with `node:crypto` random bytes — a client can never ask the
  store to persist a chosen secret. The store keeps ONLY a SHA-256 digest
  (`api-key-store.ts` / `webhook-store.ts` internal records); the public view
  drops the digest by construction, so no later read (list, audit, log,
  inspector) can re-display the secret. The plaintext crosses the wire
  exactly once: JSON mode returns it in the creation response with the
  honest note; form mode (the console's plain-HTML POST) redirects 303 with
  an opaque ONE-TIME receipt (`creation-receipt.ts`) whose consumption is
  destructive (delete-first), so the page renders the secret exactly once and
  a replayed receipt renders the honest "already shown / expired" state.
  Receipt ids never enter the request log (the boundary logs the pathname
  without the query string).
- **Redaction before storage (the logs/inspector contract).** The diagnostic
  ring (`request-log-store.ts`) is the one place request entries are built,
  and the build passes payload AND path/method strings through the EXISTING
  fail-closed primitive `scrubCredentialReferences`
  (`src/lib/observability/logging.ts`) BEFORE the entry is stored. The
  stored entry is therefore already redacted — there is no code path that
  can render an unredacted payload, because it was never stored. Tests
  assert ON THE STORED ENTRIES (page tests re-assert the rendered form is
  the scrubbed one). The credential-boundary ingestion is additionally
  payload-free BY CONSTRUCTION (`ingestConsoleBoundaryRequest` in
  `api-boundary.ts` — the data is exactly `{outcome}`).
- **Explicit, audited revocation.** One audit-trail entry per mutation
  (`audit-trail.ts`, actions `api-key.created` / `api-key.revoked` /
  `webhook-endpoint.created` / `webhook-endpoint.revoked`), rendered
  secret-free on the pages. Revocation is explicit (a per-record form or
  `DELETE ?id=`), double-revoke fails closed (409), unknown ids fail closed
  (404), and an invalid label/url records NOTHING (422).
- **Environment scope is server-derived only.** Every credential context is
  `{role, environment: getConsoleEnvironmentContext().kind}` — derived per
  call from the PC-001 no-input authority. Listing shows only the current
  server-derived environment's records. Spoofed `?env=production` selectors
  are structurally ignored (proven by route tests and page tests); the
  environments page renders the whole chain read-only and there is no
  switching control anywhere in the console.
- **The in-memory ruling, stated everywhere.** No credential/webhook/request-log
  persistence exists at this baseline and developer controls are not
  financial truth (design §11), so the stores are module-scoped process
  state — and every surface renders the honest provenance note verbatim
  (`developer-provenance.ts` through `DeveloperProvenanceNote`): in-memory,
  cleared on restart, never protocol evidence.
- **Webhook event identifiers reference the real vocabularies only.** The
  catalog (`webhook-events.ts`) imports the frozen observability taxonomy
  (`OBSERVABILITY_DOMAINS`/`DOMAIN_DEFINITIONS`) and records the durable
  substrate job-lifecycle event types as documented strings verified
  against the real source file text by test (the console governance
  boundary forbids importing `src/lib/durable/events.ts`). The honest
  delivery state is stated, never simulated: NO delivery worker exists;
  retries must never imply protocol replay or duplicate financial effects.

## 2. Composition map (family 3, commit 2a80687)

Every developer page is guard (`requireConsoleRoute` — registry-derived
merchant-only) → PC-005 read model → presentation-only view:

| Surface | Route | View (`src/components/console/developers/`) | Read model (`src/lib/console/developers/read-models.ts`) | Backing store |
|---|---|---|---|---|
| API keys | `/console/developers/api-keys` | `ConsoleDeveloperApiKeysView` (+ `DeveloperSecretOncePanel` / `DeveloperSecretAlreadyShownNote`) | `readConsoleDeveloperApiKeys(role)` | `getDeveloperApiKeyStore()` + the one-time receipt store |
| Webhooks | `/console/developers/webhooks` | `ConsoleDeveloperWebhooksView` | `readConsoleDeveloperWebhooks(role)` | `getDeveloperWebhookStore()` + `CONSOLE_WEBHOOK_EVENT_CATALOG` |
| Logs | `/console/developers/logs` | `ConsoleDeveloperRequestLogsView` | `readConsoleDeveloperRequestLogs()` | the diagnostic ring (`getDeveloperRequestLogStore()`), normalized through the PC-003 exported seam `normalizeDeveloperRequestRecord` |
| Request inspector | `/console/developers/request-inspector` | `ConsoleDeveloperRequestInspectorView` | `readConsoleDeveloperRequestInspector(filter)` (server-side path/status presentation filtering only) | the same ring |
| Environments | `/console/developers/environments` | `ConsoleDeveloperEnvironmentsView` | `readConsoleDeveloperEnvironments()` (NO input) | the PC-001 context chain (`getConsoleEnvironmentContext()`) |

The pages consume the one-time receipt mechanism server-side: the receipt is
consumed destructively in the page (not passed to the client), so the
plaintext renders exactly once; the boundary's error flag is re-scrubbed
defensively before it touches markup (`boundaryErrorFlag`).

## 3. Finisher audit of the timed-out predecessor's uncommitted work

The predecessor left family 3 uncommitted (5 pages modified, the components
directory and one page test untracked). Audit verdict: **KEPT — one real
defect fixed.**

- The pages consumed the committed read models correctly (guard first, read
  composition, envelope rendering, provenance hoisted out of the value
  branch in both views that have branch-dependent content); the components
  matched the PC-004 view conventions (envelope renderer, authority
  attribution line, honest empty VALUEs). No rewrite was needed.
- ONE failing test: the api-keys page test's spoofed-env case asserted on
  `data-testid="console-api-key-environment"`, which only renders when a key
  EXISTS — the test rendered an empty registry. Fixed by creating a key
  through the real store first (the fix strengthens the proof: the listed
  key renders the server-derived sandbox even while `?env=production` rides
  the request).
- Added the four missing page test files (webhooks / environments / logs /
  request-inspector) to complete the required coverage (role isolation per
  surface, environment scope + spoofed-selector ignorance, creation /
  one-time secret / explicit audited revocation, redaction asserted on
  stored entries, webhook catalog from the real vocabularies).

## 4. Documentation decisions (family 4, commit b3bce2e)

| Page | Content source | Labels |
|---|---|---|
| `/console/documentation/api` | `api/route-inventory.ts` — all 19 route files under `src/app/api/**`, hand-summaries of each route's own declarations; set-equality with the filesystem is test-enforced in BOTH directions (methods + source files verified) | (reference — no runnable requests; conventions stated per entry) |
| `/console/documentation/concepts` | `concepts/spec-links.ts` — the frozen architecture's 8 files in the index's own reading order + GC-1..GC-7 as one-line pointers; every referenced path test-verified to exist on disk | (links only — never duplicates or re-interprets area semantics) |
| `/console/documentation/examples` | `examples/example-set.ts` — 8 executable curl examples against real routes with the handlers' honest responses (liveness, readiness, the malformed-json refusal, the missing-parameters receipt lookup, the audience switch, console contracts/api-keys reads + creation) and 3 illustrative shapes | every card: **Executable — runs against a live server exactly as shown**, or **Illustrative — shape only, not runnable as-is** with the stated reason (incl. the no-delivery-worker absence) |
| `/console/documentation/guides` | the surfaces that actually exist, walked in meeting order (audience → overview → credentials → webhooks → logs/inspector → environments → deeper docs), with the honest-baseline panel up front | all internal links are registry routes (test-verified); one route-role-matrix repo path is quoted as a repo path |

The four pages remain guarded (`requireConsoleRoute` — the frozen ALL_ROLES
documentation grant; unauthenticated viewers are redirected). The registry
status flip to `available` remains a Lead-governed merge-time action; the
route-inventory test (`console-routes.test.ts`) records the composed hrefs.

## 5. Verification transcript (finisher battery, branch tip)

- `bun run typecheck` — **0 errors**.
- `bun test src/app/console/developers/ src/app/console/documentation/
  src/lib/console/developers/ src/components/console/developers/
  src/app/api/console/developers/` — **103 pass / 0 fail** (15 files,
  800 expect() calls).
- `bun test` (full suite) — **2342 pass / 0 fail** across 151 files
  (baseline 2240 + 102 PC-005 tests; zero new failures).
- `bun run build` — **success** (`✓ Compiled successfully`, 43/43 static
  pages; the full frozen IA route tree including the 5 developer + 4
  documentation routes live as dynamic routes).

Test-seam discipline (the PC-004 precedent): page tests mock ONLY
`next/headers`; every page composes the REAL read models over the REAL
in-memory stores, reset per test through `store-reset.ts` (order-independent
by construction). No read-model module is mocked anywhere.

## 6. Recorded gaps and honest absences (by design)

- **No durable developer-control storage** — the design §11 ruling recorded
  here: developer controls are not financial truth, so inventing durable
  credential infrastructure the protocol does not sanction is out of scope.
  The stores are in-memory; every surface says so.
- **No webhook delivery worker** — endpoint registration and the event
  catalog exist; delivery attempts are not recorded and retries are not
  implemented (a retry must never imply protocol replay). Stated on the
  webhooks surface and in the illustrative example.
- **`/api/console/developers/requests` stays the PC-003 scaffold** — that
  route is PC-003-owned and was not modified (out of PC-005's sanctioned
  scope); it still answers its honest UNAVAILABLE branch. The PC-005
  surfaces supersede it at the page level by wiring the real in-memory ring
  the scaffold was waiting for; its recorded gap statement closes as an
  honest empty VALUE in the PC-005 reads.
- **No environment switching** — read-only everywhere; the signal is
  server-configuration-derived (fail-safe sandbox).
- The reconciliation-matrix developer-request-log row is filled (this work
  item) with the real implementation references; PC-007 reconciles the full
  matrix before program close.
