# Tracking mapping records (UI-005)

Every tracked consequential state on the track/status surface carries a complete
nine-question mapping record, in the format of `spec/product/intent-mapping-records.md`
(UI-002). Record ids resolve from `TRACKING_MAPPING_RECORD_IDS` (and the constants below)
in `src/lib/protocol/tracking-state-mapping.ts`, and each render of a tracked state on
`/track/[referenceId]` surfaces its record id.

> Sandbox note (UI-005 worker): the canonical `intent-mapping-records.md` was not present
> in this sandbox. The nine-question structure below was reconstructed conservatively to
> satisfy UX contract Section 8 ("complete nine-question record"); the Tech Lead should
> confirm the exact question wording at merge.

Records:

| Record id                  | Tracked state / outcome                          |
| -------------------------- | ------------------------------------------------ |
| `TRK-SUCCEEDED`            | SUCCEEDED (payment/settlement completed)         |
| `TRK-FAILED`               | FAILED (outcome did not complete)                |
| `TRK-IN-PROGRESS`          | IN_PROGRESS (something is happening now)         |
| `TRK-WAITING`              | WAITING (with reason, expectation, actions/none) |
| `TRK-UNKNOWN`              | UNKNOWN (authority has not answered)             |
| `TRK-ACTION-REQUIRED`      | ACTION_REQUIRED (someone must act)               |
| `TRK-EVIDENCE-UNAVAILABLE` | Evidence record the authority has not answered   |
| `TRK-LOOKUP-NOT-FOUND`     | Lookup miss (not a consequential state; documented for completeness) |
| `TRK-LOOKUP-NOT-AUTHORIZED`| Viewer role not authorized (not a consequential state; documented for completeness) |

Mock session examples referenced below: `PWS-9QM2` (succeeded), `PWS-2H8D` (failed),
`PWS-4TNN` (in progress), `PWS-7F3K` / `STL-4419` (waiting), `PWS-6KLP` (unknown),
`PWS-8XRQ` (action required), `PWS-5VBM` (succeeded with a no-answer evidence record).

---

## TRK-SUCCEEDED — succeeded

**State kind:** `succeeded` · **Display primitive:** `SucceededState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   The consequential outcome completed. Rendered by `SucceededState` with `outcome`,
   `reportedBy`, and a required `evidence: { label, href }` link into the proof trail.
   The state badge reads `SUCCEEDED`.
2. **What outcome does it assert, and who reports it?**
   The authority's verbatim outcome wording, e.g. “Payment of 18.40 EUR to Meridian Coffee
   succeeded — the funds are settled to the merchant.” `reportedBy` names the answering
   authority (Intent Authority for payment intents; Evidence Authority for settlements).
   The surface never rewrites or softens the wording.
3. **Which protocol object does it attach to, and which authority owns it?**
   The state carries its protocol object (`payment-intent` / `settlement` + object id) and
   owning authority in the meta line under the state card. Mock example: `INT-9QM2-1187`,
   owned by the Intent Authority.
4. **What exactly does the viewer see rendered?**
   The `SucceededState` card, the `SUCCEEDED` badge, the protocol-object/owning-authority
   meta line, the mapping-record id, the plain-language history (most recent first), and
   the complete proof trail with every record's authority, time, and outcome wording.
5. **What can the viewer do in this state?**
   Follow the evidence link (deep-links to the record in the proof trail on the same
   view), read the trail and history, and look up another reference. No financial action
   is offered from this state.
6. **What happens next — what completes, fails, or resolves the state?**
   Nothing further: succeeded is terminal for the tracked outcome. Refunds or disputes are
   new consequential outcomes with their own references, tracked separately.
7. **How does it render when the authority cannot answer, and who reconciles?**
   If the Intent Authority cannot answer for the state, the current state renders
   `TRK-UNKNOWN` (visibly unknown, with reconciliation) — never a stale succeeded. If an
   evidence record behind the outcome cannot be answered, that record alone renders
   `TRK-EVIDENCE-UNAVAILABLE`; the succeeded state itself is unchanged.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: payment intents — customer, merchant, operator, administrator;
   settlements — merchant, provider, operator, administrator. Unauthorized audiences
   receive the explicit NOT AUTHORIZED result, which reveals no state, history, or
   evidence. The real per-reference authorization is owned by the authorities behind the
   port.
9. **Where is the evidence, and how is the proof trail presented?**
   The proof trail section lists every record with authority, time, and verbatim outcome
   wording. Records the authority has not answered for render UNKNOWN for the record —
   never a synthesized substitute.

---

## TRK-FAILED — failed

**State kind:** `failed` · **Display primitive:** `FailedState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   The consequential outcome did not complete. Rendered by `FailedState` with `outcome`,
   `reportedBy`, optional `reason`, and optional `nextActions`. The state badge reads
   `FAILED`.
