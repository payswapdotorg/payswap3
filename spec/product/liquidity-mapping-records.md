# UI-007 — Liquidity, credit, and queue visibility mapping records

- Work order: UI-007 (liquidity, credit, and queued-position visibility surfaces)
- Authority owners: the Liquidity Authority (liquidity positions, queued positions) and the Credit Authority (credit positions), per spec/architecture/v0.1 liquidity-credit-queues.md
- Runtime status: LIVE (re-anchored by UI-011) — every value on these surfaces is backed by the RUNTIME ADAPTER FACTORY over the composed A06 Liquidity / A07 Credit / A08 Queue authorities (src/lib/protocol/runtime-liquidity-adapter.ts behind getLiquidityPort(overrides)); the mock backing is retired (the shim retains only the frozen sandbox-override reader + the permission mirror)
- Surfaces covered: /liquidity (provider), /oversight (operator), and the UI-007 verification harness (src/app/verification/liquidity-flow)
- Companion code: src/lib/protocol/liquidity-state-mapping.ts (one-to-one authority state to display presentation; the record ids below are the ids emitted by that module)

## How to read a record

Every consequential visibility state on these surfaces carries one nine-question record below, in the intent-mapping-records.md format: a header naming the authority owner and the runtime status, the nine-question record set, and the record's explicit non-states. Indeterminate values are always rendered as UNKNOWN with their reconciliation path — never as zero, empty, failed, or a definitive value.

---

## LQ-001 — Liquidity position, fully quoted

Authority state: liquidity.position.quoted
Owning authority: the Liquidity Authority (runtime ARRIVING; currently presented through the NON-AUTHORITATIVE mock)

1. What is the state? A provider liquidity position (balance, reserved, available) for which the Liquidity Authority has returned determinate quotes for every value.
2. Who owns the truth? The Liquidity Authority, per spec/architecture/v0.1 liquidity-credit-queues.md. Runtime ARRIVING — the presentation-only mock backs the quotes today and is non-authoritative.
3. What does the user see? A read-only headline value group (balance, reserved, available) where each value carries provenance wording: "Reported by the Liquidity Authority · quote <quoteId> · as of <UTC label>". The dense composition table shows the same values with per-cell provenance and an evidence trail link.
4. What must the user never see? An editable or copyable-as-authoritative value; a derived available amount; a total; any value this surface computed, estimated, or interpolated; another provider's position.
5. How is indeterminacy presented? This record covers the fully-quoted state, so no value renders UNKNOWN here. If any sibling value becomes indeterminate the position moves to LQ-002 or LQ-003.
6. Reconciliation path? Not applicable for a quoted value; the evidence trail (P7) is reachable from the headline card and every table row, linking to the authority-provided evidence reference (the track surface in the sandbox mock).
7. Which actions are available, and who owns them? Read and reveal composition (provider); re-open the surface to re-query the authority. The authority owns every value; the surface owns no mutating action.
8. What changes this state? Only the Liquidity Authority, by publishing a new quote (including one that makes a value indeterminate — which transitions this position to LQ-002/LQ-003). The surface re-queries on every load and caches nothing as truth.
9. What is this state explicitly NOT? Not a promise of realtime accuracy (it is a quote "as of" a stated time); not a computed balance (available is quoted in its own right, never derived from balance minus reserved); not editable, refreshable, or disputable from this surface; not a state any other role may see (see LQ-011).

## LQ-002 — Liquidity position, partially indeterminate

