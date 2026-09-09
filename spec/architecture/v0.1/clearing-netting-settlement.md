# Protocol Architecture v0.1 — Clearing, Netting, Settlement (Areas 9-12)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 9 clearing; area 10 obligations; area 11 bilateral and
multilateral netting; area 12 settlement and finality.

## 0. Shared conventions (recap)

- Money: signed integer minor units; no floating point (GC-1).
- The obligation ledger (area 10) is the protocol's single financial
  truth for who owes whom (GC-4).
- External effects occur only at area 13 rail adapters under explicit
  authorization (GC-3); their results may be UNKNOWN, and UNKNOWN
  resolves only through reconciliation (GC-2).
- Every consequential operation writes an evidence record (GC-5).

## 1. Area 9 — Clearing

### Purpose

Convert completed fulfillment activity into ledger-ready records:
validated, deduplicated, and staged economic events from which
obligations are created exactly once. Clearing is deterministic
batch processing, not money movement.

### Core objects and state

ClearingBatch — unit of staged processing.
  States: OPEN -> STAGED -> COMMITTED -> FINAL.
  Contents are immutable after STAGED. COMMITTED means obligations
  have been created; FINAL means all produced obligations are handed
  to the obligation ledger.

ClearingRecord — one economic event inside a batch: reference to
the fulfilling activity (route plan hop, intent), parties, Money
amounts, and reason.
  States: ACCEPTED -> STAGED | QUARANTINED.
  Quarantined records never produce obligations; they await manual
  or automated disposition with reason codes.

### Owning authority

Clearing Authority (protocol layer, area 9) owns batch and record
state, and is the only creator of obligation creation instructions.

### Key invariants

- INV-9-1 (financial correctness): amounts are integer Money;
  staging performs per-currency integer summation checks; a batch is
  committed only if every included record passes validation.
- INV-9-2 (concurrency): batches are processed in sequence order;
  record deduplication keys (origin activity id) guarantee a
  committed batch produces each obligation exactly once.
- INV-9-3 (idempotency): re-committing the same batch id is a no-op
  returning the recorded result.

### Failure and UNKNOWN semantics

Clearing is internal and deterministic. Invalid records are
quarantined, never dropped. Because clearing consumes only
protocol-internal activity records, it has no UNKNOWN state; any
upstream UNKNOWN (rail operations during fulfillment) must already
be resolved by area 14 before the activity becomes clearable.

### Evidence produced

- BATCH_STAGED (record count, per-currency totals hash).
- BATCH_COMMITTED (obligation ids created, idempotency proof).
- RECORD_QUARANTINED (reason code, origin reference).

### Boundaries

- Clearing creates obligation instructions; it does not net, settle,
  or touch rails.
- Clearing never reclassifies settled history.
- Depends on areas 1-8 for origin activity, area 10 for obligation
  creation, area 15 for evidence.

## 2. Area 10 — Obligations

### Purpose

Maintain the authoritative ledger of who owes whom what, in which
currency, from which clearing origin, in what lifecycle state. This
ledger is the protocol's financial truth (GC-4); every downstream
netting or settlement fact is a projection of it.

### Core objects and state

Obligation — a single ledger debt entry.
  States: CREATED -> NETTED -> SETTLEMENT_PENDING ->
  terminal(SETTLED | DISPUTED | WRITTEN_OFF | CANCELLED).
  Transitions:
  - CREATED -> NETTED: replaced by net positions in a committed
    netting set (area 11).
  - SETTLEMENT_PENDING: a settlement instruction (area 12) exists.
  - SETTLED: settlement finality recorded (area 12).
  - DISPUTED: a dispute (area 21) is open; resolution creates new
    obligations, never mutates this one.
  - WRITTEN_OFF: terminal disposition via risk authority.
  - CANCELLED: correction path with mandatory evidence.

ObligationLedger — append-only, totally sequenced log of obligation
records and transitions.

### Owning authority

Obligation Ledger Authority (protocol layer, area 10) — the single
financial authority for debt state (GC-4). No product or deployment
component writes or duplicates this ledger.

### Key invariants

- INV-10-1 (financial correctness): obligations are integer Money
  per currency; the ledger never mutates an amount after creation —
  corrections are new linked obligations.
- INV-10-2 (concurrency): ledger transitions are serialized by
  sequence; each obligation transitions at most once per state.
- INV-10-3 (idempotency): obligation creation from clearing is keyed
  by origin record id; duplicate instructions are no-ops.
- INV-10-4 (authority): only clearing commits, dispute outcomes,
  and risk write-offs create or terminalize obligations.

### Failure and UNKNOWN semantics

The ledger is internal and deterministic; no UNKNOWN state. If a
settlement attempt later becomes UNKNOWN, the obligation remains in
SETTLEMENT_PENDING unchanged until reconciliation resolves the rail
operation (GC-2); finality then advances or fails the obligation
exactly once.

### Evidence produced

- OBLIGATION_CREATED (origin reference, terms hash).
- OBLIGATION_STATE_CHANGED (each transition, with cause reference).
- OBLIGATION_WRITTEN_OFF (risk authority reference).

### Boundaries

- The ledger never calls rails and never computes netting; netting
  (area 11) derives from it.
- Customer-facing statements are projections; they never feed back
  into ledger state.
- Depends on areas 9, 11, 12, 16, 21.

