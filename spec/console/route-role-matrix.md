# Console route-role matrix (PC-001, frozen)

Every registry route × every role → allow/deny. This matrix is the
human-readable form of the frozen route/module registry
(`src/lib/console/registry.ts`) and the server-side role policy derived from
it (`src/lib/console/policy.ts`). It is cross-checked mechanically by
`src/lib/console/registry.test.ts` — the spec matrix and the code registry
cannot drift.

**Role vocabulary:** the EXISTING repository vocabulary `ROLES`
(`src/lib/navigation.ts`): `customer`, `merchant`, `provider`, `operator`,
`administrator` — identical one-for-one to design §6 (decision recorded in
`spec/console/PC-001-evidence.md`; the repository vocabulary is
authoritative). Unauthenticated viewers are denied everywhere (least
visibility, P8) and fail closed through the existing guard convention
(`redirect('/')`, `src/lib/shell-guard.ts`).

**Default-deny rule:** a role is `allow` ONLY where the design §6 role model
explicitly grants the module; every other cell is `deny`. Later work items
may widen cells only through their own governed change.

Status policy (first release): composed feature views are `planned` until
PC-004/PC-005 merge; only the foundation root is `available`.

| module id | route | customer | merchant | provider | operator | administrator | rationale (design §6) |
|---|---|---|---|---|---|---|---|
| `console.overview` | `/console` | allow | allow | allow | allow | allow | one product surface with role-aware modules; every authenticated role reaches the role-aware overview root |
| `console.payments.all` | `/console/payments` | allow | allow | deny | allow | deny | customer: personal payments; merchant: merchant payments; operator: permitted payment visibility; provider/administrator not explicitly authorized |
| `console.payments.detail` | `/console/payments/[paymentId]` | allow | allow | deny | allow | deny | same §6 rows as the payment list; detail is role-scoped by the owning read authority at data level (PC-003) |
| `console.checkout.sessions` | `/console/checkout/sessions` | deny | allow | deny | deny | deny | merchant: checkout (the existing product checkout surface is merchant-audience) |
| `console.checkout.configuration` | `/console/checkout/configuration` | deny | allow | deny | deny | deny | merchant: account/configuration |
| `console.checkout.test` | `/console/checkout/test` | allow | allow | deny | deny | deny | customer: checkout/test context; merchant: checkout — environment signal is server-derived (design §10) |
| `console.accounts.customers` | `/console/accounts/customers` | deny | deny | deny | deny | allow | administrator: cross-role administration and visibility |
| `console.accounts.merchants` | `/console/accounts/merchants` | deny | allow | deny | deny | allow | merchant: own account/configuration; administrator: cross-role visibility |
| `console.accounts.providers` | `/console/accounts/providers` | deny | deny | allow | deny | allow | provider: provider-side activity/profile; administrator: cross-role visibility |
| `console.accounts.operators` | `/console/accounts/operators` | deny | deny | deny | deny | allow | administrator: cross-role administration |
| `console.capabilities` | `/console/capabilities` | deny | deny | allow | deny | deny | provider: provider capabilities (mirrors the existing `/capabilities` provider surface audiences) |
| `console.developers.api-keys` | `/console/developers/api-keys` | deny | allow | deny | deny | deny | merchant: developer/integration controls; no other role is explicitly authorized (default-deny) |
| `console.developers.webhooks` | `/console/developers/webhooks` | deny | allow | deny | deny | deny | merchant: webhooks (design §6 merchant row) |
| `console.developers.logs` | `/console/developers/logs` | deny | allow | deny | deny | deny | merchant: integration logs (design §6 merchant row) |
| `console.developers.request-inspector` | `/console/developers/request-inspector` | deny | allow | deny | deny | deny | merchant: integration diagnostics; redaction rules per design §11 |
| `console.developers.environments` | `/console/developers/environments` | deny | allow | deny | deny | deny | merchant: environment-scoped credentials (keys are environment-scoped, design §11); environment signal remains server-derived |
| `console.operations.queues` | `/console/operations/queues` | deny | deny | deny | allow | deny | operator: operational/diagnostic modules; read-mostly first release (design §12) |
| `console.operations.execution` | `/console/operations/execution` | deny | deny | deny | allow | deny | operator: operational/diagnostic modules |
| `console.operations.reconciliation` | `/console/operations/reconciliation` | deny | deny | deny | allow | deny | operator: operational/diagnostic modules; preserves observability taxonomy |
| `console.operations.unknown` | `/console/operations/unknown` | deny | deny | deny | allow | deny | operator: UNKNOWN-case visibility and recovery context |
| `console.operations.clearing-netting` | `/console/operations/clearing-netting` | deny | deny | deny | allow | deny | operator: operational/diagnostic modules |
| `console.operations.incidents` | `/console/operations/incidents` | deny | deny | deny | allow | deny | operator: operational/diagnostic modules |
| `console.documentation.api` | `/console/documentation/api` | allow | allow | allow | allow | allow | documentation is part of the product shell (design §14) |
| `console.documentation.concepts` | `/console/documentation/concepts` | allow | allow | allow | allow | allow | documentation is part of the product shell |
| `console.documentation.examples` | `/console/documentation/examples` | allow | allow | allow | allow | allow | documentation is part of the product shell |
| `console.documentation.guides` | `/console/documentation/guides` | allow | allow | allow | allow | allow | documentation is part of the product shell |

## Unauthenticated viewers

| module id | unauthenticated |
|---|---|
| every registry module | deny (fail closed; redirect to the shell home via the existing guard convention) |

## Enforcement points (server-side only)

- Route group: `src/app/console/layout.tsx` → `requireConsoleModule(console.overview)`.
- Console root page: `src/app/console/page.tsx` → `requireConsoleModule(console.overview)` (deep-link re-check).
- Contracts API: `src/app/api/console/contracts/route.ts` → `authorizeConsoleModule(principal, console.overview)`; denial answers 404 with no content.
- Child feature routes (PC-002/PC-004/PC-005) must call `requireConsoleModule` with their own module ids on direct entry.
