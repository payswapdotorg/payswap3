# Capability mapping records (UI-004)

Complete nine-question mapping records for every consequential capability
state rendered by the provider capability surface, following the record format
of `spec/product/intent-mapping-records.md` (UX contract Section 8).

- Surface: `/capabilities` and `/capabilities/{capabilityId}` (read-only
  provider capability surface, UI-004).
- Mapping module: `src/lib/protocol/capability-state-mapping.ts` (one-to-one,
  P4).
- Port: `src/lib/protocol/capability-port.ts`; backing:
  `src/lib/protocol/mock-capability-authority.ts` (NON-AUTHORITATIVE,
  presentation-only, runtime ARRIVING).
- Authority owner of every state below: the Capability/Routing Authority per
  `spec/architecture/v0.1`.

Two axes are mapped separately and never collapsed into one:

1. **Capability state axis** (what the authority reports about a capability):
   `available`, `unavailable`, `conditional`, `pending`, `indeterminate`.
2. **Source availability axis** (whether an authoritative source can report at
   all): `reachable`, `degraded`, `unreachable`.

Precedence: an unreachable source yields availability unknown; it never yields
an outcome. A degraded source yields indeterminate reports at the authority,
which resolve to UNKNOWN.

## The nine questions

Every record answers, in order:

1. **State** — Which authority state does this record govern?
2. **Display primitive** — Which shared state primitive renders it, and why is
   the mapping one-to-one?
3. **Headline** — What exact headline does the user see first (P3)?
4. **Reporter** — Who reports the state (provenance)?
5. **Explanation** — What explanatory body is shown?
6. **Evidence & links** — What evidence, conditions, or anchors accompany it?
7. **Next steps** — What forward steps are surfaced (read-only presentation)?
8. **Resolution** — What completes or reconciles the state?
9. **Misrender guard** — What must this state NEVER render as?

---

## CAP-MAP-001 — authority state `available`

1. **State:** `available` — the authority definitively reports the capability
   is usable.
2. **Display primitive:** `SucceededState`. One-to-one: `available` is the
   only authority state that resolves to `succeeded`, and `succeeded` renders
   only for `available`.
3. **Headline:** badge “Available” with the note “Reported by
   {reportingSource}”; full presentation headline “{capabilityName} is
   available”.
4. **Reporter:** the reporting authority source (e.g. the Capability
   Registry), with the authority owner (Capability/Routing Authority,
   spec/architecture/v0.1) shown in provenance.
5. **Explanation:** the capability summary stated by the registry; no
   evaluation is added UI-side.
6. **Evidence & links:** the authority evidence anchor (label + href) from the
   report, or the source record anchor; provenance names the reporting source
   and timestamp.
7. **Next steps:** none surfaced by this state; composition and detail are one
   deliberate step away (disclosure/navigation only).
8. **Resolution:** none required; the state stands until the authority
   publishes a different record.
9. **Misrender guard:** never UNKNOWN, never failed. If truth cannot be
   authoritatively determined, the authority reports a different state and a
   different record applies.

## CAP-MAP-002 — authority state `unavailable`

1. **State:** `unavailable` — the authority definitively reports the
   capability is not usable.
2. **Display primitive:** `FailedState`. One-to-one: `unavailable` is the only
   authority state that resolves to `failed`, and `failed` renders only for
   `unavailable`. This is the ONLY definitive negative on the surface.
3. **Headline:** badge “Unavailable” with the note “Reported by
   {reportingSource}”; full presentation headline “{capabilityName} is
   unavailable”.
4. **Reporter:** the reporting authority source, with reason and next actions
   as stated by the authority.
5. **Explanation:** the authority-stated reason (e.g. “No authorized FX
   counterparty covers the corridors currently quoted by the Routing
   Table.”).
6. **Evidence & links:** authority-stated next actions; provenance names the
   reporting source, authority owner, and timestamp.
7. **Next steps:** the authority-stated next actions (monitor routing truth,
   request re-evaluation through governance). Read-only presentation: the
   surface offers no controls to act.
8. **Resolution:** the authority publishes an `available` (or other) record;
   until then the definitive negative stands as authority truth.
9. **Misrender guard:** never UNKNOWN, never succeeded. Indeterminate truth
   must never borrow this render (see CAP-MAP-005); an unreachable source must
   never borrow it either (see CAP-MAP-006).

## CAP-MAP-003 — authority state `conditional`

1. **State:** `conditional` — the authority reports the capability is usable
   only when stated conditions hold.
2. **Display primitive:** `ActionRequiredState`. One-to-one: `conditional` is
   the only authority state that resolves to `action-required`, and
   `action-required` renders only for `conditional`.
3. **Headline:** badge “Conditional” with the note “Reported by
   {reportingSource}; conditions one step away”; full presentation headline
   “{capabilityName} is available only when the authority-stated conditions
   hold”.
4. **Reporter:** the reporting authority source, with conditions and validity
   as stated by the authority.
5. **Explanation:** the authority-stated consequence of inaction (e.g. “The
   capability stays dormant; payouts continue on the batch rail.”) and the
   condition validity window.
