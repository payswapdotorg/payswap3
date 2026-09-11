# Waiting and recovery mapping records — UI-006

**Authority owner:** Fulfillment/Queue Authority — spec/architecture/v0.1, `liquidity-credit-queues.md`
**Runtime:** ARRIVING (the mock backing in `src/lib/protocol/mock-waiting-authority.ts` is presentation-only and NON-AUTHORITATIVE; sandbox data only)
**Surface:** waiting/queued/delayed presentation on the track surface — `/track/[referenceId]/waiting` and the waiting recovery panel composed onto the track detail surface
**Display mapping:** `src/lib/protocol/waiting-state-mapping.ts` (one-to-one authority state → display presentation)
**Record id scheme:** WQ-01 … WQ-16
**Port:** `src/lib/protocol/waiting-port.ts` — `getWaitingPort()` returns the mock backing until the authority implementation lands

Every waiting or recovery consequential state carries a complete nine-question mapping record below. The record set follows the format of `spec/product/intent-mapping-records.md`.

## The nine questions

Each record answers, in order:

1. What is the state?
2. Who owns and reports it?
3. What does the user see?
4. Why does this state exist?
5. What happens next?
6. What can the user do?
7. What time and progress information is shown, and is it authoritative?
8. What happens if the user does nothing?
9. How does the state end?

---

## Records

<a id="WQ-01"></a>
### WQ-01 — `fq.queued.liquidity-credit` (Queued — liquidity credit)

1. **What is the state?** Authority state `fq.queued.liquidity-credit`; display kind `queued`. The fulfillment is queued awaiting a liquidity credit allocation.
2. **Who owns and reports it?** The Fulfillment/Queue Authority (spec/architecture/v0.1, liquidity-credit-queues.md), via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `WaitingState` primitive titled with what is waiting, with the reason, the expectation, the reporter, and the available actions or the explicit "no action is available yet"; the recovery panel renders individually authorized actions beneath.
4. **Why does this state exist?** The payout entered the liquidity-credit queue before the current credit window opened; the authority has not yet allocated credit to this entry.
5. **What happens next?** When the authority allocates the liquidity credit, the queue releases the payout to settlement and the surface reports the released state.
6. **What can the user do?** Per-protocol, per-role: retry (merchant, operator, administrator — authorized; customer and provider see the disabled button with reason), cancel (customer and merchant while the cancellation window is open), escalate (customer, merchant, provider, administrator), and request a re-check (customer, merchant). When no action is available, the surface says so explicitly.
7. **What time and progress information is shown, and is it authoritative?** Only authority-quoted statements: the report timestamp and the authority's note that no completion estimate has been published. The UI never invents an estimate.
8. **What happens if the user does nothing?** The queue continues evaluating the entry; the state changes only when the authority publishes its next report, and the surface keeps showing the waiting state.
9. **How does the state end?** Explicitly: released to settlement (terminal succeeded, WQ-08), closed in failure (WQ-09), delayed into the next window (WQ-04), or reported unknown pending reconciliation (WQ-06/WQ-07). No dead end.

<a id="WQ-02"></a>
### WQ-02 — `fq.queued.provider-availability` (Queued — provider availability)

1. **What is the state?** Authority state `fq.queued.provider-availability`; display kind `queued`. The fulfillment is queued awaiting an available provider.
2. **Who owns and reports it?** The Fulfillment/Queue Authority, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `WaitingState` with what is waiting, the reason, the expectation, the reporter, and the available actions or the explicit none-yet; per-reference role checks apply (customer role is not permitted for provider-facing entries).
4. **Why does this state exist?** No provider serving this capability is currently accepting queue entries; the entry waits in the provider-availability queue.
5. **What happens next?** When a serving provider accepts the entry, fulfillment starts and the surface reports the started state.
6. **What can the user do?** Retry (merchant, operator, administrator), cancel (merchant while the window is open; customer is not permitted to view these entries), escalate (merchant, provider, administrator), request a re-check (merchant, provider). Unauthorized actions render disabled with their reason.
7. **What time and progress information is shown, and is it authoritative?** Only authority-quoted statements; no completion estimate is published and none is invented.
8. **What happens if the user does nothing?** The queue keeps the entry until a serving provider accepts it; the waiting state stays visible with its reason and expectation.
9. **How does the state end?** Explicitly: started and completed (WQ-08), failed (WQ-09, for example a provider exhausting its retry budget), delayed by provider backoff (WQ-05), or unknown pending reconciliation (WQ-06/WQ-07).

