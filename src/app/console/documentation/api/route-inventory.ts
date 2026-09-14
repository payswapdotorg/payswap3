/**
 * PC-005 — The documentation API route inventory: every HTTP boundary the
 * repository ACTUALLY implements under src/app/api/**, enumerated by hand
 * from the real route files and mechanically cross-checked by the
 * documentation route-inventory test (the test enumerates src/app/api/**
 * /route.ts on the filesystem and asserts set equality with this inventory
 * in BOTH directions — a new route cannot ship undocumented, and this page
 * cannot document a route that does not exist).
 *
 * Each entry records ONLY what the owning route file states: the HTTP
 * methods it exports, its source path, and a one-line summary of its own
 * declared semantics (fail-closed conventions, envelope shapes, honest
 * denials). Nothing here re-derives or re-interprets protocol semantics.
 */

export interface DocumentationApiRouteEntry {
  /** The route path, verbatim as the file tree defines it. */
  readonly path: string;
  /** The HTTP methods the route file exports, in file order. */
  readonly methods: readonly ('GET' | 'POST' | 'DELETE')[];
  /** The owning route file, relative to the repository root. */
  readonly sourceFile: string;
  /** One line: what the route's own header comment declares it does. */
  readonly summary: string;
  /** Honest boundary notes (fail-closed conventions, envelope, denials). */
  readonly notes: readonly string[];
}

/** Which display family the entry belongs to (the page's sections). */
export type DocumentationApiRouteFamily =
  | 'platform-health'
  | 'protocol-admission'
  | 'mediation-surfaces'
  | 'verification-harness'
  | 'console-reads'
  | 'console-developer-controls';

export interface DocumentationApiRouteSection {
  readonly family: DocumentationApiRouteFamily;
  readonly heading: string;
  readonly lead: string;
  readonly entries: readonly DocumentationApiRouteEntry[];
}