## 3. Area 11 — Bilateral and multilateral netting

### Purpose

Reduce sets of obligations to net positions without changing total
value: pairwise (bilateral) between two participants and cyclic or
optimization-based (multilateral) across many participants. Netting
is a deterministic computation over the obligation ledger.

### Core objects and state

NettingSet — one netting computation over a closed set of
obligations.
  States: OPEN -> COMPUTED -> COMMITTED.
  OPEN: input obligation ids fixed. COMPUTED: net positions
  computed and checkable. COMMITTED: input obligations moved to
  NETTED and replaced by net obligations in the ledger.

NetPosition — per participant, per currency net amount (signed
integer Money) after netting, with a breakdown hash proving
conservation.

NettingScope — bilateral (exactly two participants) or
multilateral (three or more, defined participant set).

### Owning authority

Netting Authority (protocol layer, area 11) owns netting
computation and set state; obligation transitions remain owned by
area 10, executed only on Netting Authority instruction.

### Key invariants

- INV-11-1 (financial correctness, conservation): for every
  currency in the set, the integer sum of net positions equals the
  integer sum of gross obligations; the check is recorded in the
  set's proof before commit.
- INV-11-2 (concurrency): an obligation can belong to at most one
  open netting set; set membership is claimed atomically at OPEN.
- INV-11-3 (idempotency): computing a set is a pure function of its
  fixed input ids and the netting algorithm version; re-commit of a
  committed set id is a no-op.

### Failure and UNKNOWN semantics

Netting is internal and deterministic; failures are validation
failures that abort the set before commit with no ledger effect.
No UNKNOWN state. If a netted obligation's settlement later returns
UNKNOWN, resolution follows area 12/14 rules; netting history is
never recomputed after commit.

### Evidence produced

- NETTING_SET_OPENED (input obligation ids).
- NETTING_COMPUTED (algorithm version, per-currency conservation
  proof).
- NETTING_COMMITTED (net obligation ids created).

### Boundaries

- Netting never settles; it only transforms obligations.
- Netting never includes obligations in DISPUTED state.
- Depends on areas 10, 12, 15.

## 4. Area 12 — Settlement and finality

### Purpose

Define how net obligations are executed externally through rail
adapters, how results (including UNKNOWN) are handled, and how
finality — the irreversible endpoint of a financial obligation — is
declared solely by the protocol.

### Core objects and state

SettlementInstruction — protocol authorization to move value
externally for one obligation or net position.
  States: CREATED -> ISSUED -> terminal(CONFIRMED | FAILED).
  ISSUED means a rail operation exists (area 13).

SettlementAttempt — one authorized external attempt for one
instruction.
  States: CREATED -> SUBMITTED -> PENDING |
  terminal(CONFIRMED | FAILED | UNKNOWN).
  Exactly one attempt is authorized at a time per instruction; a
  second attempt requires the first to be terminally resolved via
  reconciliation.

FinalityRecord — protocol declaration that value movement is
irreversible.
  States: PROVISIONAL -> FINAL.
  PROVISIONAL is set from rail confirmation semantics (e.g., rail
  ack, blockchain confirmations before protocol depth); FINAL is
  declared by protocol rule only. FINAL advances the obligation to
  SETTLED exactly once.

### Owning authority

Settlement Authority (protocol layer, area 12) owns instruction,
attempt, and finality state. Rail adapters report outcomes; they
never declare protocol finality.

### Key invariants

- INV-12-1 (financial correctness): instruction amounts are integer
  Money copied verbatim from the obligation; the rail operation
  payload hash is recorded and compared on result.
- INV-12-2 (single attempt rule): at most one live attempt per
  instruction; blind retry is impossible by construction (GC-2).
- INV-12-3 (idempotency): attempt authorization is keyed by
  instruction id; rail idempotency keys are derived deterministically
  and passed to the adapter.
- INV-12-4 (finality exclusivity): only the Settlement Authority
  writes FinalityRecord state; FINAL is exactly-once per obligation
  and irreversible; reversal of a settled fact is only possible as a
  new obligation via dispute/recourse (area 21).

### Failure and UNKNOWN semantics

Confirmed failure marks the attempt FAILED and the instruction
FAILED; recovery is a new instruction with a new attempt, fully
evidenced. UNKNOWN is a durable attempt state: the instruction stays
ISSUED, the obligation stays SETTLEMENT_PENDING, and a
reconciliation case (area 14) is opened automatically. Only the
reconciliation resolution may drive the attempt to CONFIRMED or
FAILED and then advance finality. Resumption after resolution is
safe-resume, never re-submission of the same external effect (GC-2).

### Evidence produced

- SETTLEMENT_INSTRUCTION_CREATED (obligation id, amount hash).
- SETTLEMENT_ATTEMPT_AUTHORIZED (attempt id, rail op id).
- SETTLEMENT_ATTEMPT_RESOLVED (outcome, resolution reference).
- FINALITY_DECLARED (PROVISIONAL or FINAL, rule reference, proof).

### Boundaries

- Settlement never computes netting or mutates obligations beyond
  lifecycle transitions.
- Settlement does not implement rail protocols; area 13 does.
- Finality is protocol-owned even when informed by rail or
  blockchain confirmation data.
- Depends on areas 10, 11, 13, 14, 15.