2. **What outcome does it assert, and who reports it?**
   The authority's verbatim wording, e.g. “Payment of 64.00 EUR to Atlas Bookbindery
   failed — no funds were taken from the customer.” with the reason when the authority
   gives one (“decline code 51 — insufficient funds”). Reported by the Intent Authority.
3. **Which protocol object does it attach to, and which authority owns it?**
   The failed intent (mock example `INT-2H8D-3320`), owned by the Intent Authority; shown
   in the meta line with the mapping-record id.
4. **What exactly does the viewer see rendered?**
   The `FailedState` card (outcome, reason, next actions, reported-by), the `FAILED`
   badge, the meta line, the plain-language history, and the proof trail (e.g. the
   provider decline record with its verbatim wording).
5. **What can the viewer do in this state?**
   The authority-provided `nextActions` only, e.g. “Try the payment again with a different
   payment method” / “Contact the merchant with reference PWS-2H8D.” The surface adds no
   actions of its own.
6. **What happens next — what completes, fails, or resolves the state?**
   Nothing further: failed is terminal for the tracked outcome. A retry is a new payment
   intent with its own reference.
7. **How does it render when the authority cannot answer, and who reconciles?**
   Same as TRK-SUCCEEDED question 7: an unanswerable state renders `TRK-UNKNOWN` with its
   reconciliation path; an unanswerable evidence record renders
   `TRK-EVIDENCE-UNAVAILABLE` for that record.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: customer, merchant, operator, administrator (intents).
   Unauthorized audiences get the explicit NOT AUTHORIZED result with nothing revealed.
9. **Where is the evidence, and how is the proof trail presented?**
   The proof trail lists the records behind the failure (authorization record, provider
   decline record) with authority, time, and verbatim outcome wording.

---

## TRK-IN-PROGRESS — in progress

**State kind:** `in-progress` · **Display primitive:** `InProgressState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   Something is happening right now on the tracked outcome. Rendered by `InProgressState`
   with `whatIsHappening`, `whatCompletesIt`, and `reportedBy`. The state badge reads
   `IN_PROGRESS`.
2. **What outcome does it assert, and who reports it?**
   Not an outcome — an active step, in the authority's words: “The customer's bank is
   verifying the authorization for this payment of 22.50 EUR.” Reported by the Intent
   Authority. The state explicitly names what completes it, so it is never read as a
   vague “pending”.
3. **Which protocol object does it attach to, and which authority owns it?**
   The intent in progress (mock example `INT-4TNN-1190`), owned by the Intent Authority.
4. **What exactly does the viewer see rendered?**
   The `InProgressState` card with both fields (what is happening / what completes it),
   the `IN_PROGRESS` badge, the meta line, the history, and the proof trail.
5. **What can the viewer do in this state?**
   Nothing is offered by the mock records; the viewer can re-look-up the reference to
   re-check the state (the port re-answers on every lookup). No “cancel”-style action is
   ever invented by the surface.
6. **What happens next — what completes, fails, or resolves the state?**
   The named completing event: the bank's verification answer. The outcome then moves to
   captured/succeeded or failed with the authority's reason — the vocabulary never allows
   an ambiguous in-between.
7. **How does it render when the authority cannot answer, and who reconciles?**
   `TRK-UNKNOWN` with reconciliation (who resolves: Intent Authority; re-check: fresh
   lookup or the authority's next answer). The last known in-progress state is never
   presented as current once the authority stops answering.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: customer, merchant, operator, administrator. Others: explicit
   NOT AUTHORIZED, nothing revealed.
9. **Where is the evidence, and how is the proof trail presented?**
   The proof trail lists the records behind the step (authorization record, provider
   verification record) with authority, time, and verbatim outcome wording.

---

## TRK-WAITING — waiting (with reason, expectation, actions-or-none)

**State kind:** `waiting` · **Display primitive:** `WaitingState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   The outcome is waiting on something. Rendered by `WaitingState` with `whatIsWaiting`,
   `why`, `whatHappensNext`, `reportedBy`, and `availableActions` (or their explicit
   absence). The state badge reads `WAITING`. This is the P4 replacement for any
   “pending”: waiting is always explained, never ambiguous.