Authority state: liquidity.position.partially-unknown
Owning authority: the Liquidity Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A provider liquidity position where at least one, but not all, of balance / reserved / available is authority-UNKNOWN.
2. Who owns the truth? The Liquidity Authority — including the truth that a value is indeterminate. The indeterminacy is authoritative; it is never a fetch failure, timeout, or UI guess.
3. What does the user see? The indeterminate value renders UNKNOWN with its subject, the authority's explanation, and its reconciliation path ("Resolves: … — recheck: …"), anchored by the UnknownState presentation. The quoted values beside it keep their full provenance wording. In the dense table, the UNKNOWN cell renders the same UnknownState-anchored wording.
4. What must the user never see? Zero, an empty cell, a dash, a spinner that never resolves, "failed", or any substituted/estimated value in place of the indeterminate one; and never a quietly-downgraded provenance line on the quoted siblings.
5. How is indeterminacy presented? As UNKNOWN with reconciliation — explicitly, per value. The position is labeled with its record (LQ-002) so a reviewer can see the group is partially indeterminate.
6. Reconciliation path? Named by the authority in the value: whoResolves (the Liquidity Authority) and recheckTrigger (re-open the surface; the authority is re-queried on every load and nothing is cached as truth).
7. Which actions are available, and who owns them? The provider may re-open the surface (re-query) and reach the evidence trail for the quoted values. Resolution itself belongs to the Liquidity Authority, not to this surface.
8. What changes this state? The Liquidity Authority publishing a determinate quote for the indeterminate value (→ LQ-001) or making further values indeterminate (→ LQ-003). The surface changes nothing.
9. What is this state explicitly NOT? Not a partial render of a hidden value; not "0.00 pending update"; not an error state of the surface; not a reason to hide the quoted sibling values or their provenance.

## LQ-003 — Liquidity position, wholly indeterminate

Authority state: liquidity.position.wholly-unknown
Owning authority: the Liquidity Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A provider liquidity position where all three values (balance, reserved, available) are authority-UNKNOWN.
2. Who owns the truth? The Liquidity Authority, including the statement that the whole position is indeterminate in this snapshot.
3. What does the user see? The whole value group renders UNKNOWN — each value with its subject, the authority's explanation, and its reconciliation path (UnknownState presentation). No placeholder numbers appear anywhere in the group; the position id, as-of stamp, and evidence trail remain visible.
4. What must the user never see? Any invented or carried-forward number; a blank card; a "—" summary; the last-known value presented as current; a computed available.
5. How is indeterminacy presented? As UNKNOWN with reconciliation for every value in the group; the position is labeled LQ-003.
6. Reconciliation path? whoResolves: the Liquidity Authority; recheckTrigger: re-open the surface (fresh query, nothing cached as truth).
7. Which actions are available, and who owns them? Re-open the surface to re-query; reach the evidence trail. Resolution belongs to the authority.
8. What changes this state? Only the authority publishing determinate quotes (→ LQ-002 or LQ-001).
9. What is this state explicitly NOT? Not an outage of the surface; not a failed position; not zero liquidity; not a reason to omit the group from the page (visibility of indeterminacy is the requirement).

## LQ-004 — Credit position, fully quoted

Authority state: credit.position.quoted
Owning authority: the Credit Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A provider credit line (limit, utilized, remaining) for which the Credit Authority has returned determinate quotes for every value.
2. Who owns the truth? The Credit Authority, per spec/architecture/v0.1 liquidity-credit-queues.md. Runtime ARRIVING — the mock is non-authoritative.
3. What does the user see? A read-only headline value group (limit, utilized, remaining), each value carrying "Reported by the Credit Authority · quote <quoteId> · as of <UTC label>", plus the composition table row with the same provenance and the evidence trail.
4. What must the user never see? A derived remaining (never limit minus utilized on this surface); an editable value; a utilization ratio or any other computed derivative; another provider's credit line.
5. How is indeterminacy presented? Not applicable in this record; sibling records LQ-005/LQ-006 cover indeterminate credit values.
6. Reconciliation path? Not applicable for quoted values; the evidence trail is reachable (P7).
7. Which actions are available, and who owns them? Read and reveal composition (provider); re-open the surface to re-query. All values belong to the Credit Authority.
8. What changes this state? Only the Credit Authority publishing new quotes (or an indeterminate one — → LQ-005/LQ-006).
9. What is this state explicitly NOT? Not a credit decision or an offer; not realtime-accurate (it is a quote as of a stated time); not computed or reconciled UI-side in any way.

