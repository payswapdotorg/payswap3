# UI-008 — Mediation & dispute mapping records

**Work order:** UI-008 — Agent proposal, mediation, and dispute/recourse surfaces
**Authority owners:** the Agents/Mediation Authority (spec/architecture/v0.1/extensions-agents-merchant.md — agent proposals, human mediation) and the Disputes/Recourse Authority (spec/architecture/v0.1/disputes-federation-blockchain-emergence.md — disputes, recourse paths).
**Runtime:** ARRIVING — every record below is currently backed by the presentation-only mock authority (src/lib/protocol/mock-mediation-authority.ts). The mock is never authoritative and never scripts an unauthorized decision.
**Format:** follows the intent-mapping-records.md record set — header with authority owner + runtime, the nine-question record set per consequential state, and the explicit non-states list at the end.
**Mapping implementation:** one-to-one, in src/lib/protocol/mediation-state-mapping.ts; each record id (MD-*) is emitted by the mapping and rendered through the shared state primitives in @/components/state.

The nine questions answered by every record:
1. What state is being reported, and by which authority?
2. Which display presentation does it map to (primitive + record id)?
3. What must the party understand before acting?
4. Which actions are authorized for whom, and how are they surfaced?
5. What happens after each authorized action?
6. What evidence is visible?
7. How are the state and its outcomes announced accessibly?
8. What are the failure and UNKNOWN neighbors, and how do they differ?
9. What is explicitly NOT this state?

---

## Agent proposals (authority: Agents/Mediation Authority)

### MD-001 — proposal awaiting a human decision
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The proposal is live and awaits an explicit decision; the agent that proposed it cannot apply it.
2. `ActionRequiredState` — MD-001 — with validity (authority-quoted window) and consequence of inaction (expiry).
3. The complete consequences of all four decisions (accept/reject/counter/escalate) are shown in full, above the decision controls; nothing is collapsed.
4. Only the party the proposal is addressed to (its customer or merchant) is authorized for all four decisions; the counterparty, providers, operators, and administrators are denied with reasons. Buttons are native, keyboard-operable, and unauthorized ones render disabled with the authority's reason.
5. Accept → MD-002; reject → MD-003; counter → MD-004 and a new decision proposal for the counterparty; escalate → MD-005. Every path goes through POST /api/mediation/decision with the actor resolved server-side and re-validated by the authority; denials are displayed, never swallowed.
6. Proposal evidence references (swap tracking, intent, authority-verified copies) are visible before and after any decision.
7. The pending state itself is visible text; each applied or denied outcome is announced through the polite live region (sr-only `role="status"`), including the authorization reference.
8. Expiry moves to MD-006 (validity closed, decisions refused); if the authority cannot report the state, MD-007 (UNKNOWN, decisions withheld). These differ from MD-001 by being non-actionable.
9. NOT a loading state, NOT an automatically-applied proposal, and NOT a state where any role other than the addressed party may decide.

### MD-002 — proposal acceptance applied
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. An acceptance was recorded by the authority under protocol authorization and the accepted consequences stand.
2. `SucceededState` — MD-002 — outcome is the authority's exact acceptance wording.
3. The decision is single-shot: no further decision is accepted on this proposal; a new proposal is required for changes.
4. No decision actions are authorized anymore (denied with "decisions are single-shot"); only recheck remains.
5. N/A (terminal for the proposal); the counterparty is notified with the same wording; the proof trail gains the authorization record.
6. The decision record (decided-by, timestamp, authorizationRef) and proof links (authorization record, swap tracking) are rendered as children of the primitive.
7. "Decision applied: … Authorization record AUTHZ-…" is announced politely on completion.
8. MD-003 (rejection) is the sibling terminal state; MD-007 (UNKNOWN) would mean even this outcome could not be reported.
9. NOT a reversible outcome (reversal requires a dispute), NOT the swap's completion state itself, and NOT silently applied.