<a id="WQ-03"></a>
### WQ-03 — `fq.waiting.settlement-confirmation` (Waiting — settlement confirmation)

1. **What is the state?** Authority state `fq.waiting.settlement-confirmation`; display kind `waiting`. The fulfillment is handed off and waits for the settlement confirmation record.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reporting on the settlement authority's confirmation cycle, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `WaitingState` with what is waiting, the reason, the expectation, the reporter, and the available actions; the cancellation window is closed at this point, so cancel renders disabled with its reason.
4. **Why does this state exist?** The payout was handed to settlement confirmation; the settlement authority has not yet published its confirmation record.
5. **What happens next?** When the settlement authority publishes its confirmation record, the surface reports the confirmed outcome.
6. **What can the user do?** Retry (merchant, operator, administrator), escalate (customer, merchant, provider, administrator), request a re-check (customer, merchant). Cancel is not authorized after handoff — the window closed.
7. **What time and progress information is shown, and is it authoritative?** Only authority-quoted statements; no completion estimate is published and none is invented.
8. **What happens if the user does nothing?** The confirmation cycle continues; if the authority's report does not arrive before the wait closes, the state becomes unknown-after-timeout (WQ-07) — never silently a failure.
9. **How does the state end?** Explicitly: confirmed and completed (WQ-08), failed (WQ-09), or unknown after the wait closed (WQ-07) with its reconciliation path.

<a id="WQ-04"></a>
### WQ-04 — `fq.delayed.liquidity-window` (Delayed — liquidity window)

1. **What is the state?** Authority state `fq.delayed.liquidity-window`; display kind `delayed`. The planned liquidity window closed without an allocation; the entry is re-queued.
2. **Who owns and reports it?** The Fulfillment/Queue Authority, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `WaitingState` (delayed) with what is waiting, the reason as reported, the expectation for the next window, the reporter, and the available actions.
4. **Why does this state exist?** The credit window the authority planned for this entry closed without an allocation; the entry has been re-queued for the next window.
5. **What happens next?** The re-queued entry is evaluated in the next credit window; the surface reports the released or re-delayed state when the authority publishes it.
6. **What can the user do?** Retry (merchant, operator, administrator), escalate (customer, merchant, provider, administrator), request a re-check (customer, merchant). Cancel is not authorized after handoff.
7. **What time and progress information is shown, and is it authoritative?** Only the authority's statements — including that no completion estimate is published. The delay is a fact reported by the authority, not a UI-invented ETA.
8. **What happens if the user does nothing?** The entry is evaluated in the next window; the state stays visible with its reason and expectation until the authority publishes.
9. **How does the state end?** Explicitly: released (WQ-08), failed (WQ-09), re-delayed (WQ-04 again, reported as a new authority report), still-unknown (WQ-10), or unknown pending reconciliation (WQ-06/WQ-07). No indefinite ambiguous spinner.

<a id="WQ-05"></a>
### WQ-05 — `fq.delayed.provider-backoff` (Delayed — provider backoff)