## LQ-005 — Credit position, partially indeterminate

Authority state: credit.position.partially-unknown
Owning authority: the Credit Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A provider credit line where at least one, but not all, of limit / utilized / remaining is authority-UNKNOWN.
2. Who owns the truth? The Credit Authority, including the indeterminacy itself.
3. What does the user see? Each indeterminate value renders UNKNOWN with subject, explanation, and reconciliation path (UnknownState presentation); quoted siblings keep full provenance. The position is labeled LQ-005.
4. What must the user never see? A derived remaining filling the gap; zero; empty cells; an estimated utilization; any "best effort" value.
5. How is indeterminacy presented? As UNKNOWN with reconciliation, per value.
6. Reconciliation path? whoResolves: the Credit Authority; recheckTrigger: re-open the surface (fresh query, nothing cached as truth).
7. Which actions are available, and who owns them? Re-open the surface; reach the evidence trail for quoted values. Resolution belongs to the Credit Authority.
8. What changes this state? The Credit Authority publishing determinate quotes (→ LQ-004) or further indeterminacy (→ LQ-006).
9. What is this state explicitly NOT? Not a credit freeze, a declined line, or a zero remaining; not an error of the surface; not a reason to hide quoted siblings.

## LQ-006 — Credit position, wholly indeterminate

Authority state: credit.position.wholly-unknown
Owning authority: the Credit Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A provider credit line where all three values (limit, utilized, remaining) are authority-UNKNOWN.
2. Who owns the truth? The Credit Authority, including the statement that the whole line is indeterminate in this snapshot.
3. What does the user see? The whole value group renders UNKNOWN with reconciliation per value (UnknownState presentation); no placeholder numbers; the line's id, as-of stamp, and evidence trail remain visible.
4. What must the user never see? Invented, carried-forward, or zero values; a blank card; a silent omission of the group.
5. How is indeterminacy presented? As UNKNOWN with reconciliation for every value; labeled LQ-006.
6. Reconciliation path? whoResolves: the Credit Authority; recheckTrigger: re-open the surface.
7. Which actions are available, and who owns them? Re-open the surface; reach the evidence trail. Resolution belongs to the authority.
8. What changes this state? Only the Credit Authority publishing determinate quotes (→ LQ-005 or LQ-004).
9. What is this state explicitly NOT? Not "no credit"; not a failed surface; not zero remaining.

## LQ-007 — Queue snapshot and entries, quoted

Authority state: queue.quoted
Owning authority: the Liquidity Authority (runtime ARRIVING; mock-backed today)

1. What is the state? A queue snapshot with an authority-quoted depth, and the provider's own queued entries with authority-quoted positions, reasons, and waiting semantics.
2. Who owns the truth? The Liquidity Authority — queue composition, entry positions, and depth are all authority-quoted; nothing is counted or summed UI-side.
3. What does the user see? A per-queue card: depth as a quoted count with provenance; queue composition one deliberate step away behind an explicit disclosure; each entry shows its quoted position ("#3 in queue · quote <quoteId>"), its reason, its entered-at stamp, and the UI-006 waiting semantics (what is waiting / why / what happens next / reported by) via the waiting presentation, with a link to the waiting track surface for the entry's reference where one exists.
4. What must the user never see? A UI-counted position (positions never come from list indices); another provider's entries; an estimated clearance time invented by the surface; an auto-expanded composition (the step away is deliberate).
5. How is indeterminacy presented? Not applicable in this record; LQ-008 covers indeterminate queue values.
6. Reconciliation path? The waiting semantics carry what happens next as quoted by the authority; the track surface reference is the reconciliation surface for a specific entry where one exists.
7. Which actions are available, and who owns them? Reveal queue composition (provider, deliberate); open the waiting status on the track surface; re-open the surface to re-query. The queue itself belongs to the Liquidity Authority.
8. What changes this state? The Liquidity Authority confirming funding/netting/clearance so an entry leaves the queue, or publishing new depths/positions. The surface re-queries on load and caches nothing.
9. What is this state explicitly NOT? Not a FIFO promise (ordering is authority-quoted, not UI-inferred); not an ETA surface; not a claim that these are all entries in the queue (the provider sees only its own entries, while depth is the authority-quoted whole-queue count).

