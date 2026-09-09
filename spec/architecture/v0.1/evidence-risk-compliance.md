# Protocol Architecture v0.1 — Evidence, Risk, Simulation (Areas 15-17)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 15 evidence; area 16 risk/compliance; area 17
simulation/replay. (See README.md Known limitations for the coverage
note relative to the original work-order area labels.)

## 0. Shared conventions (recap)

- Money: signed integer minor units; no floating point (GC-1).
- Every consequential operation produces an evidence record (GC-5).
- Simulation and replay never mutate production state (GC-6).

## 1. Area 15 — Evidence

### Purpose

Define the durable, append-only record of everything consequential
the protocol does: the audit backbone that makes every financial
state change explainable, replayable, and provable after the fact.

### Core objects and state

EvidenceRecord — one immutable record per consequential operation.
  Fields (mandatory, exactly these five semantic slots):
  - what: operation type and subject object ids.
  - when: protocol time (sequenced) and recorded wall time.
  - authority: which protocol authority performed the operation.
  - outcome: resulting state or decision, including reason codes.
  - proof: hashes, sequence numbers, and links to prior records
    required to verify the record.
  State: WRITTEN (terminal). Records are never updated or deleted.

EvidenceLog — append-only, totally sequenced, hash-chained log of
EvidenceRecords. Each record's proof includes the hash of its
predecessor, making tampering detectable.

### Owning authority

Evidence Authority (protocol layer, area 15) owns the log and
record schema. All other authorities are writers-by-submission
only; none can alter or suppress records.

### Key invariants

- INV-15-1 (completeness): every consequential operation — every
  state transition in areas 1-14 and 18-24 that creates, mutates,
  or resolves financial state, or authorizes an external effect —
  writes exactly one record (GC-5).
- INV-15-2 (immutability): the log is append-only; no record is
  modified or removed; corrections are new records that reference
  the corrected one.
- INV-15-3 (integrity): the hash chain verifies deterministically
  from genesis; verification is a pure function of the log.
- INV-15-4 (idempotency): evidence write keys derived from the
  subject operation id prevent duplicate records for one
  operation.

### Failure and UNKNOWN semantics

Evidence writing is internal and synchronous with the operation it
records: an operation is not committed until its record is written.
A failed write fails the operation. There is no UNKNOWN state in
the log itself. External data referenced in proof fields (rail
references, statement ids) is recorded as claims with their
source; verification of external claims is reconciliation's job
(area 14), not the log's.

### Evidence produced

The log's own lifecycle events are also recorded (log genesis,
verification runs). Verification results are recorded with the
verified chain height and final hash.

### Boundaries

- The log records facts; it never interprets them or drives
  operational decisions.
- The log is not a product analytics store; projections for
  analytics are derived copies.
- Retention and archival policy are deployment concerns; the
  architecture requires the chain to remain verifiable.
- Depends on all other areas as submitters; depends on nothing
  downstream.

## 2. Area 16 — Risk/compliance

### Purpose

Define deterministic risk and compliance evaluation as gates and
advisories inside protocol flows: sanction and exposure screening,
velocity and limit rules, and review queues. Compliance decisions
block or allow progression; they never themselves move money.

### Core objects and state

RiskRule — versioned, immutable rule definition with an explicit
evaluation function signature.
  States: AUTHORED -> VERSIONED -> ACTIVE -> RETIRED.

ComplianceCheck — one evaluation instance tied to a subject
(intent, capability registration, merchant onboarding).
  States: EVALUATED -> terminal(APPROVED | DENIED |
  MANUAL_REVIEW) -> after review: APPROVED | DENIED.
  MANUAL_REVIEW is a durable state; a reviewed decision is recorded
  with reviewer authority identity and reason.

ScreeningResult — deterministic outcome of matching subject data
against a screening list version (sanctions, blocked parties).
  States: COMPUTED -> terminal(CLEAR | HIT).
  HIT creates a MANUAL_REVIEW ComplianceCheck; auto-decision is
  forbidden for hits.

### Owning authority

