# PC-004 evidence — composed console views

**Task:** PC-004 (spec/console-work-orders/PC-004.md)
**Branch:** `pc-004/composed-views`
**Parent revision:** `369c035` (frontier after PC-001 + PC-002 + PC-003 all merged and verified)
**Design:** docs/superpowers/specs/2026-09-14-payswap-developer-console-design.md (APPROVED)
**Plan:** docs/superpowers/plans/2026-09-14-payswap-developer-console.md (Task 4)

## 1. Composition map (view → read model → owning source)

Every composed page is exactly three layers: a server-component route entry
(`src/app/console/**/page.tsx`) that guards through `requireConsoleRoute`
(fail-closed, registry-derived roles) and wires `ensureProductPortsWired()`
(SYS-001/D-2); a presentation-only view (`src/components/console/views/**`)
that renders a `ConsoleReadResult` envelope through the ONE envelope renderer
(`ConsoleReadResultView` — value branches delegate to the view, unavailable
branches render the honest UNKNOWN panel, never FAILED/SUCCEEDED); and a REAL
PC-003 read model (`src/lib/console/read-models/**`) over the existing
protocol ports. No view recomputes, aggregates, or invents anything.

| View family | Route(s) | View component | Read model (PC-003) | Owning source (the port the read model calls) |
|---|---|---|---|---|
| Payment list | `/console/payments` | `ConsolePaymentListView` (`payment-list-view.tsx`) | `readConsolePayments(viewerRole)` (`read-models/payments.ts`) | `getIntentPort().listSessionIntents()` (runtime adapter `createRuntimeIntentAdapter` over A01 + A15); honest scopeNote: no per-role list filter exists |
| Payment detail (design §7 flagship) | `/console/payments/[paymentId]` | `ConsolePaymentDetailView` | `readConsolePaymentDetail(intentId, viewerRole)` | `getIntentPort().getIntentState(intentId)` + `getWaitingPort().lookupWaiting(...)` (A08 waiting sub-read keeps its four honest answers distinct; A15 evidence records verbatim) |
| Checkout sessions | `/console/checkout/sessions` | `ConsoleCheckoutSessionsView` | `readConsoleCheckoutSessions()` + `readConsoleCheckoutSessionStatus(checkoutId)` per listed session (no HTTP hop) | `getCheckoutPort().listOpenCheckouts()` / `.getStatus({checkoutId})`; EMPTY list = legitimate VALUE, `authority-unreachable` = UNKNOWN |
| Checkout configuration | `/console/checkout/configuration` | `ConsoleCheckoutConfigurationView` (honest gap; the gap renders in BOTH envelope branches — a recorded repository fact) | `readConsoleCheckoutSessions()` composed ONLY for its boundary facts (runtime ARRIVING + authority owner) | `getCheckoutPort()` boundary facts; no checkout-configuration read exists (recorded gap, nothing invented) |
| Checkout test | `/console/checkout/test` | `ConsoleCheckoutTestView` (NO simulator; existing execution paths only) | none (composes `ConsoleEnvironmentContext`, PC-001) | server-derived environment (`getEnvironment()`); links to `/pay`, `/checkout`, `/api/protocol/commands` — never constructs commands |
| Capabilities | `/console/capabilities` | `ConsoleCapabilitiesView` | `readConsoleCapabilities()` | `getCapabilityPort().listCapabilities()` (A03 registry view; two axes verbatim; per-item availability-UNKNOWN preserved) |
| Operations health (six modules + overview summary) | `/console/operations/{queues,execution,reconciliation,unknown,clearing-netting,incidents}`, `/console` (operator-only summary) | `ConsoleOperationsDomainView` / `ConsoleOperationsHealthSummaryView` | `readConsoleOperationsHealth()` | `loadOperationsHealthProbe()` → `probeComponentHealth()` (the /api/ready composition point); per-module domain highlight + honest module-telemetry gap panels |
| Accounts (four modules) | `/console/accounts/{customers,merchants,operators,providers}` | `ConsoleAccountGapView` (recorded gap) + `ConsoleProviderAccountView` (providers) | providers only: `readConsoleCapabilities()` (the ONE provider-side projection that exists) | no account authority exists at this baseline (recorded gap); capability registry via `getCapabilityPort()` |

Shared view chrome: `ConsoleModuleViewHeader` + `ConsoleGapPanel`
(`console-view-chrome.tsx` — registry-derived labels, honest gap panels),
`ConsoleReadResultView` + `ConsoleReadUnavailablePanel`
(`console-read-result.tsx` — the single envelope branch decision),
`view-format.ts` (deterministic presentation-only formatting).

## 2. Fix carried in the finisher pass (view bug)

`ConsoleCheckoutConfigurationView` originally rendered the recorded gap ONLY
inside the value branch, so an unavailable boundary read (transport failure)
dropped the gap statement entirely. The gap is a static repository fact, not a
read-dependent verdict — fixed by hoisting the `ConsoleGapPanel` out of the
envelope renderer (the accounts-views "the gap stands on its own" precedent),
so the unavailable branch renders the honest UNKNOWN panel AND the recorded
gap.

## 3. Verification transcript (finisher battery, branch tip)

- `bun run typecheck` — **0 errors** (12 fixture typecheck errors fixed:
  capability `category` fixtures `'card' | 'bank'` → real
  `CapabilityCategory` members (`'payments' | 'settlement'`); port `boundary`
  fixtures de-functioned to plain `CapabilityBoundaryInfo` values; checkout
  status fixtures given the required `runtime: 'ARRIVING'` member of
  `CheckoutStatusResult`; payments list backings wrapped as
  `Promise<SessionIntentListResult>`).
- `bun run build` — **success** (`✓ Compiled successfully`, 43/43 static
  pages; the full frozen IA route tree live as dynamic routes).
- `bun test src/app/console/ src/components/console/views/` — **101 pass /
  0 fail** (17 files).
- `bun test` (full suite) — **2240 pass / 0 fail** across 137 files
  (baseline 2154 + 86 PC-004 tests; zero new failures).

Test-seam discipline (the PC-003 precedent, machine-enforced by the green
full suite): page tests mock ONLY `next/headers`, the SYS-001 wiring seam, or
a PORT/register seam (`registerIntentPortBacking`,
`registerCheckoutPortBacking`, `registerCapabilityPortBacking`) — never a
read-model module (bun's `mock.module` mutates a loaded module's exports in
place; the two PC-004 files that mocked `read-models/operations-health`
poisoned the PC-003 suites in the shared process and were re-based onto the
lazy `@/lib/observability/readiness` seam the real read model loads on
demand).

## 4. Recorded gaps (unchanged, by design)

- No account authority exists (customers/merchants/operators/providers
  identity+profile gap) — honest gap panels, never fabricated lists.
- No checkout-configuration read exists — recorded gap + the one boundary
  fact (runtime ARRIVING) quoted verbatim.
- No module-specific operations telemetry beyond domain health (queue-depth,
  job, reconciliation-record, UNKNOWN-case, clearing/netting, incident
  listings) — honest gap panels per module.
- Developer request log stays `PENDING-PC-005` (design §17 row 6; no owning
  source at this baseline).
- The intent port exposes no per-role list filter — the payments read model's
  own honest scopeNote renders on the list view.