## LQ-008 — Queue value indeterminate

Authority state: queue.value.unknown
Owning authority: the Liquidity Authority (runtime ARRIVING; mock-backed today)

1. What is the state? Any queue value — an entry's position, or a queue snapshot's depth — that the Liquidity Authority returned as indeterminate.
2. Who owns the truth? The Liquidity Authority, including the indeterminacy.
3. What does the user see? The indeterminate value renders UNKNOWN with subject, explanation, and reconciliation path (UnknownState presentation). For an entry, the waiting semantics and track link remain visible; for a snapshot, the entries list remains visible with each entry's own quoted-or-UNKNOWN state.
4. What must the user never see? Position "1" inferred from list order; depth equal to the rendered entry count; zero; an empty badge; the word "failed".
5. How is indeterminacy presented? As UNKNOWN with reconciliation, per value; the entry/snapshot is labeled LQ-008.
6. Reconciliation path? whoResolves: the Liquidity Authority; recheckTrigger: re-open the surface (fresh query, nothing cached as truth).
7. Which actions are available, and who owns them? Re-open the surface; use the track-surface reference for the entry's waiting status. Resolution belongs to the authority.
8. What changes this state? The authority publishing a determinate position or depth (→ LQ-007).
9. What is this state explicitly NOT? Not "first in queue by default"; not zero depth; not a rendering failure; not a reason to hide the entry's other quoted semantics.

## LQ-009 — Oversight aggregate, quoted

Authority state: oversight.aggregate.quoted
Owning authority: the Liquidity Authority or the Credit Authority per aggregate (runtime ARRIVING; mock-backed today)

1. What is the state? An oversight-permitted aggregate for which the owning authority returned a determinate quote (e.g., total reserved across providers; queued entries across providers; credit utilized across providers).
2. Who owns the truth? The named authority per aggregate (Liquidity Authority for liquidity/queue aggregates; Credit Authority for credit aggregates), per spec/architecture/v0.1 liquidity-credit-queues.md.
3. What does the user see? A read-only aggregate card: the quoted value, provenance wording ("Reported by the <authority> · quote <quoteId> · as of <UTC label>"), and an explicit note that the aggregate is quoted by the authority and never computed or summed by this surface.
4. What must the user never see? A UI-summed total; a breakdown into provider-identifying detail (oversight permission covers aggregates only); a partial aggregate; a per-provider drill-down.
5. How is indeterminacy presented? Not applicable in this record; LQ-010 covers the indeterminate aggregate.
6. Reconciliation path? Not applicable for a quoted aggregate; the aggregate's provenance note names the owning authority.
7. Which actions are available, and who owns them? Read (operator). No drill-down, no export, no recomputation. The aggregate belongs to the authority.
8. What changes this state? The authority publishing a new quote or an indeterminate one (→ LQ-010). The surface re-queries on every load.
9. What is this state explicitly NOT? Not a sum computed over provider positions; not a realtime metric; not permission to see provider identities; not comparable across time by the surface (no history is kept or implied).

## LQ-010 — Oversight aggregate indeterminate

Authority state: oversight.aggregate.unknown
Owning authority: the Liquidity Authority or the Credit Authority per aggregate (runtime ARRIVING; mock-backed today)