### MD-003 — proposal rejection recorded
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. A rejection was recorded; the proposal is closed and the rejected consequences stand.
2. `FailedState` — MD-003 — with the decider and closure wording as reason, plus next actions.
3. The proposal stays closed; the counterparty is notified; a new proposal is required for any change.
4. No decisions authorized (single-shot); recheck remains.
5. N/A (terminal); the dispute path remains open to both parties if they disagree with how the reference now stands.
6. Decision record and proof links, as with MD-002.
7. "Decision applied: …" politely announced (the authority's rejection wording).
8. MD-002 is the sibling; expiry (MD-006) differs because no decision existed to record.
9. NOT a protocol failure, NOT a dispute outcome, and NOT reversible by the deciding party alone.

### MD-004 — proposal countered (counter-terms with the counterparty)
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. Counter-terms were recorded and transmitted to the counterparty for an explicit decision.
2. `InProgressState` — MD-004 — what completes it is the counterparty's decision or the counter's validity window.
3. Nothing further is required from the countering party; the counterparty now sees a spawned decision proposal with complete consequences.
4. No further decisions on the original proposal (single-shot); the counterparty decides on the spawned proposal under its own MD-001.
5. The counterparty's decision on the spawned proposal reaches MD-002/MD-003 for it; the original stays recorded.
6. Both the counter authorization record and the spawned proposal's evidence are visible.
7. "Decision applied: [counter wording]…" announced politely.
8. MD-005 (escalation) hands review to the authority instead of the counterparty; MD-007 (UNKNOWN) withholds even this transmission status if the authority is unreachable.
9. NOT an agreement yet — the counterparty has not accepted anything — and NOT silent.

### MD-005 — proposal escalated to human review
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The proposal is under human review by the authority after an escalation.
2. `InProgressState` — MD-005 — completes when the review's outcome wording is reported.
3. Escalation changed nothing about the swap's current state; the review outcome will be reported with its wording.
4. No party decisions are authorized anymore on this proposal; recheck is the action.
5. The authority's review outcome wording will replace this state when reported (runtime ARRIVING; the harness scripts authority-owned mediation outcomes for evidence).
6. Escalation authorization record and swap tracking evidence remain visible.
7. "Decision applied: [escalation wording]…" announced politely.
8. MD-004 keeps the decision with the counterparty; MD-007 would mean the review state cannot be reported.
9. NOT a dispute, NOT a mediation (escalation of an agent proposal is review by the Agents/Mediation Authority), and NOT a failure.

### MD-006 — proposal expired
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The authority-quoted validity window closed without a decision.
2. `FailedState` — MD-006 — with the validity wording as reason and next actions.
3. No decision is accepted on this proposal anymore; the swap keeps its current state.
4. All four decisions are denied with the expiry reason (buttons disabled with that reason).
5. N/A (terminal); a new proposal would be required to change anything; the dispute path remains open.
6. The proposal's evidence and validity wording stay visible.
7. State is visible text; no decision can be submitted, so no decision announcement is produced.
8. MD-003 has a recorded decision; MD-006 has none. MD-007 is UNKNOWN, not expired.
9. NOT a decision by anyone, NOT a failure of the authority, and NOT hidden from the addressee.

### MD-007 — proposal state UNKNOWN
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The authority cannot currently report the proposal's state.
2. `UnknownState` — MD-007 — with reconciliation: who resolves (the authority; availability on the operator oversight surface) and the recheck trigger.
3. No state is assumed and no decision can be accepted while the state is UNKNOWN.
4. All decisions are denied with the UNKNOWN reason; recheck is offered and records nothing on the party's behalf.
5. A successful recheck re-reports the actual state (any of the others); a failed recheck announces the unreachable authority.
6. Already-recorded decisions/proof (if any prior state was recorded) remain visible; nothing is invented.
7. Recheck outcomes are announced politely, including explicit "availability is UNKNOWN" wording.
8. MD-400 (availability unknown) applies when the record itself cannot be fetched at all; MD-007 is a fetched record whose state is UNKNOWN.
9. NOT "expired", NOT "decided", NOT an error page, and never silently defaulted to another state.

---

## Mediation (authority: Agents/Mediation Authority)

### MD-101 — mediation open
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. Mediation is open between the parties.
2. `InProgressState` — MD-101 — completes on all-party acceptance of a proposed resolution or the authority's determination.
3. Both parties see the same thread, authority notices, and any proposed resolution; statements are recorded verbatim.
4. Parties (customer/merchant of the case) may submit statements; where a proposed resolution is open, accept/decline are additionally authorized. Non-parties cannot open the case at all (role-checked fetch).
5. Statement → appended verbatim with an authorization record; accept → recorded, applies when every party accepted; decline → recorded, the authority then determines.
6. Thread messages with their evidence; mediation reference and linked dispute.
7. Each action outcome is announced politely with the authorization reference; resolution wording is announced verbatim.
8. MD-102 (awaiting a party) names a blocked participant; MD-104 records failure; MD-105 is UNKNOWN.
9. NOT an agreement, NOT a dispute state, and NOT editable history.

### MD-102 — mediation awaiting a party
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The mediation waits on a named party's participation.
2. `WaitingState` — MD-102 — what is waiting, why, what happens next, and the viewer's authorized available actions.
3. The mediation cannot advance until every party participates; the authority does not proceed for a party.
4. The responding party may still submit statements (and act on a proposed resolution where open); the awaited party's controls are the same once they respond.
5. The awaited party's response flips their status and can move the case to open; window closure moves to MD-104.
6. Thread, authority notices, and party participation statuses are visible.
7. Participation changes are announced politely.
8. MD-101 has everyone responding; MD-105 withholds even the participation picture.
9. NOT a failure and NOT blame — the state names the party without asserting intent.

### MD-103 — mediation resolved
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The mediation is resolved with the authority's determination or all-party acceptance.
2. `SucceededState` — MD-103 — outcome is the authority's EXACT wording, never rewritten by presentation.
3. The resolution wording governs; the linked dispute's recourse trail records the same outcome.
4. No further party actions are authorized (denied with the resolved reason).
5. N/A (terminal for the mediation); the linked dispute (if any) reflects the outcome.
6. Resolution proof (determination record, swap tracking) rendered with the primitive plus additional proof links.
7. The resolution wording is announced politely when it appears.
8. MD-104 is the authority's failure record, not a resolution; MD-105 is UNKNOWN.
9. NOT "the customer won/lost" unless the wording says so, and NOT a monetary execution (amounts appear only as authority-quoted wording).

### MD-104 — mediation failed
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The mediation failed (for example, the participation window closed without every party responding).
2. `FailedState` — MD-104 — with the authority's reason and next actions.
3. The failure is recorded as proof; it does not close the dispute's recourse path.
4. No further party actions in the mediation; the dispute's recourse trail carries next steps.
5. N/A (terminal for the mediation); recourse continues on the dispute record.
6. Failure reason, next actions, and the thread's history remain fully visible.
7. The failure outcome is announced politely when reported.
8. MD-103 is a resolution; MD-105 means the state itself cannot be reported.
9. NOT a party's defeat and NOT erased history.

### MD-105 — mediation state UNKNOWN
- **Authority owner:** Agents/Mediation Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The authority cannot currently report the mediation's state.
2. `UnknownState` — MD-105 — with reconciliation (who resolves; recheck trigger).
3. Party actions are withheld; no state is assumed.
4. All actions denied with the UNKNOWN reason; recheck offered.
5. Recheck re-reports the actual state or announces continued unreachability.
6. The thread's previously recorded messages and proofs remain visible; nothing is invented about the current state.
7. Recheck outcomes announced politely with explicit UNKNOWN wording.
8. MD-400 applies when the record cannot be fetched at all.
9. NOT failed, NOT resolved, and NOT a presentation fallback that guesses.

---

## Disputes (authority: Disputes/Recourse Authority)

### MD-201 — dispute open with the authority
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The dispute is accepted for review; automated completion of the referenced swap is paused (authority wording).
2. `InProgressState` — MD-201 — completes on the grounds review's referral or rejection.
3. Grounds, the initiator's account, and evidence are shared with the authority and the other party; the pause is authority-quoted.
4. The parties may track recourse (recheck); initiation itself is closed. Non-parties cannot open the record (role-checked fetch).
5. The authority either refers to mediation (MD-202) or rejects the grounds (MD-204).
6. The dispute record's evidence, the initiator's verbatim account, and the recourse trail with proof.
7. Referral/rejection outcomes announced politely on recheck; state text visible.
8. MD-202 moves to mediation; MD-205 is UNKNOWN; MD-204 is a rejection.
9. NOT a judgment against anyone and NOT an automatic refund/charge (no financial authority here).

### MD-202 — dispute in mediation
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The dispute has been referred to mediation between the parties.
2. `InProgressState` — MD-202 — completes on the mediation's determination, recorded verbatim on the dispute.
3. The mediation's own state (MD-101..MD-105) is reported on the linked thread; the dispute mirrors the determination when it lands.
4. Parties act in the mediation thread (statements, resolution decisions); the dispute surface tracks and links.
5. A mediation determination resolves the dispute (MD-203) and completes the mediation recourse stage with its proof.
6. Linked mediation thread, recourse trail, and each stage's proof.
7. Determination wording announced politely when rechecked in.
8. MD-201 (still under grounds review) vs MD-203 (determined); MD-205 is UNKNOWN.
9. NOT a mediation state itself — the thread owns that presentation — and NOT a party decision.

### MD-203 — dispute resolved
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The dispute is resolved with the authority's determination wording.
2. `SucceededState` — MD-203 — outcome is the exact determination wording.
3. The recourse window on the determined outcome is tracked as a recourse stage (authority-quoted window), not silently closed.
4. Parties track the recourse window; escalation paths open per the frozen architecture when the wording requires them.
5. Recourse-window closure and federation escalation are tracked as stages (MD-301..MD-306).
6. Determination proof, mediation determination record, swap tracking evidence.
7. Determination wording announced politely when it appears.
8. MD-204 is a rejection (grounds not upheld); MD-205 is UNKNOWN.
9. NOT the end of recourse (the window and escalation stages remain explicit) and NOT a computed amount.

### MD-204 — dispute failed (grounds rejected)
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The authority did not uphold the dispute (for example, the grounds did not match the recorded protocol events).
2. `FailedState` — MD-204 — with the authority's reason and next actions.
3. The recorded protocol events stand; a new dispute needs different grounds and new evidence.
4. Parties may track the trail; no further party actions on the failed dispute.
5. N/A (terminal); the recourse trail keeps the completed stages' proof.
6. Grounds-review record and the failure reason with next actions.
7. Failure outcome announced politely when reported.
8. MD-203 is an upheld determination; MD-205 is UNKNOWN.
9. NOT a mediation failure (that is MD-104) and NOT a party's bad-faith finding.

### MD-205 — dispute state UNKNOWN
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The authority cannot currently report the dispute's state.
2. `UnknownState` — MD-205 — with reconciliation.
3. No state assumed; no party action accepted; already-recorded recourse proof stands.
4. Recheck only.
5. Recheck re-reports the actual state or announces continued unreachability.
6. The recorded recourse trail (completed stages with proof) remains visible.
7. Recheck outcomes announced politely with explicit UNKNOWN wording.
8. MD-400 applies when the record cannot be fetched at all.
9. NOT failed, NOT resolved, and never guessed.

### MD-206 — dispute initiation (pre-submit)
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The party is composing an initiation; nothing exists at the authority yet.
2. `ActionRequiredState` — MD-206 — with consequence-of-inaction wording from the authority briefing.
3. The authority's consequence wording is shown in full BEFORE the submit control; grounds are explicit; evidence-required grounds gate submission.
4. Only a party to the referenced swap may initiate; open/resolved dispute states on the reference deny with reasons. Submit opens an inline confirmation restating grounds and consequences; nothing opens until confirmed.
5. Confirm → the authority accepts (new dispute, MD-201, recourse trail started with proof) or denies with the displayed reason.
6. The briefing's consequences, ground descriptions, and the swap references offered.
7. Initiation accepted/denied announced politely.
8. After submission the record moves to MD-201 or a denial message; MD-400 if the authority is unreachable.
9. NOT a submitted dispute, NOT silent, and NOT available to non-parties.

---

## Recourse stages (authority: Disputes/Recourse Authority)

### MD-301 — recourse stage completed
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. A recourse stage (dispute-opened, grounds review, mediation determination, recourse window, federation escalation, closure) completed.
2. `SucceededState` — MD-301 — outcome is the stage's authority wording; evidence is its primary proof.
3. The proof trail for every consequential outcome is the point: wording + proof links per stage.
4. Recheck the tracker; stages are authority-driven, not party-decided.
5. Later stages open or stay pending per the recorded outcomes.
6. All of the stage's proof links (additional ones render under the primitive).
7. Stage outcomes announced politely on recheck changes.
8. MD-302/MD-303 are non-terminal; MD-305 is a stage failure; MD-306 is UNKNOWN.
9. NOT a dispute resolution by itself — the dispute-level state (MD-203) governs the overall outcome.

### MD-302 — recourse stage in progress
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The stage is actively with its owning authority.
2. `InProgressState` — MD-302 — completes on the stage's recorded outcome with proof.
3. Nothing for the party to do on the stage itself.
4. Recheck only.
5. Completion records wording + proof (MD-301); failure records MD-305.
6. The authority owning the stage is named.
7. Changes announced politely.
8. MD-303 names a party dependency; MD-304 has not opened at all.
9. NOT a party action pending and NOT UNKNOWN.

### MD-303 — recourse stage awaiting a party
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The stage waits on a party's participation (for example, the mediation stage awaiting a party).
2. `WaitingState` — MD-303 — what is waiting, why, what happens next.
3. The authority does not proceed for a party; the party acts on the linked surface (mediation thread).
4. Party actions live on the linked mediation thread; the tracker links to it.
5. The party's response advances the stage; window closure can fail it (MD-305).
6. Link to the linked surface plus the stage's authority.
7. Changes announced politely.
8. MD-302 has no party dependency; MD-304 not opened.
9. NOT a failure of the party and NOT the mediation's own presentation (MD-102 owns that).

### MD-304 — recourse stage pending (not triggered)
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The stage exists on the path but has not opened (for example, federation escalation not requested).
2. `WaitingState` — MD-304 — waiting on the prior outcomes that would require it.
3. Pending is explicit, not hidden: the party sees the whole path ahead.
4. No action available for this stage; earlier surfaces govern.
5. Prior stages' outcomes open it (or leave it pending forever if never required).
6. The stage's authority and its place in the ordered trail.
7. Changes announced politely if the stage opens.
8. MD-303 differs because a party is explicitly being waited on.
9. NOT a failure, NOT an offer of action, and NOT UNKNOWN.

### MD-305 — recourse stage failed
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. A stage failed (for example, grounds review rejected the cited grounds).
2. `FailedState` — MD-305 — with the stage's failure wording as reason and next actions.
3. Completed stages keep their proof; failure does not erase history.
4. Follow the dispute record's next actions.
5. Terminal for the stage.
6. The stage's own proof and the failure wording.
7. Announced politely when reported.
8. MD-301 keeps recorded outcomes; MD-306 is UNKNOWN.
9. NOT necessarily the dispute's overall failure state (MD-204 governs that) unless the authority's wording says so.

### MD-306 — recourse stage UNKNOWN
- **Authority owner:** Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. The owning authority cannot currently report the stage's state.
2. `UnknownState` — MD-306 — with reconciliation.
3. No state assumed; completed stages keep their proof.
4. Recheck only.
5. Recheck re-reports or announces continued unreachability.
6. Previously recorded stage proof remains visible.
7. Recheck outcomes announced politely with explicit UNKNOWN wording.
8. MD-400 applies when the whole record cannot be fetched.
9. NOT pending, NOT failed, never guessed.

---

## Fetch availability

### MD-400 — authority fetch unavailable (availability unknown)
- **Authority owner:** Agents/Mediation Authority + Disputes/Recourse Authority — **Runtime:** ARRIVING (mock, presentation-only)
1. A query to the owning authority could not be completed; whether the information is available is UNKNOWN.
2. `AvailabilityUnknownState` — MD-400 — target names the authority/scope, with a detail line.
3. Nothing is assumed and no action is taken on the party's behalf; the surface refuses to render a guessed record.
4. Recheck (where a surface is present) is the only action.
5. A successful recheck renders the real record; failure keeps this presentation.
6. N/A — no record was fetched; the target and detail state exactly that.
7. Recheck failures are announced politely with explicit UNKNOWN wording.
8. MD-007/MD-105/MD-205/MD-306 are fetched records whose STATE is UNKNOWN; MD-400 is about the FETCH itself.
9. NOT an empty list, NOT a 404 (the record may exist), and NOT a silent fallback to cached data.

---

## Explicit non-states

The following are deliberately NOT states in this mapping and must never be presented as one:

- **"Pending…" as a generic spinner-only state** — every wait is a named WaitingState or InProgressState with its completion condition, or UNKNOWN; spinners only ever accompany an in-flight recheck/action.
- **"Success" as a payment/settlement event** — the surfaces never claim settlement outcomes; only authority wording is shown (financial authority is forbidden to this surface).
- **"Decided by the system"** — every decision names its deciding party, its authorization reference, and its proof; nothing is silently applied.
- **"Error" as a state** — transport failures are AvailabilityUnknownState (MD-400) or explicit denial results; they are never a mediation/dispute state.
- **"Mediation won/lost"** — outcome framing belongs to the authority's wording alone; presentation never editorializes.
- **"Dispute closed" without the recourse trail** — resolution always presents with its recourse window/stages; there is no bare "closed" presentation.
- **Guessed or cached authority state** — when the authority cannot report, the state is UNKNOWN (MD-007/MD-105/MD-205/MD-306/MD-400), never a default.
- **Invisible authorization denials** — a denied action is disabled WITH its reason and, when submitted anyway, the denial is displayed and announced; denials are results, not errors to swallow.
