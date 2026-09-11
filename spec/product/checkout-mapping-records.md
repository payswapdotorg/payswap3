# Checkout consequential-state mapping records (UI-003 — merchant checkout surface)

**Authority owner of checkout truth:** Checkout/Intent Authority per spec/architecture/v0.1
**Runtime status:** ARRIVING — the real protocol authority is not live; the only backing today is `mock-checkout-authority.ts`, which is explicitly **NON-AUTHORITATIVE and presentation-only** (sandbox data, scriptable outcomes, one scripted outcome path per checkout id).
**Surface:** merchant checkout flow — offer/quote presentation (consequence-first), explicit accept and decline, consequential state presentation (`src/app/(merchant)/checkout/*`, `src/components/merchant/*`).
**Adapter boundary:** `src/lib/protocol/checkout-port.ts` (`getCheckoutPort()`), mapping module `src/lib/protocol/checkout-state-mapping.ts` (`resolveCheckoutDisplay`).
**Mapping discipline:** every authority state below resolves to **exactly one** display state (one-to-one, P4); the display state is rendered through the shared state primitives (`src/components/state`) exclusively. The nine-question record format follows `spec/product/intent-mapping-records.md` (UI-002).

---

## Record cko-map-01 — `offered` → ActionRequiredState (`action-required`)

1. **What is the consequential state, in plain language?** An offer/quote is presented to this merchant and is waiting for an explicit decision. Nothing has been committed: the money, the obligations, and the chargeback exposure described in the quote are all still *conditional* on an acceptance that has not happened.
2. **Which protocol object and authority state does it map from?** The merchant checkout object (`cko_*`, protocol reference `pco_*`) in authority state `offered`.
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (per spec/architecture/v0.1). While runtime is ARRIVING, the mock stand-in restates scripted sandbox data and owns no truth.
4. **How does the surface learn this state?** `getCheckoutPort().getOffer({ checkoutId? })` and `getCheckoutPort().getStatus({ checkoutId })`; the `offered` record is also the queue source via `listOpenCheckouts()`.
5. **Which shared display primitive presents it, with which fields?** `ActionRequiredState` with `action` ("Decide this checkout explicitly: accept the offer or decline it…"), `reportedBy` (authority ledger), `validity` (authority-quoted deadline), `consequenceOfInaction` (lapse consequences: the intent moves on, the quote expires, later acceptance is refused).
6. **What evidence trail exists, and where is it reachable?** The offer quote receipt (label + href carried by the authority record; mock: anchor into `/verification/checkout-flow#scenario-*`).
7. **What can the merchant do from this state?** Exactly two single-intent actions — accept or decline — each with its own explicit confirmation. Nothing else mutates the state.
8. **What must never be presented as/through this state?** No pre-selected accept or decline (no default-checked control, no autoFocus on an intent button); no collapsed condition or obligation; no "one-click" combined accept; no amount, fee, or expiry arithmetic computed UI-side; no countdown pressure manufactured client-side.
9. **What runtime caveat applies?** Runtime ARRIVING: the mock is non-authoritative and deterministic; the real authority may present offers with different (or dynamically changing) validity, which this surface must keep reading from the authority rather than deriving.

---

## Record cko-map-02 — `accept-submitted` → InProgressState (`in-progress-accept-submission`)

