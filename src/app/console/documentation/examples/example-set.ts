/**
 * PC-005 — The documentation examples set, each labeled executable or
 * illustrative (design: documentation "clearly labels executable versus
 * illustrative examples").
 *
 *   - EXECUTABLE: the request runs against a running server exactly as
 *     shown (the documented base URL is a local dev server; responses are
 *     what the real route handlers answer — the route-inventory test
 *     verifies every referenced route path exists and the example module
 *     paths match the route files' exported methods).
 *   - ILLUSTRATIVE: marked prose — the SHAPE is shown to orient reading,
 *     with the honest reason it is not runnable as-is (no delivery worker
 *     exists; a submittable command envelope must name a registry
 *     authority; outcomes depend on authority state). Nothing illustrative
 *     is ever presented as runnable.
 */

export type DocumentationExampleKind = 'executable' | 'illustrative';

export interface DocumentationExample {
  readonly id: string;
  readonly kind: DocumentationExampleKind;
  readonly title: string;
  /** What the example demonstrates (prose). */
  readonly point: string;
  /** The request (or shape), verbatim as shown on the page. */
  readonly request: string;
  /** For executable examples: the response you get, honestly described. */
  readonly response?: string;
  /** For illustrative examples: WHY it is not runnable as-is. */
  readonly illustrativeBecause?: string;
  /** Route path(s) the example exercises (verified to exist by the test). */
  readonly routes: readonly string[];
}