2. **What outcome does it assert, and who reports it?**
   The authority's words, e.g. “Settlement of 12.00 EUR to Meridian Coffee — the payment
   is captured and waiting for the provider's settlement window.” Reported by the Intent
   Authority (intents) or the Evidence Authority (settlements).
3. **Which protocol object does it attach to, and which authority owns it?**
   Mock examples: intent `INT-7F3K-1188` (Intent Authority) and settlement `STL-4419`
   (Evidence Authority), shown in the meta line.
4. **What exactly does the viewer see rendered?**
   The `WaitingState` card with all three explanation fields (what is waiting / why /
   what happens next), reported-by, and the available-actions block. P6: when the
   authority provides no actions, the surface renders an explicit note — “No actions are
   available to you yet — this outcome is waiting on the authority that owns it, not on
   you.” — never a silent or ambiguous block.
5. **What can the viewer do in this state?**
   Exactly the authority-provided `availableActions`, or the explicit none-yet note.
   Mock examples: `PWS-7F3K` carries none (the wait is on the provider's settlement
   window); `STL-4419` carries two (contact operations; re-look-up after the announced
   window). The surface adds no actions of its own.
6. **What happens next — what completes, fails, or resolves the state?**
   The named expectation: “When the next settlement window completes, this payment moves
   to succeeded, or to failed with the provider's reason if settlement is rejected.”
7. **How does it render when the authority cannot answer, and who reconciles?**
   `TRK-UNKNOWN` with reconciliation. A waiting state the authority stops answering for is
   unknown, not silently-still-waiting. Evidence that has not been answered for (e.g. the
   settlement confirmation that does not exist yet) renders
   `TRK-EVIDENCE-UNAVAILABLE` for that record.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: intents — customer, merchant, operator, administrator;
   settlements — merchant, provider, operator, administrator. Others: explicit NOT
   AUTHORIZED, nothing revealed.
9. **Where is the evidence, and how is the proof trail presented?**
   The proof trail lists the records behind the wait (authorization record; for
   settlements the batch and transfer-request records). A settlement confirmation that
   does not exist yet renders UNKNOWN for that record with its re-check trigger.

---

## TRK-UNKNOWN — unknown (with reconciliation)

