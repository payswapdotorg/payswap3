# Protocol Architecture v0.1 — Rails, Adapters, Reconciliation (Areas 13-14)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 13 external rail adapters; area 14 reconciliation.
(Area 15, evidence, is covered in evidence-risk-compliance.md; see
README.md Known limitations for the coverage note.)

## 0. Shared conventions (recap)

- Money: signed integer minor units; no floating point (GC-1).
- This file defines the ONLY boundary for external financial effects
  (GC-3) and the ONLY path out of UNKNOWN (GC-2).
- Every consequential operation writes an evidence record (GC-5).

## 1. Area 13 — External rail adapters

### Purpose

Define the sole boundary between protocol state and the outside
financial world: bank rails, payment networks, wallet providers,
blockchain rails (area 23 specializes this contract). Adapters
translate protocol-authorized instructions into external actions and
report external results back — including UNKNOWN — without ever
owning protocol financial state.

### Core objects and state

RailAdapter — registered connector for one external rail family.
  States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
  DEGRADED adapters accept no new operations; in-flight operations
  continue to report results.

RailOperation — one authorized external effect.
  States: AUTHORIZED -> SUBMITTED ->
  PENDING | terminal(CONFIRMED | FAILED | UNKNOWN).
  - AUTHORIZED: created by Settlement Authority (area 12) with a
    linked settlement instruction; this link is the explicit
    authorization required by GC-3.
  - SUBMITTED: request handed to the external rail.
  - PENDING: rail accepted but outcome not yet known.
  - CONFIRMED / FAILED: rail-asserted outcomes with payload proof.
  - UNKNOWN: submission outcome cannot be determined (timeout,
    connection loss, ambiguous rail response). This is a durable
    state; adapters MUST NOT resolve UNKNOWN by re-submission.

RailResultReport — immutable report from the rail: outcome class,
rail reference identifiers, timestamp, and payload proof (hash).

### Owning authority

Rail Adapter Authority (protocol layer, area 13) owns adapter
registry and operation lifecycle. The external rail is an
untrusted reporter: its data is evidence, not protocol truth.

### Key invariants

- INV-13-1 (boundary exclusivity): external financial effects are
  produced only by RailOperations in SUBMITTED or later states, and
  only when created by protocol authorization (GC-3). No other
  component in the entire system may produce an external effect.
- INV-13-2 (financial correctness): operation payloads carry
  integer Money verbatim from the authorization; payload hash is
  recorded at submission and re-checked on every report.
- INV-13-3 (idempotency): each operation carries a deterministic
  rail idempotency key derived from the instruction id; where the
  rail supports idempotency keys, duplicate submissions at the rail
  collapse; where it does not, single-attempt discipline is enforced
  by the area 12 single-attempt rule.
- INV-13-4 (no guessing): adapters must map every submission to
  exactly one report class; they never infer CONFIRMED or FAILED
  from silence. Silence or ambiguity maps to UNKNOWN.

### Failure and UNKNOWN semantics

Adapter-local failures (malformed payload, rail rejection at
submission) map to FAILED with reason codes before any external
effect occurs. After submission, any non-deterministic outcome maps
to UNKNOWN, which:

1. Opens a reconciliation case (area 14) automatically.
2. Leaves the rail operation durably in UNKNOWN.
3. Forbids re-submission of the same external effect (GC-2).

Recovery is exclusively: UNKNOWN -> reconciliation -> known result
-> safe resume (area 12 advances finality or fails the
instruction).

### Evidence produced

- RAIL_OP_AUTHORIZED (instruction link, payload hash, idempotency
  key).
- RAIL_OP_SUBMITTED (adapter id, rail references).
- RAIL_OP_REPORTED (outcome class, rail references, payload proof).
- ADAPTER_STATE_CHANGED (with reason codes).

### Boundaries

- Adapters never write obligation, settlement, or finality state;
  they report to area 12.
- Adapters never hold protocol balances; the external rail's
  balance view is an external claim to be reconciled, not truth
  (GC-4).
- Adapter credentials and endpoints are configuration, not
  architecture; they must never appear in protocol documents.
- Depends on areas 12, 14, 15.

## 2. Area 14 — Reconciliation

### Purpose

Define the systematic process that resolves UNKNOWN external
operations, matches protocol expectations against external rail
statements, and drives safe resumption. Reconciliation is the only
exit from UNKNOWN (GC-2) and a primary control against drift
between protocol truth and the outside world.

### Core objects and state

ReconciliationCase — one resolution unit.
  States: OPEN -> INVESTIGATING ->
  terminal(MATCHED | RESOLVED_CONFIRMED | RESOLVED_FAILED |
  RESOLVED_ADJUSTED).
  - Every UNKNOWN rail operation automatically opens exactly one
    case, and the case stays open until a terminal resolution.
  - MATCHED: protocol expectation and external statement agree.
  - RESOLVED_CONFIRMED / RESOLVED_FAILED: the UNKNOWN operation's
    true outcome is established; downstream state advances exactly
    once.
  - RESOLVED_ADJUSTED: a discrepancy is corrected by creating new
    ledger entries (never by mutating history).

ReconciliationCycle — periodic matching run over a window of
protocol records and external statements (settlement reports,
account statements, blockchain state).
  States: OPEN -> COLLECTED -> MATCHED -> CLOSED.
  Discrepancies become cases.

ReconciliationSource — registered external statement provider
(rail settlement report, statement file, on-chain observer),
treated as untrusted input with sequence numbers.

### Owning authority

Reconciliation Authority (protocol layer, area 14) owns case and
cycle state and is the only authority permitted to resolve an
UNKNOWN rail operation.

### Key invariants

- INV-14-1 (completeness): every rail operation in UNKNOWN state
  has exactly one open case at all times; closure requires a
  terminal resolution with recorded proof.
- INV-14-2 (exactly-once resolution): a case's terminal
  resolution transitions the originating rail operation exactly
  once; duplicate resolutions are rejected by case id.
- INV-14-3 (no history mutation): adjustments create new linked
  obligations or ledger entries; existing evidence and settled
  records are never rewritten.
- INV-14-4 (determinism): matching rules are pure functions of
  (protocol record set, external statement set, rule version);
  identical inputs produce identical case decisions.

### Failure and UNKNOWN semantics

Reconciliation consumes external statements that may themselves be
incomplete or delayed. Missing statements keep cases in
INVESTIGATING; they never force a guess. If a statement provider
contradicts protocol truth, the protocol ledger stands (GC-4) and
the discrepancy becomes an adjustment case with mandatory evidence.
Recovery paths from each terminal resolution:

- RESOLVED_CONFIRMED: area 12 marks the attempt CONFIRMED and
  advances finality.
- RESOLVED_FAILED: area 12 marks the attempt FAILED; a new
  instruction may be created, fully evidenced as a new external
  effect.
- RESOLVED_ADJUSTED: new linked obligations created via area 9/10
  paths.

### Evidence produced

- CASE_OPENED (origin rail operation id).
- CASE_RESOLVED (terminal class, proof: matched statement
  references or adjustment ledger references).
- CYCLE_CLOSED (window bounds, matched counts, open case count).

### Boundaries

- Reconciliation never re-submits external effects; it resolves
  them.
- Reconciliation never declares finality directly; it feeds
  resolution to area 12.
- Emergency manual resolutions follow the same case lifecycle and
  evidence requirements; there is no out-of-band path.
- Depends on areas 12, 13, 10, 15.