1. **What is the state?** Authority state `fq.delayed.provider-backoff`; display kind `delayed`. The serving provider is in retry backoff and the entry is held.
2. **Who owns and reports it?** The Fulfillment/Queue Authority, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `WaitingState` (delayed) with what is waiting, the reason, the expectation, the reporter, and the available actions; per-reference roles apply (provider-facing entry).
4. **Why does this state exist?** The serving provider reported a retry backoff after a failed attempt; the authority holds the entry until the backoff releases it for another attempt.
5. **What happens next?** When the backoff releases the entry, the provider retries and the surface reports the retried state.
6. **What can the user do?** Retry (merchant, operator, administrator), escalate (merchant, provider, administrator), request a re-check (merchant, provider). Cancel is not authorized after handoff.
7. **What time and progress information is shown, and is it authoritative?** Only the authority's statements; the backoff is described as a condition, not as a duration estimate.
8. **What happens if the user does nothing?** The backoff releases the entry on the authority's schedule; if retries exhaust, the flow ends in failure (WQ-09); if reports stop, it ends unknown (WQ-06/WQ-07).
9. **How does the state end?** Explicitly: retried and completed (WQ-08), failed after the retry budget is exhausted (WQ-09), still-unknown (WQ-10), or unknown pending reconciliation (WQ-06/WQ-07).

<a id="WQ-06"></a>
### WQ-06 — `fq.unknown.pending-reconciliation` (Unknown — pending reconciliation)

1. **What is the state?** Authority state `fq.unknown.pending-reconciliation`; display kind `unknown`. The queue report for the entry is pending reconciliation; no authoritative outcome exists yet.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reconciliation sweep, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** An `UnknownState` primitive with the subject, the explanation ("not a failure and not a success"), and the reconciliation path (who re-checks, on what trigger), plus what the user will see next. Never a success or failure presentation, and never an indefinite spinner.
4. **Why does this state exist?** The authority's queue report for this entry is being reconciled; until the sweep publishes, the outcome does not exist.
5. **What happens next?** The reconciliation sweep re-checks the authoritative state and publishes the result; the surface reports what it publishes.
6. **What can the user do?** Request a re-check (customer, merchant) — an explicit request with "what happens next" wording and no ETA. Recovery actions are not authorized while unknown: reconciliation reports first, and the buttons render disabled with that reason.
7. **What time and progress information is shown, and is it authoritative?** Only the reconciliation trigger ("the next reconciliation sweep") — a trigger, not a time estimate. No completion time is estimated.
8. **What happens if the user does nothing?** The sweep runs on its trigger regardless; the unknown state stays visible with its reconciliation path. No user action is required for reconciliation to happen.
9. **How does the state end?** Explicitly: a terminal state (WQ-08/WQ-09) or an explicitly-still-unknown state (WQ-10) with reconciliation continuing — never a silent failure or success.

<a id="WQ-07"></a>
### WQ-07 — `fq.unknown.after-wait-timeout` (Unknown — after wait timeout)

1. **What is the state?** Authority state `fq.unknown.after-wait-timeout`; display kind `unknown`. The wait for the authority's report timed out without an authoritative outcome.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reconciliation sweep, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** An `UnknownState` with the subject, the explanation ("not a failure and not a success"), the preceding wait, the reconciliation path, and what the user will see next.
4. **Why does this state exist?** The authority's report did not arrive before the wait closed; the entry is marked unknown pending reconciliation.
5. **What happens next?** The next reconciliation sweep after the wait closed re-checks the authoritative state; the surface reports an explicit terminal state or an explicitly-still-unknown state.
6. **What can the user do?** Request a re-check (customer, merchant). Recovery actions are not authorized while unknown — reconciliation reports first.
7. **What time and progress information is shown, and is it authoritative?** Only the reconciliation trigger; no completion time is estimated and none is invented.
8. **What happens if the user does nothing?** The sweep runs on its trigger; the unknown state remains visibly unknown with its path.
9. **How does the state end?** Explicitly: terminal (WQ-08/WQ-09) or still-unknown (WQ-10) with continuing reconciliation.

<a id="WQ-08"></a>
### WQ-08 — `fq.resolved.completed` (Resolved — completed)