export const DOCUMENTATION_EXAMPLES: readonly DocumentationExample[] = Object.freeze([
  {
    id: 'health-liveness',
    kind: 'executable',
    title: 'Liveness probe',
    point: 'The DEP-002 liveness pair: always 200 while the process serves, regardless of readiness.',
    request: 'curl http://localhost:3000/api/health',
    response: '200 {"status":"ok","component":"web-api-boundary","env":"sandbox"} (Cache-Control: no-store)',
    routes: ['/api/health'],
  },
  {
    id: 'ready-readiness',
    kind: 'executable',
    title: 'Readiness probe',
    point: 'The fail-closed startup configuration validation: names only, never values; 503 with the NAMED failing check ids when not ready.',
    request: 'curl http://localhost:3000/api/ready',
    response:
      '200 {"status":"ok",…,"checks":[…],"componentHealth":…} when configuration validates; 503 {"status":"not_ready",…,"failing":[…ids…]} when it does not',
    routes: ['/api/ready'],
  },
  {
    id: 'commands-malformed-json',
    kind: 'executable',
    title: 'Command admission — the honest transport-level refusal',
    point:
      'The one protocol-command admission point, called with a body that is not JSON: the refusal is typed and reaches no gateway — nothing was admitted and nothing was recorded.',
    request:
      "curl -X POST http://localhost:3000/api/protocol/commands -H 'content-type: application/json' -d 'not json'",
    response:
      '400 {"ok":false,"transportError":"malformed-json","problem":"The request body is not valid JSON — no submission reached the protocol gateway. …"}',
    routes: ['/api/protocol/commands'],
  },
  {
    id: 'commands-receipt-lookup-missing-params',
    kind: 'executable',
    title: 'Receipt lookup — missing parameters',
    point: 'The read-only idempotency-receipt query requires BOTH kind and idempotencyKey.',
    request: "curl 'http://localhost:3000/api/protocol/commands?kind=some-kind'",
    response:
      '400 {"ok":false,"transportError":"missing-lookup-parameters","problem":"Receipt lookup requires both query parameters: kind and idempotencyKey …"}',
    routes: ['/api/protocol/commands'],
  },
  {
    id: 'shell-audience-switch',
    kind: 'executable',
    title: 'Simulated shell audience switch',
    point:
      'The simulated authoritative audience signal (the shell harness): writes the session cookie for one declared audience. It grants no product capability by itself — every guarded surface still evaluates the signal on entry.',
    request:
      "curl -X POST http://localhost:3000/api/shell/audience -H 'content-type: application/json' -d '{\"audience\":\"merchant\"}'",
    response:
      '200 {"ok":true,…} and the payswap-shell-audience session cookie is set (invalid audiences are 400 invalid-audience)',
    routes: ['/api/shell/audience'],
  },
  {
    id: 'console-contracts-read',
    kind: 'executable',
    title: 'Console boundary read — the foundation contracts',
    point:
      'With the merchant audience cookie, the console boundary answers the frozen route/module registry summary and the server-derived environment report.',
    request: "curl -b 'payswap-shell-audience=merchant' http://localhost:3000/api/console/contracts",
    response:
      '200 {"ok":true,"principal":{"role":"merchant"},"environment":{…},"result":{…registry summary + environment report…}} — unauthenticated or role-denied callers get 404 {"ok":false} with no content',
    routes: ['/api/console/contracts'],
  },
  {
    id: 'console-api-keys-list',
    kind: 'executable',
    title: 'Developer credential list — secret-free by construction',
    point:
      'The PC-005 credential boundary (merchant-only): the list answers id/label/environment/created/revoked ONLY — the plaintext token is never in any later read.',
    request:
      "curl -b 'payswap-shell-audience=merchant' http://localhost:3000/api/console/developers/api-keys",
    response:
      '200 {"ok":true,…,"result":{…keys:[…id,label,environment,created,revoked…],audit:[…],provenance:…}} — every other role and unauthenticated callers get 404 {"ok":false}',
    routes: ['/api/console/developers/api-keys'],
  },
  {
    id: 'console-api-keys-create-json',
    kind: 'executable',
    title: 'Developer credential creation — the plaintext shown ONCE',
    point:
      'JSON-mode creation returns the plaintext token exactly once, with the honest note; the store keeps only a SHA-256 digest, so no later read can re-display it.',
    request:
      "curl -b 'payswap-shell-audience=merchant' -X POST http://localhost:3000/api/console/developers/api-keys -H 'content-type: application/json' -d '{\"label\":\"docs-example\"}'",
    response:
      '200 {"ok":true,…,"result":{"created":{"key":{…},"secret":"payswap_dev_…"},"note":"The plaintext token is shown this one time only. …"}} — an invalid label is 422 {"ok":false,"error":"invalid-label"} and records nothing',
    routes: ['/api/console/developers/api-keys'],
  },
  {
    id: 'commands-envelope-shape',
    kind: 'illustrative',
    title: 'Command envelope — the kernel shape',
    point:
      'What a submittable POST body to the admission point looks like structurally: the kernel CommandEnvelope fields.',
    request:
      '{\n  "kind": "<command kind registered by an owning authority>",\n  "authority": "<registry authority that hosts the command surface>",\n  "subjectIds": ["…"],\n  "idempotencyKey": "<unique per distinct submission>",\n  "protocolTime": "<kernel protocol time>",\n  "body": { /* the owning authority\'s registered command schema */ }\n}',
    illustrativeBecause:
      'Not runnable as-is: the kind, authority, subjectIds, and body must come from an authority that actually hosts a gateway command surface, and the admitted result (or typed refusal reasonCode) is the gateway\'s answer — never something a documentation page can promise. The malformed-json and missing-parameters examples above are the honest runnable forms of calling this boundary blind.',
    routes: ['/api/protocol/commands'],
  },
  {
    id: 'webhook-delivery-shape',
    kind: 'illustrative',
    title: 'Webhook delivery — what a delivery WOULD look like',
    point:
      'The shape a webhook delivery would take once a delivery worker exists as its own governed change: an event identifier from the real vocabularies plus the payload.',
    request:
      '{\n  "event": "job_succeeded",\n  "deliveredAt": "<wall-clock>",\n  "payload": { /* the event\'s own fields */ }\n}',
    illustrativeBecause:
      'Not runnable — and not implemented: NO delivery worker exists at this baseline. Delivery attempts are not recorded and retries are not implemented; a webhook retry must never imply protocol replay or duplicate financial effects. The event identifiers a delivery would reference are listed (with their owning vocabularies) on the webhooks page.',
    routes: ['/console/developers/webhooks'],
  },
  {
    id: 'mediation-dispute-shape',
    kind: 'illustrative',
    title: 'Dispute initiation — the party request shape',
    point:
      'What a dispute initiation request body looks like structurally, for a party audience active in the shell.',
    request:
      '{\n  "intentReference": "<the intent in dispute>",\n  "grounds": "goods-not-received",\n  "accountOfWhatHappened": "<the substantive account>",\n  "evidence": [ /* evidence references per the grounds\' requirements */ ]\n}',
    illustrativeBecause:
      'Not runnable as-is: the authority re-validates party status on the reference, open/resolved dispute state, grounds, evidence requirements, and the substantive-account requirement — the honest answer for any concrete call is the authority\'s own applied/denied result (denials are protocol results, HTTP 200, kind "denied"), which depends on session and authority state a documentation page cannot promise.',
    routes: ['/api/mediation/dispute'],
  },
]);

/** The examples that are runnable exactly as shown (the page badges them). */
export const EXECUTABLE_DOCUMENTATION_EXAMPLES: readonly DocumentationExample[] = Object.freeze(
  DOCUMENTATION_EXAMPLES.filter((example) => example.kind === 'executable'),
);

/** The examples that are marked prose only (the page badges them). */
export const ILLUSTRATIVE_DOCUMENTATION_EXAMPLES: readonly DocumentationExample[] = Object.freeze(
  DOCUMENTATION_EXAMPLES.filter((example) => example.kind === 'illustrative'),
);