1. **What is the consequential state, in plain language?** The merchant has explicitly confirmed an acceptance; it is being routed through protocol authorization. The acceptance is neither acknowledged nor refused yet — nothing is committed *or* rejected at this moment.
2. **Which protocol object and authority state does it map from?** The checkout decision submission in authority state `accept-submitted` (receipt `drc_*`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (protocol authorization path). The mock simulates the routing only.
4. **How does the surface learn this state?** The decision controls call `getCheckoutPort().submitDecision({ checkoutId, decision: 'accept' })`; the same framing is reused if an authority `accept-submitted` record is read via `getStatus` (the in-flight record `cko_inflight_accept_001`).
5. **Which shared display primitive presents it, with which fields?** `InProgressState` with `whatIsHappening` ("Your acceptance is being routed through protocol authorization. Nothing is committed on this page while it is in flight."), `whatCompletesIt` (the authority records the terminal outcome — acknowledged, failed with reason, or UNKNOWN), `reportedBy`.
6. **What evidence trail exists, and where is it reachable?** The submission receipt (decision, receipt id, submitted-to, accepted-by, timestamp) shown immediately after submission; the authority record's evidence link on the state page.
7. **What can the merchant do from this state?** Wait and observe. No cancel, no re-submit, no "assume it worked": the protocol owns the in-flight decision.
8. **What must never be presented as/through this state?** No optimistic success (never render accepted before the authority acknowledges); no silent retry; no duplicate submission; the UI must not flip the state locally.
9. **What runtime caveat applies?** The mock resolves the follow-up state deterministically per scripted scenario; the real authority may legitimately lose responses — which is precisely the cko-map-08 UNKNOWN path.

---

## Record cko-map-03 — `decline-submitted` → InProgressState (`in-progress-decline-submission`)

1. **What is the consequential state, in plain language?** The merchant has explicitly confirmed a decline; it is being routed through protocol authorization. The decline is not yet recorded.
2. **Which protocol object and authority state does it map from?** The checkout decision submission in authority state `decline-submitted` (receipt `drc_*`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (protocol authorization path).
4. **How does the surface learn this state?** `submitDecision({ decision: 'decline' })` from the decision controls; or an authority `decline-submitted` record via `getStatus` (scenario `cko_inflight_decline_001`).
5. **Which shared display primitive presents it, with which fields?** `InProgressState` with decline-specific `whatIsHappening` / `whatCompletesIt` ("The Checkout/Intent Authority records the decline receipt, or a failure with a recorded reason if the submission itself fails."), `reportedBy`.
6. **What evidence trail exists, and where is it reachable?** The submission receipt shown at submission time; the record's evidence link.
7. **What can the merchant do from this state?** Wait and observe; no cancel-from-here (the protocol owns the in-flight decision).
8. **What must never be presented as/through this state?** No pre-emptive "declined" presentation; no treating the decline as done; no re-offering of the accept button while in flight (that would invite a double decision).
9. **What runtime caveat applies?** Same as cko-map-02: mock is deterministic; the real authority can fail or lose the response (cko-map-07 / cko-map-08 paths).

---

## Record cko-map-04 — `accepted` → SucceededState (`succeeded-acknowledged`)

1. **What is the consequential state, in plain language?** The merchant's acceptance is acknowledged and recorded by the authority. The merchant is now committed to the offer's obligations; the money has *not necessarily moved* — payment is a separate, later authority-reported phase.
2. **Which protocol object and authority state does it map from?** The checkout object in authority state `accepted`, with the acceptance acknowledgment receipt (scenario `cko_live_accept_001`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (checkout ledger).
4. **How does the surface learn this state?** `getStatus({ checkoutId })` — the follow-up checkout id returned by `submitDecision`; resolved by `resolveCheckoutDisplay`.
5. **Which shared display primitive presents it, with which fields?** `SucceededState` with `outcome` ("Checkout accepted — your acceptance is acknowledged and recorded"), `reportedBy`, `evidence` { label, href }; children restate the originating offer summary and that fulfilment obligations now apply.
6. **What evidence trail exists, and where is it reachable?** The acceptance acknowledgment receipt (mandatory evidence field on this primitive; mock: harness anchor; real runtime: authority receipt).
7. **What can the merchant do from this state?** Fulfil the obligations of the accepted offer and watch the state page for the payment phase. No accept/decline controls are rendered in this state.
8. **What must never be presented as/through this state?** Never conflate acknowledgment with settlement: the surface must not claim money has moved or imply instant payout; no new decision controls (the decision is closed); no recomputation of the payout figure.
9. **What runtime caveat applies?** Mock amounts are sandbox figures; the real authority's receipts carry the authoritative figures and links.

---

## Record cko-map-05 — `accepted-awaiting-payment` → WaitingState (`waiting-payment-confirmation`)

1. **What is the consequential state, in plain language?** The acceptance is acknowledged and the checkout is now waiting for the paying-side authority to confirm the customer's payment. Money has not moved to the merchant.
2. **Which protocol object and authority state does it map from?** The checkout object in authority state `accepted-awaiting-payment` (scenario `cko_payment_pending_001`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority jointly with the paying-side authority it names.
4. **How does the surface learn this state?** `getStatus({ checkoutId })` → `resolveCheckoutDisplay`.
5. **Which shared display primitive presents it, with which fields?** `WaitingState` with `whatIsWaiting` (customer payment confirmation), `why` (acceptance acknowledged, payment not yet confirmed), `whatHappensNext` (payout scheduled on settlement / failure recorded with reason), `reportedBy`, `availableActions` (from the authority record).
6. **What evidence trail exists, and where is it reachable?** The acceptance + payment-watch record's evidence link.
7. **What can the merchant do from this state?** The authority-recorded available actions (watch the state page; prepare fulfilment; escalate if the payment window lapses).
8. **What must never be presented as/through this state?** No payout countdown invented client-side; no presentation of the waiting state as success or failure; no estimated settlement dates computed UI-side.
9. **What runtime caveat applies?** Mock payment-watch timelines are scripted; the real authority reports the transition out of this state.

---

## Record cko-map-06 — `declined` → SucceededState (`succeeded-declined`)

1. **What is the consequential state, in plain language?** The merchant's decline is recorded by the authority. The offer is closed to this merchant, the customer's intent moves on without this merchant's fulfilment, and no obligation from the offer applies.
2. **Which protocol object and authority state does it map from?** The checkout object in authority state `declined`, with the decline receipt (scenarios `cko_live_decline_001`, `cko_high_band_decline_001`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (checkout ledger).
4. **How does the surface learn this state?** `getStatus({ checkoutId })` (the decline follow-up id from `submitDecision`) → `resolveCheckoutDisplay`.
5. **Which shared display primitive presents it, with which fields?** `SucceededState` — a recorded decline is a *completed, evidenced* consequential outcome, not a failure — with `outcome` ("Checkout declined — your decline is recorded"), `reportedBy`, `evidence` (decline receipt); children state that the intent moves on, no obligations apply, and the receipt is the authority's record of the explicit refusal. The word "Succeeded" here refers to the *recording* of the merchant's explicit choice; the outcome text carries the decline semantics unambiguously.
6. **What evidence trail exists, and where is it reachable?** The decline receipt (mandatory evidence field).
7. **What can the merchant do from this state?** Nothing on this checkout: the decline is not reversible from this surface (a change of mind is a new decision on a new offer, recorded only by the authority).
8. **What must never be presented as/through this state?** No "undo decline" control (silent state mutation is forbidden); no framing of the decline as an error; no re-offering of the same decision controls.
9. **What runtime caveat applies?** Mock receipts are sandbox data; the real authority issues the authoritative decline receipt.

---

## Record cko-map-07 — `failed` → FailedState (`failed`)

1. **What is the consequential state, in plain language?** A checkout decision failed. The authority recorded a reason — e.g. protocol authorization refused the acceptance because the merchant identity lacks the high-band scope — and the checkout did not proceed.
2. **Which protocol object and authority state does it map from?** The checkout object in authority state `failed` with a recorded reason and suggested next actions (scenario `cko_fail_authorization_001`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority (and, where the failure is an authorization refusal, the protocol authorization path it names).
4. **How does the surface learn this state?** `getStatus({ checkoutId })` → `resolveCheckoutDisplay`; the reason and next actions come from the authority record verbatim.
5. **Which shared display primitive presents it, with which fields?** `FailedState` with `outcome` ("Checkout decision failed"), `reportedBy`, `reason` (mandatory; a fallback text is shown if the authority published none, and it says so), `nextActions` (authority-suggested), plus the evidence link in children.
6. **What evidence trail exists, and where is it reachable?** The authorization-refusal record's evidence link (children of the primitive).
7. **What can the merchant do from this state?** The authority-recorded next actions (request the missing scope, decline instead while the offer is open, re-check the page after remediation).
8. **What must never be presented as/through this state?** No guessed reason (never invent a cause when the authority published none); no automatic retry; no re-render of decision controls as if the offer were untouched (the offer's own state governs that, via the authority).
9. **What runtime caveat applies?** Mock failure reasons are scripted examples of the real authorization-refusal class.

---

## Record cko-map-08 — `unknown` → UnknownState (`unknown`) **[the UNKNOWN path]**

1. **What is the consequential state, in plain language?** The outcome of a submitted decision is genuinely UNKNOWN to this surface: the acceptance was routed, but no terminal acknowledgment or failure arrived before the response window closed. It may have been accepted, or refused, or still be in flight — the surface does not know and will not guess.
2. **Which protocol object and authority state does it map from?** The checkout object in authority state `unknown` (scenario `cko_unknown_001`).
3. **Which authority owns the truth of this state?** The Checkout/Intent Authority's reconciliation job (escalation owner: the operator on duty) — the named parties in the record's `reconciliation.whoResolves`.
4. **How does the surface learn this state?** `getStatus({ checkoutId })` → `resolveCheckoutDisplay`; the reconciliation block is carried by the authority record.
5. **Which shared display primitive presents it, with which fields?** `UnknownState` with `subject` ("The outcome of checkout {id} is UNKNOWN"), `explanation` (what happened and that no assumption is made), `reconciliation` { `whoResolves`, `recheckTrigger` } — the reconciliation path is explicit and reachable, never buried.
6. **What evidence trail exists, and where is it reachable?** The unknown-outcome watch record's evidence link; the reconciliation parties are named in the record.
7. **What can the merchant do from this state?** Re-check the state page on the published trigger (next reconciliation run) or after the operator confirms; do not re-decide until the authority publishes the resolved terminal state.
8. **What must never be presented as/through this state?** NEVER resolve UNKNOWN to a guess (no "probably accepted", no spinner that quietly becomes success, no treating a timeout as failure); no re-submission of the decision from this surface (that risks a double decision on a possibly-accepted checkout); no hiding the reconciliation path behind a collapsed control.
9. **What runtime caveat applies?** The mock scripts the lost-response path deterministically; the real authority's reconciliation timing and ownership are authoritative. This record id is the reconciliation record referenced by the UI-003 acceptance evidence for the UNKNOWN path.

---

## Explicit non-states (never presented as consequential checkout states)

- **Page load / navigation** to `/checkout`, `/checkout/[checkoutId]`, or the harness — loading a surface is not a state of any protocol object.
- **Client-side pending flags** (button pressed, fetch in flight) — presentation conditions, not authority states; while a submission is in flight the surface shows InProgressState *framing* but never claims a terminal outcome.
- **Adapter reachability conditions** — `checkout-not-found` and `authority-unreachable` errors from the port are NOT checkout states. They resolve to the `AvailabilityUnknownState` presentation (the surface states it cannot determine availability and claims nothing else). See `resolveCheckoutAdapterErrorPresentation` in `checkout-state-mapping.ts`.
- **The offer quote itself** (amounts, conditions, obligations) — authority-quoted data presented *before* any decision; it is not a consequential state, only the input to one.
- **Queue membership** — appearing in `listOpenCheckouts()` is derived from the `offered` state, not a separate state.
- **Offer lapse as a UI-side calculation** — expiry is authority-quoted (`validUntil`); the surface never computes "expired" locally and never manufactures countdown pressure.
- **"Decision-not-allowed" refusals of a submission** — an adapter-level refusal (the checkout is not awaiting a decision); the surface routes to the authority's recorded state instead of presenting a fabricated one.

---

## Non-negotiables honored by every record above (N1, P2–P7, UX contract Section 8)

- Every consequential state maps to a protocol object/state with an owning authority.
- No financial truth is computed UI-side; every amount is authority-quoted and rendered verbatim.
- Accept and decline are explicit, distinct, single-intent, non-pre-selected actions routed through protocol authorization.
- Nothing decision-relevant is collapsed before commitment; conditions and obligations are fully expanded.
- No silent state mutation; no obscured conditions; no optimistic terminal claims.
- The evidence trail is reachable for every consequential outcome.