/** THE implemented HTTP surface (as of this work item). */
export const DOCUMENTATION_API_ROUTE_SECTIONS: readonly DocumentationApiRouteSection[] = [
  {
    family: 'platform-health',
    heading: 'Platform health (web-api-boundary)',
    lead: 'The DEP-002 liveness/readiness pair. Liveness answers “is the process serving”; readiness runs the fail-closed startup configuration validation and never infers or guesses.',
    entries: [
      {
        path: '/api/health',
        methods: ['GET'],
        sourceFile: 'src/app/api/health/route.ts',
        summary: 'Liveness only: always 200 while the component is alive, regardless of readiness.',
        notes: [
          'Answers {status: "ok", component: "web-api-boundary", env} with Cache-Control: no-store.',
          'No readiness logic, no configuration checks, no secrets (the F6 liveness/readiness separation).',
        ],
      },
      {
        path: '/api/ready',
        methods: ['GET'],
        sourceFile: 'src/app/api/ready/route.ts',
        summary: 'Readiness: 200 with the checks summary when configuration validates; 503 with the NAMED failing check ids when it does not.',
        notes: [
          'Fail-closed: missing required configuration ⇒ NOT ready, never a guess.',
          'Ids only, never values; in production every required secret NAME must be present at runtime.',
          'Carries the additive nine-domain componentHealth enrichment (DEP-007) that never flips the status code.',
        ],
      },
    ],
  },
  {
    family: 'protocol-admission',
    heading: 'Protocol command admission (the sole admission point)',
    lead: 'The protocol gateway’s HTTP binding: POST admits exactly one command envelope; GET looks up a recorded idempotency receipt. This route forwards submissions verbatim and holds no financial authority of its own.',
    entries: [
      {
        path: '/api/protocol/commands',
        methods: ['POST', 'GET'],
        sourceFile: 'src/app/api/protocol/commands/route.ts',
        summary:
          'POST: submit one kernel CommandEnvelope (kind, authority, subjectIds, idempotencyKey, protocolTime, body) through ProtocolGateway.submitCommand. GET: the read-only receipt lookup by kind + idempotencyKey.',
        notes: [
          'POST 200 carries the gateway’s typed admission result (accepted {ok, replayed, created, receipt, jobId} or a typed refusal {ok: false, reasonCode, problem, field?}) — refusals are protocol results, not transport errors.',
          'POST 400 = transport-level refusals the gateway could not be asked to type: malformed-json, unattributable-submission. POST 500 = fail-closed transport failure (nothing retried silently).',
          'Authorization, body validation, and idempotent receipts are all enforced by the gateway itself; effects occur only via the transition path the gateway enqueues onto (single-writer discipline).',
          'GET returns {found: true, receipt} | {found: false} | 400 missing-lookup-parameters.',
        ],
      },
    ],
  },
  {
    family: 'mediation-surfaces',
    heading: 'Mediation and dispute surfaces (party endpoints)',
    lead: 'The UI-008 party endpoints over the presentation-only mediation mock. The actor is resolved SERVER-SIDE from the simulated shell audience cookie — a client-claimed role is never trusted, and denials are protocol results (HTTP 200, kind "denied").',
    entries: [
      {
        path: '/api/mediation/dispute',
        methods: ['POST'],
        sourceFile: 'src/app/api/mediation/dispute/route.ts',
        summary: 'Dispute initiation: the authority re-validates party status, dispute state, grounds (goods-not-received, goods-not-as-described, settlement-mismatch, authorization-disagreement, other-with-evidence), evidence requirements, and the substantive-account requirement.',
        notes: ['Denials are protocol results (HTTP 200, kind: "denied") and are always displayed explicitly by the initiation surface.'],
      },
      {
        path: '/api/mediation/record',
        methods: ['GET'],
        sourceFile: 'src/app/api/mediation/record/route.ts',
        summary: 'Record query (?type=proposal|mediation|dispute&id=…): rechecks records with the owning authorities; answers fetched / not-visible / unavailable.',
        notes: ['A party audience (customer or merchant) must be active; unauthenticated sessions receive the not-visible protocol result.'],
      },
      {
        path: '/api/mediation/action',
        methods: ['POST'],
        sourceFile: 'src/app/api/mediation/action/route.ts',
        summary: 'Mediation party actions: submit-statement, accept-proposed-resolution, decline-proposed-resolution on a caseId.',
        notes: ['Per-role protocol authorization is re-validated on every call by the authority.'],
      },
      {
        path: '/api/mediation/decision',
        methods: ['POST'],
        sourceFile: 'src/app/api/mediation/decision/route.ts',
        summary: 'Proposal decisions: accept, reject, counter (with counterTerms), escalate on a proposalId.',
        notes: ['Authorized decisions are applied and recorded; unauthorized ones are denied with the reason (HTTP 200, kind: "denied").'],
      },
    ],
  },
  {
    family: 'verification-harness',
    heading: 'Verification and shell harness',
    lead: 'The endpoints that exist to drive the simulated shell and the presentation-only mediation mock for verification. They script presentation state or the session audience signal — they grant no product capability by themselves.',
    entries: [
      {
        path: '/api/mediation/script',
        methods: ['POST'],
        sourceFile: 'src/app/api/mediation/script/route.ts',
        summary: 'VERIFICATION SURFACE ONLY: scripts authority-owned outcomes on the presentation-only mock (reset, set-proposal-state, set-mediation-state, set-proposed-resolution, add-authority-notice, set-dispute-state, …).',
        notes: [
          'It can never apply or script a proposal decision: decided-* outcomes are refused here and only reachable through the decision endpoint, which enforces per-role authorization.',
          'Part of no party surface; exists only while the mock backs the surfaces (runtime ARRIVING for the real authorities).',
        ],
      },
      {
        path: '/api/shell/audience',
        methods: ['POST'],
        sourceFile: 'src/app/api/shell/audience/route.ts',
        summary: 'Server-side writer for the simulated authoritative audience signal ({audience: …}): writes the session cookie for one of the declared audiences.',
        notes: [
          'Only declared audiences are accepted (400 invalid-audience / invalid-json otherwise).',
          'It grants no product capability by itself; every guarded surface still evaluates the signal through the guard on entry (P8).',
        ],
      },
    ],
  },
  {
    family: 'console-reads',
    heading: 'Console API boundary (reads)',
    lead: 'The PC-001/PC-003 console read boundary behind the frozen route-role matrix. Every console route resolves the principal server-side from the audience cookie and fails closed — 404 with a bare {ok: false} and no content — for unauthenticated or role-denied callers, then answers the PC-003 envelope {ok, principal, environment, result}.',
    entries: [
      {
        path: '/api/console/contracts',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/contracts/route.ts',
        summary: 'The frozen route/module registry summary plus the server-derived environment report (the two PC-001 foundation contracts; no financial reads).',
        notes: ['Any authenticated console-allowed role may read it (the console root module’s grant).'],
      },
      {
        path: '/api/console/payments',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/payments/route.ts',
        summary: 'Session payment list through the intent authority’s own listing read (customer, merchant, operator per the frozen matrix).',
        notes: ['The envelope’s result carries per-item states with the frozen display mapping; an unavailable read renders UNKNOWN, never an empty list standing in for an answer.'],
      },
      {
        path: '/api/console/payments/[paymentId]',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/payments/[paymentId]/route.ts',
        summary: 'One payment’s detail (intent state + waiting sub-read + A15 evidence records verbatim), role-scoped by the owning read authority at data level.',
        notes: ['A missing intent is the presentation UNKNOWN branch (HTTP 200) — never a fabricated state.'],
      },
      {
        path: '/api/console/checkout/sessions',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/checkout/sessions/route.ts',
        summary: 'Open checkout sessions through the checkout authority (merchant-only per the frozen matrix).',
        notes: ['An EMPTY list is a legitimate VALUE; an unreachable authority renders UNKNOWN.'],
      },
      {
        path: '/api/console/checkout/sessions/[checkoutId]',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/checkout/sessions/[checkoutId]/route.ts',
        summary: 'One checkout session’s status through the checkout authority.',
        notes: ['checkout-not-found is 200 + presentation UNKNOWN — never a 404, never a fabricated state.'],
      },
      {
        path: '/api/console/capabilities',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/capabilities/route.ts',
        summary: 'The capability registry view (provider-only per the frozen matrix): the two axes and per-item availability, with availability-UNKNOWN preserved.',
        notes: ['Composed through the real capability port; nothing is recomputed here.'],
      },
      {
        path: '/api/console/operations/health',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/operations/health/route.ts',
        summary: 'The composite operations-health read for the six frozen operations modules (operator-only, mechanically derived from the registry intersection).',
        notes: ['The same composition point /api/ready enriches through; the handler takes NO request input at all.'],
      },
    ],
  },
  {
    family: 'console-developer-controls',
    heading: 'Console developer controls (the credential boundary)',
    lead: 'The PC-005 dedicated credential boundary (merchant-only per the frozen matrix). Secrets are generated server-side, shown exactly once at creation (JSON body once, or a one-time receipt across the form-mode 303 redirect), and never retained retrievably; every request — authorized or denied — lands in the diagnostic request-log ring payload-free.',
    entries: [
      {
        path: '/api/console/developers/api-keys',
        methods: ['GET', 'POST', 'DELETE'],
        sourceFile: 'src/app/api/console/developers/api-keys/route.ts',
        summary:
          'GET: environment-scoped secret-free key list. POST: create (label) — or revoke with form field action=revoke + id. DELETE (?id=…): explicit revocation.',
        notes: [
          'POST accepts JSON (the plaintext token is shown ONCE in the response) or the console form (303 redirect back with a one-time receipt).',
          'The environment is the server-derived context — no query parameter, header, cookie, or body value can select it.',
          'Fail-closed errors: 422 invalid-label / missing-label / missing-id / invalid-body; 404 unknown-id; 409 already-revoked.',
          'Every response is {ok, principal, environment, result} with Cache-Control: no-store.',
        ],
      },
      {
        path: '/api/console/developers/webhooks',
        methods: ['GET', 'POST', 'DELETE'],
        sourceFile: 'src/app/api/console/developers/webhooks/route.ts',
        summary:
          'GET: environment-scoped secret-free endpoint list plus the real event-identifier catalog and the honest delivery state. POST: register (url) — or revoke with action=revoke + id. DELETE (?id=…): explicit revocation.',
        notes: [
          'The signing secret is treated exactly like an API key: server-generated, shown once, never logged, never re-displayed.',
          'URL validation fails closed: https with a host, or http for loopback hosts only.',
          'No delivery worker exists at this baseline — the route states it; retries must never imply protocol replay.',
        ],
      },
      {
        path: '/api/console/developers/requests',
        methods: ['GET'],
        sourceFile: 'src/app/api/console/developers/requests/route.ts',
        summary: 'The PC-003 request-log read scaffold behind the console.developers.logs module grant.',
        notes: [
          'PC-003-owned and unmodified by PC-005: it composes the PC-003 exported seam and answers the honest UNAVAILABLE branch presentation until its owning read is rewired — the PC-005 pages and their ring supersede it at the page level (recorded in spec/console/PC-005-evidence.md).',
        ],
      },
    ],
  },
];

/** Flat view of every inventoried route path (the test’s set-equality input). */
export const DOCUMENTATION_API_ROUTE_PATHS: readonly string[] = Object.freeze(
  DOCUMENTATION_API_ROUTE_SECTIONS.flatMap((section) => section.entries.map((entry) => entry.path)),
);

/** Flat view of every inventoried route entry (the page renders these). */
export const DOCUMENTATION_API_ROUTE_ENTRIES: readonly DocumentationApiRouteEntry[] = Object.freeze(
  DOCUMENTATION_API_ROUTE_SECTIONS.flatMap((section) => section.entries),
);