1. **What is the state?** Authority state `fq.resolved.completed`; display kind `resolved-succeeded`. A terminal state: the delayed-fulfillment flow completed.
2. **Who owns and reports it?** The Fulfillment/Queue Authority, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `SucceededState` primitive with the outcome, the reporter, and the evidence link.
4. **Why does this state exist?** The liquidity credit was allocated and the payout settled (or the equivalent completion reported by the authority).
5. **What happens next?** Nothing further on this flow; evidence is linked. No follow-on action is required.
6. **What can the user do?** View the evidence. Retry and cancel do not apply and render disabled with reasons; escalate does not apply for completed fulfillments. No re-check is needed.
7. **What time and progress information is shown, and is it authoritative?** The authority's report timestamp only.
8. **What happens if the user does nothing?** Nothing; the state is terminal and stays visible.
9. **How does the state end?** It is the end — an explicit terminal state.

<a id="WQ-09"></a>
### WQ-09 — `fq.resolved.failed` (Resolved — failed)

1. **What is the state?** Authority state `fq.resolved.failed`; display kind `resolved-failed`. A terminal state: the flow ended in failure.
2. **Who owns and reports it?** The Fulfillment/Queue Authority, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** A `FailedState` primitive with the outcome, the reporter, the authority-quoted reason, and the next actions.
4. **Why does this state exist?** The serving provider exhausted its retry budget and the authority closed the fulfillment.
5. **What happens next?** The stated next actions: start a dispute with the merchant of record, escalate the failure for operator review, or keep the reference for support.
6. **What can the user do?** Escalate (customer, merchant, administrator) and the stated next actions. Retry and cancel do not apply. This is an explicit ending, not a dead end.
7. **What time and progress information is shown, and is it authoritative?** The authority's report timestamp only.
8. **What happens if the user does nothing?** The state stays terminal and visible; no automatic follow-on occurs on this surface.
9. **How does the state end?** It is the end — an explicit terminal state with explicit next actions.

<a id="WQ-10"></a>
### WQ-10 — `fq.resolved.still-unknown` (Ended — still unknown)

1. **What is the state?** Authority state `fq.resolved.still-unknown`; display kind `resolved-still-unknown`. The delayed-fulfillment flow ended and the authoritative outcome is still unknown.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reconciliation sweep, via the waiting port. Runtime ARRIVING.
3. **What does the user see?** An `UnknownState` with the subject, the explanation that this is an explicitly-still-unknown ending and not a dead end, the reconciliation path, and what the user will see next.
4. **Why does this state exist?** The flow's wait ended without an authoritative outcome; reconciliation continues until one exists.
5. **What happens next?** Each reconciliation sweep until an authoritative outcome exists; the surface reports the explicit terminal state when it publishes.
6. **What can the user do?** Request a re-check (customer, merchant, provider) and escalate (customer, merchant, provider, administrator). Retry and cancel are not authorized while unknown.
7. **What time and progress information is shown, and is it authoritative?** Only the reconciliation trigger; no completion time is estimated.
8. **What happens if the user does nothing?** Reconciliation continues on its trigger; the state stays explicitly still-unknown — never silently recategorized.
9. **How does the state end?** When an outcome exists: the explicit terminal state (WQ-08/WQ-09) replaces this state. Until then it is the explicit ending.

<a id="WQ-11"></a>
### WQ-11 — `fq.recovery.retry-requested` (Retry requested)

