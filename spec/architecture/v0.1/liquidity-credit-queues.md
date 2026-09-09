# Protocol Architecture v0.1 — Liquidity, Credit, Queues (Areas 6-8)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 6 liquidity; area 7 credit; area 8 queued/delayed
fulfillment.

## 0. Shared conventions (recap)

- Money: signed integer minor units with currency code and scale; no
  floating point (GC-1).
- Resource mutations pass through the area 5 Reservation Authority
  serialization.
- UNKNOWN external results resolve only via reconciliation (area 14);
  blind retry is forbidden (GC-2).
- Every consequential operation writes an evidence record with what,
  when, authority, outcome, proof (GC-5).

## 1. Area 6 — Liquidity

### Purpose

Define how the protocol tracks funds available for fulfillment, and
how those funds are held and consumed, without ever moving money
externally. Liquidity here is protocol-owned accounting of internal
positions; external money movement occurs only at settlement through
rail adapters.

### Core objects and state

LiquidityPool — protocol-owned account of funds usable for
fulfillment in one currency.
  States: OPEN -> FROZEN -> CLOSED. Frozen pools accept no new
  reservations; closure is terminal after all positions settle.

LiquidityPosition — component of a pool attributed to a funding
source or operational purpose.
  States: AVAILABLE -> RESERVED -> terminal(CONSUMED | RETURNED).
  Transitions are driven exclusively by area 5 reservations.

FundingEntry — record of funds entering a pool, referencing either
an internal transfer of settled funds (area 12) or a confirmed
external funding rail operation (area 13).

### Owning authority

Liquidity Authority (protocol layer, area 6) owns pool and position
state. No other layer may recompute or duplicate it (GC-4).

### Key invariants

- INV-6-1 (financial correctness): pool total equals the integer sum
  of its positions at all times; per position,
  available + reserved + consumed arithmetic is exact and integer.
- INV-6-2 (concurrency): position transitions occur only via the
  area 5 serialized ledger; pools are single-currency, so no
  cross-currency arithmetic occurs here.
- INV-6-3 (idempotency): a FundingEntry id applies exactly once;
  duplicate funding submissions are detected by id and recorded as
  duplicates without effect.

### Failure and UNKNOWN semantics

Pool accounting is internal and deterministic. External funding is
performed by area 13 rail operations, which may return UNKNOWN; in
that case no FundingEntry exists yet — the pool is unchanged, and
the case waits for reconciliation (GC-2). After reconciliation
confirms the external funding, the FundingEntry is created exactly
once. If reconciliation confirms failure, no entry is created.

### Evidence produced

- POOL_OPENED, POOL_FROZEN, POOL_CLOSED.
- POSITION_STATE_CHANGED (with post-transition arithmetic proof).
- FUNDING_RECORDED (linked rail operation id or internal transfer
  id).

### Boundaries

- Liquidity operations never touch rails directly (GC-3).
- Pools hold protocol accounting positions; customer-facing balances
  are a product projection, not owned here (GC-4).
- Depends on areas 5, 12, 13, and 14.

## 2. Area 7 — Credit

### Purpose

Define protocol-owned credit: limits, exposure, and deterministic
decisions on extending credit-backed fulfillment capacity. Credit
decisions are pure evaluations; the resulting capacity is held via
area 5 reservations like any other resource.

### Core objects and state

CreditLine — agreement extending fulfillment capacity against future
repayment.
  States: OFFERED -> ACTIVE -> SUSPENDED -> terminal(CLOSED).
  Suspension blocks new reservations; closure is terminal after
  outstanding exposure is settled or written off (areas 10, 12).

CreditExposure — current outstanding amount (Money, integer) on a
credit line, mutated only through area 5 reservations tied to
obligations from clearing (area 9).

CreditDecision — deterministic evaluation result for a requested
credit usage.
  States: EVALUATED -> APPLIED.
  Outcome: APPROVED with approved amount, or DENIED with reason
  code. No partial ambiguity: an approval names an exact integer
  amount.

### Owning authority