Risk/Compliance Authority (protocol layer, area 16) owns rule
semantics, check lifecycle, and screening evaluation. List
providers and reviewers are inputs; decisions become durable
protocol records here.

### Key invariants

- INV-16-1 (determinism): evaluation is a pure function of
  (rule version, screening list version, subject data hash);
  identical inputs always produce the identical recorded outcome.
- INV-16-2 (no float risk): all threshold comparisons use integer
  Money or integer counts.
- INV-16-3 (gating): state transitions gated by compliance
  (intent AUTHORIZATION, capability ACTIVATION) cannot complete
  without a terminal APPROVED record for the subject.
- INV-16-4 (idempotency): check ids are keyed by (subject id,
  rule set version); re-evaluation returns the recorded result.

### Failure and UNKNOWN semantics

Evaluation is internal and deterministic. External list updates
are inputs, not effects; a failed list refresh leaves the prior
version active and records the failure — never a silent guess.
There is no UNKNOWN decision state: undecided checks block the
gated transition until resolved.

### Evidence produced

- CHECK_DECIDED (subject, rule set version, outcome, reason code).
- SCREENING_COMPUTED (list version, subject hash, outcome).
- REVIEW_RECORDED (reviewer authority, decision, rationale).

### Boundaries

- Risk/compliance never creates obligations or rail operations;
  its only power is gating and recording.
- It never exports subject data beyond protocol boundaries; list
  contents remain configuration data.
- Depends on areas 1, 3, 15.

## 3. Area 17 — Simulation/replay

### Purpose

Define how the protocol can be exercised safely: simulations that
run protocol semantics against isolated copies of state, and
replays that re-execute recorded history to verify deterministic
behavior. Neither ever touches production financial state (GC-6).

### Core objects and state

Simulation — a bounded experiment.
  States: CREATED -> RUNNING -> terminal(COMPLETE | ABORTED).
  Inputs: a state snapshot id (an isolated copy), a scenario
  definition, a pinned rules version. Output: a result trace
  marked non-authoritative.

ReplayTrace — re-execution of a segment of the evidence log
against a replayed state copy, comparing every step's outcome to
the recorded outcome.
  States: RUNNING -> terminal(MATCHED | DIVERGED).
  DIVERGED records the first divergent operation with both
  outcomes.

SimulationScope — declared boundary: which areas' semantics are
exercised, which snapshots are loaded. Rail adapters are replaced
by recorded or scripted rail reports; no real external submission
can occur from a simulation.

### Owning authority

Simulation Authority (protocol layer, area 17) owns simulation and
replay state. All runs execute against isolated state copies
(GC-6).

### Key invariants

- INV-17-1 (isolation): simulations and replays operate only on
  copied state; there is no code path from a simulation run to a
  production ledger write or a real rail operation (GC-6, GC-3).
- INV-17-2 (sandbox containment): simulation configuration carries
  no production rail authorization; production effects require
  separate explicit production authorization (GC-7).
- INV-17-3 (determinism): with pinned rules version and snapshot,
  re-running a simulation yields identical traces (GC-1 extended
  to the whole pipeline).
- INV-17-4 (non-authoritative output): simulation results are
  marked non-authoritative and cannot be referenced as evidence of
  production facts; only the run's own lifecycle is recorded in the
  production evidence log.

### Failure and UNKNOWN semantics

Scripted rail reports inside simulations may simulate UNKNOWN
outcomes to test reconciliation paths; these are synthetic and
affect only isolated state. Simulation crashes abort the run with
no production effect. Replay divergence is recorded and reported;
it never automatically corrects production state — correction
follows the ACR/manual case process with evidence.

### Evidence produced

- SIMULATION_COMPLETED / SIMULATION_ABORTED (scope, rules version,
  result trace reference — marked non-authoritative).
- REPLAY_COMPLETED (segment bounds, MATCHED or DIVERGED with
  details).

### Boundaries

- Simulations never write the obligation ledger, settlement, or
  finality state of production.
- Simulation outputs never feed product-facing balances (GC-4).
- Depends on all areas as the semantics under test, and area 15
  for replay source data.