1. **What is the state?** Authority state `fq.recovery.retry-requested`; display kind `recovery-requested`. A consequential state of an accepted retry request.
2. **Who owns and reports it?** Protocol authorization routed to the Fulfillment/Queue Authority (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An `InProgressState` primitive: the retry request routed to protocol authorization, what completes it, what happens next, and what the user will see. The request is a request — the panel states that requesting did not change any financial state.
4. **Why does this state exist?** An authorized party requested a queue re-evaluation.
5. **What happens next?** The authority re-evaluates the queue entry and publishes its decision.
6. **What can the user do?** Wait for the published outcome, request a re-check, or escalate. Requesting retry again is possible but the authority decides.
7. **What time and progress information is shown, and is it authoritative?** None beyond the routing and the publication promise; no ETA is invented.
8. **What happens if the user does nothing?** The authority's evaluation completes on its own; the outcome is published here regardless.
9. **How does the state end?** The published outcome replaces the request state (WQ-08/WQ-09/WQ-10 or a new condition). A request is never itself an outcome.

<a id="WQ-12"></a>
### WQ-12 — `fq.recovery.cancel-requested` (Cancel requested)

1. **What is the state?** Authority state `fq.recovery.cancel-requested`; display kind `recovery-requested`. A consequential state of an accepted cancel request.
2. **Who owns and reports it?** Protocol authorization routed to the Fulfillment/Queue Authority (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An `InProgressState`: the cancel request routed to protocol authorization, what completes it, what happens next, and what the user will see (the stopped state, or the window-closed denial).
4. **Why does this state exist?** An authorized party requested cancellation inside the protocol window.
5. **What happens next?** The authority evaluates the cancellation request under the protocol window.
6. **What can the user do?** Wait for the published outcome; escalate if the window closed and the dispute flow is the path.
7. **What time and progress information is shown, and is it authoritative?** None beyond the routing and publication promise; no ETA is invented.
8. **What happens if the user does nothing?** The authority's evaluation completes and is published; the request itself changed nothing.
9. **How does the state end?** The published stopped state or the window-closed denial; a request is never itself an outcome and never a silent mutation.

<a id="WQ-13"></a>
### WQ-13 — `fq.recovery.escalate-requested` (Escalate requested)

1. **What is the state?** Authority state `fq.recovery.escalate-requested`; display kind `recovery-requested`. A consequential state of an accepted escalation request.
2. **Who owns and reports it?** Protocol authorization routed to operator review (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An `InProgressState`: the escalation routed to operator review, what completes it, what happens next, and what the user will see.
4. **Why does this state exist?** A party to the fulfillment (or an administrator on their behalf) escalated it for review.
5. **What happens next?** The operator review proceeds and publishes its outcome.
6. **What can the user do?** Wait for the review outcome; keep the reference for the review.
7. **What time and progress information is shown, and is it authoritative?** None beyond the routing; no ETA is invented.
8. **What happens if the user does nothing?** The review proceeds on its own; the outcome is published here.
9. **How does the state end?** The review outcome replaces the request state. A request is never itself an outcome.

<a id="WQ-14"></a>
### WQ-14 — `fq.recovery.denied` (Recovery not authorized)

1. **What is the state?** Authority state `fq.recovery.denied`; display kind `recovery-denied`. A consequential state: a recovery request was refused by protocol authorization.
2. **Who owns and reports it?** Protocol authorization (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An explicit inline result: "Not authorized — no request was routed", with the per-protocol reason and the note that the denial is itself an authorized outcome (nothing happened silently). The corresponding button is disabled with the same reason.
4. **Why does this state exist?** The requested action is not authorized for this role in this state — for example, customers do not request re-queue evaluation directly; cancel is closed after handoff; operators are the escalation destination.
5. **What happens next?** Nothing was routed, so the fulfillment state is unchanged and stays visible with its other options.
6. **What can the user do?** Choose an authorized path: another action that is enabled, request a re-check, or the next actions stated on the fulfillment state.
7. **What time and progress information is shown, and is it authoritative?** None; a denial carries no timing claims.
8. **What happens if the user does nothing?** The fulfillment state continues per its own record; the denial changed nothing.
9. **How does the state end?** It is an inline request result presented next to the action; the fulfillment state record governs the flow.

<a id="WQ-15"></a>
### WQ-15 — `fq.inquiry.recheck-requested` (Re-check requested)

1. **What is the state?** Authority state `fq.inquiry.recheck-requested`; display kind `inquiry-requested`. A consequential state of an accepted re-check request.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reconciliation sweep (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An `InProgressState`: the request routed to the reconciliation sweep, who re-checks, what triggers the re-check, what happens next, and what the user will see — with the explicit statement that no completion time is estimated.
4. **Why does this state exist?** An authorized party requested a re-check of the authoritative state.
5. **What happens next?** The request attaches to the next reconciliation sweep; the sweep re-checks the authoritative state.
6. **What can the user do?** Wait for the published result. A re-check request does not force an outcome and does not change any financial state.
7. **What time and progress information is shown, and is it authoritative?** The trigger only ("the next reconciliation sweep"); no ETA is invented or implied.
8. **What happens if the user does nothing?** The sweep runs on its trigger anyway; the request only attaches to it.
9. **How does the state end?** The sweep's published result — an explicit terminal state or explicitly-still-unknown — replaces the request state.

<a id="WQ-16"></a>
### WQ-16 — `fq.inquiry.rejected` (Re-check request not accepted)

1. **What is the state?** Authority state `fq.inquiry.rejected`; display kind `inquiry-rejected`. A consequential state: a re-check request was rejected.
2. **Who owns and reports it?** The Fulfillment/Queue Authority reconciliation sweep (mock stand-in until ARRIVING), via the waiting port.
3. **What does the user see?** An explicit inline result: "Re-check request not accepted", with the reason (for example, the role does not request re-checks on this reference, or the fulfillment is complete), and the note that nothing was routed and nothing changed.
4. **Why does this state exist?** The requester is not permitted to request re-checks for this reference, or no re-check applies in the current state.
5. **What happens next?** The fulfillment state stays visible with its own options; when it is unknown, the reconciliation path stays visible regardless.
6. **What can the user do?** Use the options that are available on the fulfillment state; switch to a permitted audience in the simulated shell when verifying.
7. **What time and progress information is shown, and is it authoritative?** None.
8. **What happens if the user does nothing?** Nothing changed; the fulfillment state record governs.
9. **How does the state end?** It is an inline request result; the fulfillment state record governs the flow. No dead end is created.

---

## Explicit non-states

The following are explicitly NOT authority states; they are presentations or clarifications and never render as states of record:

- **"No action is available yet"** is a presentation of a condition's action set, not an authority state. It appears when the authority reports that no user action is open (for example, inside the minimum wait window).
- **UNKNOWN is not failure and not success.** It is unresolved pending reconciliation and renders as `UnknownState` with its reconciliation path, never as `FailedState` or `SucceededState`.
- **Queued is not in progress.** Nothing is executing; the entry awaits capacity, so it renders as `WaitingState`, not `InProgressState`.
- **Delayed is not failed.** The authority still expects completion, without publishing an estimate; a delay is never presented as an error.
- **A recovery request is not a recovery outcome.** Requesting retry, cancel, or escalate never mutates financial state; only the authority's decision does, and it is reported as a new state of record.
- **An inquiry (re-check request) is not a state change of the fulfillment.** It attaches to the reconciliation sweep and changes nothing by itself.
- **"Ended — still unknown" is not a dead end.** Reconciliation continues and stays visible until an authoritative outcome exists.

---

## Mock and authority boundaries

- The mock backing (`src/lib/protocol/mock-waiting-authority.ts`) is presentation-only, NON-AUTHORITATIVE, and holds sandbox data only. The Fulfillment/Queue Authority implementation (per spec/architecture/v0.1, liquidity-credit-queues.md) is ARRIVING; when it lands, it replaces the mock behind `getWaitingPort()` and nothing else on the surface changes.
- The mock's scripting API exists for the UI-006 verification harness and can script fulfillment phases only. It cannot script a recovery or an inquiry outcome: the only path to an accepted recovery result is `requestRecovery()`, which assesses authorization per request and refuses anything not individually authorized per protocol.
- No time or progress estimate in this document or in the UI is authoritative unless the authority reported it. Where the authority has published no estimate, the surface says so explicitly.
