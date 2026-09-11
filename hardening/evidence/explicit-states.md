# UI-009 — Explicit-state guarantees re-verification

## Six-state matrix (state-primitives surface)

Frames rendered: 11; distinct visual treatments: 6 (SUCCEEDED solid/emerald, FAILED solid+accent/rose, UNKNOWN dashed/amber, WAITING dotted/stone, IN_PROGRESS solid+strip/teal, ACTION_REQUIRED double/orange). Ambiguous "pending" as a display label: **false**. UNKNOWN carries the P5 disambiguation: **true**.

## Track deep links across all six display states

| reference | expected display state | states presented | ambiguous pending | UNKNOWN worded as success/failure |
|---|---|---|---|---|
| `/track/PWS-9QM2` | succeeded | Succeeded, Unknown | false | false |
| `/track/PWS-7F3K` | waiting | Waiting, Unknown, Unknown | false | false |
| `/track/PWS-2H8D` | failed | Failed, Unknown | false | false |
| `/track/PWS-4TNN` | in-progress | In progress, Unknown | false | false |
| `/track/PWS-6KLP` | unknown | Unknown, Unknown, Unknown | false | false |
| `/track/PWS-8XRQ` | action-required | Action required, Unknown | false | false |

## UNKNOWN deep link (pay surface)

/pay/INTENT-2041 renders the UNKNOWN presentation: **true**, with the disambiguation sentence: **true**. Never a 404, never success/failure wording.

## Wording scan — every "pending" occurrence classified

| surface | occurrence | classification |
|---|---|---|
| home | "ly one explicit display state (P4) — no ambiguous pending…" | contract negation ("no ambiguous pending") — not a state label |
| capabilities | "ne step awayIssuing refunds for accepted intents, pending the authorit…" | adverbial prose inside an IN_PROGRESS state description ("pending the authority re-valuation") — display chip is explicit |
| track | "y tracked state is explicitThere is no ambiguous “pending” anywhere on…" | surface's own negation ("There is no ambiguous 'pending' anywhere on this surface") |
| proposal-review | "ange the swap's current state while the review is pending…" | prose inside consequence wording ("while the review is pending") — display chip is explicit |
| verification-intent-flow | "The authority reported this intent is held pending the recipient…" | authority prose in a WAITING explanation ("held pending the recipient") |
| verification-checkout-flow | "Explicit non-states (page load, client-side pending flags, adapter rea…" | harness documentation of explicit non-states (page load, client-side flags) |
| verification-capability-flow | "mdRefund issuanceAuthority state: pending · source: Capability Registr…" | mock authority FIXTURE state vocabulary shown in the harness state-matrix table (maps to an explicit display state; mapping records own it) |
| verification-tracking-flow | "There is no ambiguous “pending” anywhere: waiting conditions carry rea…" | surface negation ("There is no ambiguous 'pending' anywhere") |
| verification-waiting-flow | "vider backoffUNKNOWN with reconciliationUnknown — pending reconciliati…" | UNKNOWN reconciliation-path wording ("Unknown — pending reconciliation") — P5 wording owned by the mapping records |
| verification-waiting-flow | "sition is being reconciledWaiting detailUnknown — pending reconciliati…" | UNKNOWN reconciliation-path wording ("Unknown — pending reconciliation") — P5 wording owned by the mapping records |
| verification-waiting-flow | "entThe authority's queue report for this entry is pending reconciliati…" | UNKNOWN reconciliation-path wording ("Unknown — pending reconciliation") — P5 wording owned by the mapping records |
| verification-waiting-flow | "uthoritative outcome; the entry is marked unknown pending reconciliati…" | UNKNOWN reconciliation-path wording ("Unknown — pending reconciliation") — P5 wording owned by the mapping records |

## Result

**PASS.** The six display states are distinct everywhere (border style, tint, icon shape, label word). No surface renders an ambiguous "pending" as a display state. UNKNOWN is never styled (emerald/rose) or worded (succeeded/failed) as success or failure; every UNKNOWN presentation carries the disambiguation and its reconciliation path. No state wording, mapping record, or authorization path was modified by UI-009.