**State kind:** `unknown` · **Display primitive:** `UnknownState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   The authority has not answered for the current state. Rendered by `UnknownState` with
   `subject`, `explanation`, and (when the authority provides it) `reconciliation:
   { whoResolves, recheckTrigger }`. The state badge reads `UNKNOWN`.
2. **What outcome does it assert, and who reports it?**
   None — that is the point. The explanation is the authority's own wording, e.g. “The
   Intent Authority has not answered for this payment's current state. The last answered
   state was captured…; what happened after that is not yet known.” The state never
   guesses, extrapolates, or falls back to the last known state.
3. **Which protocol object does it attach to, and which authority owns it?**
   The unanswerable object (mock example `INT-6KLP-2761`, Intent Authority), shown in the
   meta line so the unknown is always mapped to its owner.
4. **What exactly does the viewer see rendered?**
   The `UnknownState` card — visibly unknown, with the explanation and the reconciliation
   path — the `UNKNOWN` badge, the meta line, the history up to the last answered event,
   and the proof trail (whose unanswered records render TRK-EVIDENCE-UNAVAILABLE).
5. **What can the viewer do in this state?**
   Follow the reconciliation path: re-look-up the reference (each lookup re-asks the
   authority) or contact the resolving party. The surface offers no other action and
   invents none.
6. **What happens next — what completes, fails, or resolves the state?**
   The reconciliation: “The state is re-checked when the Intent Authority answers for
   this intent, or on a fresh lookup of this reference.” When the answer arrives, the
   state resolves to one of the other five states.
7. **How does it render when the authority cannot answer, and who reconciles?**
   This record IS that case: unknown renders as unknown, with who resolves it (Intent
   Authority) and what triggers the re-check. N5/N6: the unknown is visible and
   first-class, never hidden behind a spinner, a stale state, or a synthesized guess.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: customer, merchant, operator, administrator. Others: explicit
   NOT AUTHORIZED, nothing revealed — the same rule as every other state.
9. **Where is the evidence, and how is the proof trail presented?**
   The answered records are presented with authority, time, and verbatim wording; the
   unanswered ones (e.g. the settlement confirmation for `PWS-6KLP`) render UNKNOWN for
   the record. Nothing is presented as known that the authority did not answer for.

---

## TRK-ACTION-REQUIRED — action required

**State kind:** `action-required` · **Display primitive:** `ActionRequiredState` · **Resolved by:** `resolveDisplayState` (one-to-one)

1. **What state is this, and which shared display primitive renders it?**
   Someone must act for the outcome to proceed. Rendered by `ActionRequiredState` with
   `action`, `reportedBy`, optional `validity`, and optional `consequenceOfInaction`. The
   state badge reads `ACTION_REQUIRED`.
2. **What outcome does it assert, and who reports it?**
   The required action in the authority's words: “Confirm the payment of 27.00 EUR to
   Meridian Coffee to proceed.” Reported by the Intent Authority.
3. **Which protocol object does it attach to, and which authority owns it?**
   The intent awaiting action (mock example `INT-8XRQ-1191`), owned by the Intent
   Authority, shown in the meta line.
4. **What exactly does the viewer see rendered?**
   The `ActionRequiredState` card (action, validity, consequence of inaction,
   reported-by), the `ACTION_REQUIRED` badge, the meta line, the history, and the proof
   trail.
5. **What can the viewer do in this state?**
   The named action (in the product: on the surface that owns the action, e.g. the
   customer's payment surface), within the stated validity. The tracking surface presents
   the state and the trail; it does not itself perform the action.
6. **What happens next — what completes, fails, or resolves the state?**
   The action completes (the outcome proceeds toward captured/succeeded) or the validity
   lapses: “If the payment is not confirmed in time, the intent expires and no payment
   takes place; nothing is taken from the customer's account.”
7. **How does it render when the authority cannot answer, and who reconciles?**
   `TRK-UNKNOWN` with reconciliation. An action-required state the authority stops
   answering for is unknown, not silently-still-required; the surface never keeps a
   countdown of its own.
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   Mock session records: customer, merchant, operator, administrator. Others: explicit
   NOT AUTHORIZED, nothing revealed.
9. **Where is the evidence, and how is the proof trail presented?**
   The proof trail lists the records behind the request (e.g. the intent creation record)
   with authority, time, and verbatim outcome wording.

---

## TRK-EVIDENCE-UNAVAILABLE — evidence record not answered

**Applies to:** a single evidence record in a proof trail · **Display primitive:** `UnknownState` (for the record) · **Resolved by:** `resolveEvidenceRecordDisplay`

1. **What state is this, and which shared display primitive renders it?**
   One record behind an outcome that the authority has not answered for. It renders the
   shared `UnknownState` primitive scoped to the record: subject “the [record label] for
   this outcome”, the authority's explanation, and its reconciliation
   `{ whoResolves, recheckTrigger }`. A `RECORD: UNKNOWN` badge precedes it.
2. **What outcome does it assert, and who reports it?**
   None. The record's contents are not asserted, quoted, or reconstructed — P5/P7/N1:
   an unavailable record renders UNKNOWN for the record, never a synthesized substitute.
   The owning authority's no-answer explanation is presented verbatim (mock example,
   PWS-5VBM's settlement confirmation: “The Evidence Authority has not answered for this
   record…”).
3. **Which protocol object does it attach to, and which authority owns it?**
   The record belongs to the outcome's proof trail (protocol object shown in the view
   header); the record's owning authority is named under the render (mock: Evidence
   Authority), together with the record id and the mapping-record id.
4. **What exactly does the viewer see rendered?**
   The `RECORD: UNKNOWN` badge, the `UnknownState` render for the record, and the meta
   line (owning authority · record id · mapping record `TRK-EVIDENCE-UNAVAILABLE`). The
   record keeps its place in the trail — its absence is never hidden and never filled in.
5. **What can the viewer do in this state?**
   Follow the reconciliation path: re-look-up the reference (each lookup re-asks) or
   contact the resolving authority. Nothing else is offered.
6. **What happens next — what completes, fails, or resolves the state?**
   The reconciliation: “The record is re-checked when the Evidence Authority answers, or
   on a fresh lookup of this reference.” When the answer arrives, the record renders as
   recorded — with authority, time, and verbatim outcome wording.
7. **How does it render when the authority cannot answer, and who reconciles?**
   This record IS that case. The mock can never synthesize an answer: records that never
   answered carry no recorded payload at all and cannot be scripted into a recorded one
   (enforced in `mock-tracking-authority.ts`).
8. **Which audiences are authorized to view it, and what do unauthorized audiences see?**
   The trail (and therefore this render) is only ever shown to audiences authorized for
   the reference. Others see the explicit NOT AUTHORIZED result.
9. **Where is the evidence, and how is the proof trail presented?**
   The trail is the evidence: records answered are presented verbatim; records not
   answered render unknown. The SUCCEEDED evidence link on the outcome points into the
   trail, so an unavailable record is reachable and inspectable as itself.

---

## TRK-LOOKUP-NOT-FOUND — lookup miss (surface outcome, documented for completeness)

**Applies to:** `/track/[referenceId]` when no tracked reference matches · **Not a consequential state** — rendered by the surface's own not-found card, not a state primitive.

1. What is this? An explicit, unambiguous lookup miss for the entered reference (mock: `PWS-0000`).
2. What does it assert? That nothing tracked matches — nothing else. It never implies anything about any payment.
3. Which object? None — no protocol object is referenced or revealed.
4. What is rendered? A card with the searched reference, the authority's wording (“No tracked reference matches…”), and two next actions (re-check the reference; confirm it with the party that issued it).
5. What can the viewer do? Re-enter the reference; confirm it with the issuer.
6. What happens next? Nothing is started; the viewer may look up again.
7. Unanswerable case? Not applicable: the lookup itself answered (“no match”); if the port cannot answer at all, the adapter-boundary notice (runtime ARRIVING) and the AvailabilityUnknownState render in “About this view” make the backing's availability visible.
8. Audiences? All audiences may reach the entry surface and receive this result equally — it reveals nothing.
9. Evidence? None is shown; none exists for a miss.

## TRK-LOOKUP-NOT-AUTHORIZED — viewer role not authorized (surface outcome, documented for completeness)

**Applies to:** `/track/[referenceId]` when the resolved viewer audience is not authorized for the reference · **Not a consequential state** — rendered by the surface's own not-authorized card, not a state primitive.

1. What is this? The role check on direct entry, answered: the reference is tracked, but the current viewer role may not see it.
2. What does it assert? Only that authorization failed for this viewer — no state, history, or evidence of the reference is revealed.
3. Which object? The reference id is echoed; its protocol object, state, and trail are not shown.
4. What is rendered? A card with the reference, the viewer's resolved audience, the authority's wording (“…the current viewer role is not authorized to see it…”), who may view it (in the authority's words), and two next actions (switch to an authorized role; contact support with the reference).
5. What can the viewer do? Sign in with / switch to an authorized role; contact PaySwap support.
6. What happens next? A new lookup with an authorized audience renders the full status view; the deep link itself is stable and reproducible.
7. Unanswerable case? Not applicable here; the authorization itself is the port's answer. (Audience resolution always answers — least-visibility fallback `unauthenticated`.)
8. Audiences? Every audience can land here — including unauthenticated (not authorized for any reference in the mock session records: no anonymous tracking). Per-reference authorization is owned by the authorities behind the port; the mock's per-record audience lists are a presentation choice.
9. Evidence? None is shown; authorization precedes any evidence.

---

## UI-011 re-anchoring — runtime truth and the question-9 discharge

- **Owning authority:** the Intent Authority (A01) owns the tracked consequential states (DRAFT ... terminal FULFILLED/FAILED/CANCELLED) and the plain-language history's source records; the Evidence Authority (A15) owns the proof trail itself (the real record chain).
- **Evidence identity:** every history entry and every evidence-trail view is a REAL A15 record — record id, sequence number, hash, owning authority, outcome + reason code — read from the composed runtime's log; the adapter never synthesizes a record (a no-answer evidence view presents the record-level UNKNOWN honestly, P5/N1).
- **Tracked-state derivation (P4, frozen vocabulary):** DRAFT -> waiting; AUTHORIZED/ROUTED/FULFILLING -> in-progress; FULFILLED -> succeeded; FAILED/CANCELLED -> failed (with the A15-recorded reason codes). 'pending' is not expressible in the port's closed vocabulary.
- **Reference resolution:** lookups resolve the runtime's own protocol object ids (the A01 intent ids the A15 chain names). References the runtime does not know render not-found with UNKNOWN-honest wording — the runtime's real answer, never a fabricated view.
- **UNKNOWN semantics:** not-found wording states it is the runtime's answer for the reference (and, in browser context, that the adapter was not reachable — the recorded no-transport-binding deferral); the evidence-read availability scripting demonstrates the record-level no-answer presentation.
- **Reconciliation path:** re-check re-queries the authority; terminal states are terminal (the frozen one-way table); settlement-side UNKNOWN resolves only through the A14 reconciliation cycle (GC-2) — presented as such, never invented.
- **User-visible wording source:** history wording restates the A15 records' own outcomes and reason codes; the state wordings restate the A01 report.
- **Viewer roles:** the runtime's read surface places no per-viewer restriction on protocol object reads; the product shell's audience model governs surface access.
- **Question 9 (user-visible state) — RTN-012's deferral DISCHARGED (see INTEGRATION-EVIDENCE.md and intent-mapping-records.md):** the track surfaces render the composed runtime's real A01/A15 data server-side; the per-port adapter suite (runtime-tracking-adapter.test.ts) proves the tracked-state matrix, the A15-backed history/proof trail, and the no-answer record view over the real runtime. End-to-end evidence rolls up under UI-010.
- **Recorded deferrals:** browser-context lookups present not-found with UNKNOWN-honest wording (no transport binding — recorded future work); the legacy sandbox reference ids (PWS-*, STL-*) resolve not-found against a fresh runtime (the honest answer through the frozen vocabulary).
- **Adapter identity:** the runtime adapter (runtime-tracking-adapter.ts) behind getTrackingPort(); the mock is retired (the shim returns the CURRENT port backing and the reference catalog is honestly labeled).