6. **Evidence & links:** the authority-stated conditions, rendered as stated
   requirements with authority-quoted monetary thresholds formatted with
   explicit currency (src/lib/pay-flow/money.ts). Conditions are never
   rendered as evaluated met/unmet outcomes; evaluation is authority-owned.
7. **Next steps:** satisfying the stated conditions happens on the acting
   surfaces (merchant/customer), not here; this surface only presents them.
8. **Resolution:** conditions are re-evaluated when the authority states (e.g.
   “whenever the Routing Table publishes a new epoch”).
9. **Misrender guard:** never UNKNOWN, never plain success. A conditional
   capability is not an evaluation result; it is a stated constraint.

## CAP-MAP-004 — authority state `pending`

1. **State:** `pending` — an authority process is in progress for the
   capability.
2. **Display primitive:** `InProgressState`. One-to-one: `pending` is the only
   authority state that resolves to `in-progress`, and `in-progress` renders
   only for `pending`.
3. **Headline:** badge “In progress” with the note “Reported by
   {reportingSource}; completion one step away”; full presentation states what
   is happening and what completes it.
4. **Reporter:** the reporting authority source running the process.
5. **Explanation:** the authority-stated `whatIsHappening` (e.g. “The
   Capability/Routing Authority is re-evaluating the refund rails following
   the v0.1 amendment.”).
6. **Evidence & links:** provenance (reporting source, authority owner,
   timestamp, mapping record); no outcome is implied.
7. **Next steps:** none surfaced; the surface presents the process, it does
   not participate in it.
8. **Resolution:** the authority-stated `whatCompletesIt` (e.g. “The authority
   publishes the re-evaluated refund capability record.”).
9. **Misrender guard:** never UNKNOWN, never failed. A pending authority
   process is not an unknown and not a negative outcome.

## CAP-MAP-005 — authority state `indeterminate`

1. **State:** `indeterminate` — the authority reports it cannot determine the
   capability yet (including reports degraded from partial data).
2. **Display primitive:** `UnknownState`. One-to-one: `indeterminate` is the
   only authority state that resolves to `unknown`, and `unknown` renders only
   for `indeterminate`.
3. **Headline:** badge “Unknown” with the note “Reported by
   {reportingSource}; reconciliation one step away”; full presentation
   headline “{capabilityName}: state unknown”.
4. **Reporter:** the reporting authority source that cannot yet determine the
   truth.
5. **Explanation:** the authority-stated reason (e.g. “Routing participation
   depends on the directory reconciliation currently in progress at the
   Routing Table; the authority cannot determine participation yet.”).
6. **Evidence & links:** the reconciliation block (who resolves, when to
   re-check); provenance names the reporting source and authority owner.
7. **Next steps:** the reconciliation path — who resolves it and the re-check
   trigger. No actions are offered on this surface.
8. **Resolution:** `reconciliation.whoResolves` (e.g. “Capability/Routing
   Authority — Routing Table”) on `reconciliation.recheckTrigger` (e.g.
   “Re-check when the Routing Table publishes its next epoch.”).
9. **Misrender guard:** NEVER success, NEVER failure. Indeterminate truth
   renders as UNKNOWN with its reconciliation path — never as a definitive
   value (P4, P5). This is the core distinction from CAP-MAP-002.

## CAP-MAP-006 — source availability `unreachable`

1. **State:** no authoritative report exists because the reporting source is
   unavailable (source availability axis: `unreachable`).
2. **Display primitive:** `AvailabilityUnknownState`. One-to-one: an
   unavailable source is the only condition that resolves to
   `availability-unknown`, and `availability-unknown` renders only when the
   reporting source is unavailable. Precedence: the availability axis is
   resolved before the capability state axis.
3. **Headline:** badge “Availability unknown” with the note “{sourceName} is
   unavailable; no authoritative state can be presented”; full presentation
   targets the unavailable source (e.g. “Corridor Directory”).
4. **Reporter:** none can be — there is no report. The presentation names the
   unavailable source and its authority owner instead of a reporter.
5. **Explanation:** the source is not returning authoritative records, so the
   capability state cannot be authoritatively determined here. If the
   unavailable source is the Capability Registry itself, the set of
   capabilities cannot be enumerated either; the surface renders
   availability-unknown for the listing and explicitly does not claim that no
   capabilities exist.
6. **Evidence & links:** none available while the source is unavailable; the
   evidence row reads “not available while the source is unavailable”.
7. **Next steps:** source availability re-check; no other forward path is
   claimed.
8. **Resolution:** the source becomes reachable again and reports; until then
   nothing is presented as definitive.
9. **Misrender guard:** never an outcome of any kind — distinct from outcome
   failure (CAP-MAP-002) and from indeterminate UNKNOWN (CAP-MAP-005).
   Rendering an unavailable source as failure or success would fabricate
   truth.

---

## Vocabulary coverage note

No capability authority state maps to `WaitingState` in this iteration: the
capability vocabulary (available, unavailable, conditional, pending,
indeterminate) carries no waiting-on-external-party semantics. `WaitingState`
remains available to the shared primitive set for surfaces whose authority
vocabulary includes it (e.g. the intent surface).