1. What is the state? An oversight-permitted aggregate the owning authority returned as indeterminate.
2. Who owns the truth? The named authority, including the indeterminacy.
3. What does the user see? The aggregate card renders UNKNOWN with subject, explanation, and reconciliation path (UnknownState presentation); the aggregate's label, note, and owning-authority badge remain visible.
4. What must the user never see? An estimated or partial aggregate; zero; an empty card; a "—" value; a UI-side fallback sum.
5. How is indeterminacy presented? As UNKNOWN with reconciliation, per aggregate; labeled LQ-010.
6. Reconciliation path? whoResolves: the owning authority named on the card; recheckTrigger: re-open the surface (fresh query, nothing cached as truth).
7. Which actions are available, and who owns them? Re-open the surface to re-query. Resolution belongs to the authority.
8. What changes this state? The authority publishing a determinate aggregate (→ LQ-009).
9. What is this state explicitly NOT? Not zero activity; not an outage; not a failed metric; not a reason to drop the aggregate from the oversight view.

## LQ-011 — Role not permitted (surface unrenderable)

Authority state: access.denied
Owning authority: the Liquidity Authority and the Credit Authority (their permissions are mirrored by the surface guard); runtime ARRIVING

1. What is the state? A role requests a visibility surface the owning authorities do not permit: /liquidity is permitted to the provider audience only, /oversight to the operator audience only; every other audience (unauthenticated, customer, merchant, provider on oversight, operator on liquidity, administrator in this mock's mirror) is denied.
2. Who owns the truth? The owning authorities define permission; the surface enforces it via requireRoleSurface (page-level redirect) and the port re-checks it per query (defense in depth — both must pass).
3. What does the user see? For page visits: a redirect home — the surface does not render at all. If a denied query somehow reaches the port, the surface renders a denial card carrying the authority's reason; never data.
4. What must the user never see? Partial data; teaser rows; counts; a "sign in to see more" upsell on this surface; any hint of another role's values; a soft 403 page that leaks the surface's existence beyond the redirect.
5. How is indeterminacy presented? This state is a permission fact, not an indeterminate value — nothing of the surface's data is rendered, so no UNKNOWN is shown for the underlying values either.
6. Reconciliation path? If the denial is wrong, the reconciliation is a role/permission change by the owning authorities at runtime — never a UI-side override. Deep links remain role-checked (P8) after any such change.
7. Which actions are available, and who owns them? The user may return home; the authorities own permission changes. The surface offers no "request access" flow (that would imply the surface owns the decision).
8. What changes this state? Only the owning authorities changing permitted audiences (at ARRIVING runtime, the authoritative permission source binds). The guard and the port mirror change together at merge/runtime.
9. What is this state explicitly NOT? Not a failed surface; not a 500; not an authentication bug; not a place to negotiate access; not a partial-visibility state.

## LQ-012 — Authority binding ARRIVING (mock backing)

Authority state: authority-binding.arriving
Owning authority: the Liquidity Authority and the Credit Authority (per spec/architecture/v0.1 liquidity-credit-queues.md); runtime ARRIVING

1. What is the state? The authoritative implementation of the liquidity, credit, and queue truth has not arrived; the surfaces are backed by the presentation-only mock (non-authoritative, sandbox data only).
2. Who owns the truth? The Liquidity Authority and the Credit Authority. The mock explicitly does NOT own anything — it is presentation-only, and every surface says so.
3. What does the user see? An ARRIVING banner on every surface: values come from the presentation-only mock and are not authoritative; provenance wording still names the authority that will own each value at runtime. The verification harness renders the same fact via the availability-unknown presentation naming the awaited binding.
4. What must the user never see? Mock values presented as authoritative; the ARRIVING notice hidden or dismissible into oblivion; provenance that names the mock as an authority.
5. How is indeterminacy presented? The binding itself is presented as availability-unknown ("The authoritative liquidity, credit, and queue implementation" with the ARRIVING detail) — distinct from per-value UNKNOWN (LQ-002/003/005/006/008/010), which remains available and correct even under mock backing.
6. Reconciliation path? whoResolves: the Liquidity Authority and the Credit Authority bindings arriving at runtime; recheckTrigger: the port accessor binds the authoritative implementation when it arrives — surfaces change nothing about how they present.
7. Which actions are available, and who owns them? Read-only inspection and verification-harness checks (developer role). No user action affects the binding.
8. What changes this state? The authoritative runtime arriving and binding behind the port accessor. All surfaces, mappings, and records remain unchanged — that is the point of the adapter boundary.
9. What is this state explicitly NOT? Not downtime; not a broken port; not permission to compute values UI-side "until the authority arrives"; not a reason to drop UNKNOWN presentation.

---

## Explicit non-states (never render these as states on these surfaces)

- Zero. An authority-UNKNOWN value is never rendered as 0, 0.00, or "no value".
- Empty/blank. An unknown cell is never an empty cell, a dash, or a bare skeleton.
- Failed. Indeterminacy is authoritative truth, never a fetch error or "failed to load" presentation.
- Definitive substitutes. No last-known, estimated, interpolated, or averaged value ever stands in for an indeterminate one.
- UI-side computation. Totals, available-from-balance-and-reserved, remaining-from-limit-and-utilized, utilization ratios, queue positions from list order, and aggregates summed from rows are not values and are never presented as such.
- Cached-as-truth. A previously seen value is never re-presented as current; every load re-queries.
- Loading skeletons as states. Skeletons are rendering affordances, not authority states, and never replace an UNKNOWN that the authority reported.
- Soft denial. "You would see data here if…" upsells are not part of the denied state — a denied surface renders nothing and redirects home.
- The mock as an authority. The mock is presentation-only; provenance never names it as an owner.

---

## UI-011 re-anchoring — runtime truth and the question-9 discharge

- **Owning authority:** the Liquidity Authority (A06) owns liquidity pools and positions (the INV-6-1 accounting: total = available + reserved + consumed, integer-exact); the Credit Authority (A07) owns credit lines and exposure (INV-7-1: exposure <= limit); the Queue Authority (A08) owns the queued-position snapshots.
- **Value provenance:** every quoted figure is the owning authority's own read — positions via positionsOf (pools enumerated from the real POOL_OPENED A15 chain), credit via linesInOrder + lineExposure, queue depth as the authority's own resident-item set. Each value carries its quote id, quoted-at, and owning authority (N1/P11: nothing computed UI-side).
- **UNKNOWN semantics (runtime truth):** the three oversight aggregates are authority-UNKNOWN BY READ-SURFACE GAP — the composed runtime exposes no cross-provider aggregate read, and the product never sums authority figures UI-side; each aggregate's explanation states the gap and its reconciliation names the owning authority's future read-surface extension (a recorded deferral, never a zero and never a failure). The verification overrides script the READ's availability axis only.
- **Reconciliation path:** re-request re-reads the authorities; pool/line/queue changes occur only through gateway-admitted commands (the D-2 un-hosted kinds driven by the owning authorities per the composed-journey precedent).
- **User-visible wording source:** every cell's provenance wording names the owning authority and quote identity (the mapping module's provenanceWordingForCell).
- **Role mirror (P8):** provider-positions answers providers only; operator-oversight answers operators only — refused, never filtered-and-shown.
- **Question 9 (user-visible state) — RTN-012's deferral DISCHARGED (see INTEGRATION-EVIDENCE.md and intent-mapping-records.md):** the liquidity/oversight surfaces render the composed runtime's real A06/A07/A08 data server-side; the per-port adapter suite (runtime-liquidity-adapter.test.ts) proves the quoted values, the authority-UNKNOWN aggregates, the role mirror, and the override scripting over the real runtime. End-to-end evidence rolls up under UI-010.
- **Recorded deferrals:** the cross-provider oversight aggregate read (recorded future read-surface work — the per-provider reads remain available); browser-context calls present denied-with-reason (no transport binding); the A06/A07/A08 command kinds are D-2 un-hosted (the composed-journey precedent drives them on the owning authorities).