Credit Authority (protocol layer, area 7) owns lines, exposure, and
decision semantics.

### Key invariants

- INV-7-1 (financial correctness): exposure never exceeds the line
  limit; the check and the reservation are atomic under area 5
  serialization. Exposure arithmetic is integer Money.
- INV-7-2 (concurrency): exposure mutations are serialized per
  credit line; two concurrent approvals cannot both count the same
  remaining limit.
- INV-7-3 (idempotency): decisions are keyed by (intent id, line
  id); the same key always returns the same recorded decision.

### Failure and UNKNOWN semantics

Credit evaluation is internal and deterministic; no UNKNOWN state.
Repayment settlement runs through areas 9-12; if a repayment rail
operation is UNKNOWN, the obligation remains unsettled and exposure
is unchanged until reconciliation resolves it (GC-2). Write-off of
unrecoverable exposure is a terminal obligation transition recorded
in areas 10 and 21, never a silent credit mutation.

### Evidence produced

- CREDIT_LINE_STATE_CHANGED.
- CREDIT_DECIDED (decision id, key, outcome, reason code).
- EXPOSURE_CHANGED (post-transition integer arithmetic proof).

### Boundaries

- Credit never moves money externally; it is internal capacity.
- Credit policy parameters are inputs; this area defines semantics,
  not business parameters.
- Depends on areas 5, 9, 10, 12, 14.

## 3. Area 8 — Queued/delayed fulfillment

### Purpose

Define how intents whose fulfillment cannot proceed now — because
liquidity, credit, capability, or policy conditions are not met —
wait deterministically in queues until they become eligible, expire,
or are cancelled. Queues never duplicate work and never blindly
re-attempt external effects.

### Core objects and state

FulfillmentQueue — ordered waiting area with an eligibility rule
(resource availability, capability tier, deadline class).
  States: OPEN -> DRAINING -> PAUSED -> CLOSED.

QueuedItem — one waiting intent (or route plan awaiting dispatch).
  States: QUEUED -> ELIGIBLE -> DISPATCHED ->
  terminal(GRADUATED | CANCELLED | EXPIRED).
  GRADUATED means downstream fulfillment completed; the evidence
  chain links the item to the final outcome.

QueuePolicy — immutable per-queue policy: ordering rule, max wait,
release conditions. Ordering is deterministic: priority class, then
sequence number.

### Owning authority

Queue Authority (protocol layer, area 8) owns queue and item state.

### Key invariants

- INV-8-1 (financial correctness): queuing never changes monetary
  terms; the item references the intent's fixed terms (INV-1-1).
- INV-8-2 (concurrency): an item is resident in exactly one queue;
  eligibility evaluation is serialized per queue; no item is
  dispatched twice — dispatch is exactly-once per item id.
- INV-8-3 (idempotency): item state transitions are keyed by
  (item id, transition); replays return the recorded state.
- INV-8-4 (no blind retry): when a dispatched item's downstream rail
  operation is UNKNOWN, the item stays DISPATCHED; it is never
  re-queued or re-dispatched until reconciliation resolves the
  operation (GC-2).

### Failure and UNKNOWN semantics

Queue mechanics are internal and deterministic. Eligibility that
depends on external state is evaluated from protocol-owned snapshots
(areas 3, 6, 7), never by probing rails. If a dispatched item's
route fails deterministically, the item moves to CANCELLED with a
reason code; if the underlying rail operation is UNKNOWN, the item
remains DISPATCHED and the linked reconciliation case drives
recovery: confirmation graduates the item; confirmed failure
cancels it.

### Evidence produced

- ITEM_QUEUED, ITEM_ELIGIBLE, ITEM_DISPATCHED, ITEM_GRADUATED,
  ITEM_CANCELLED, ITEM_EXPIRED (each with queue sequence and
  reason codes where applicable).

### Boundaries

- Queues hold intents and plans, never money; no balances are
  mutated here.
- Queues must not implement business retry policies that re-submit
  external effects; only reconciliation-driven resume is allowed.
- Depends on areas 1-7 for inputs, areas 9-14 for downstream
  outcomes.
