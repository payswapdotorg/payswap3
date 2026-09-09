# Protocol Architecture v0.1 — Core Semantics (Areas 1-5)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 1 intent and demand; area 2 fulfillment policy;
area 3 capability discovery and commitments; area 4 routing/compiler;
area 5 reservations and concurrency.

## 0. Shared conventions (recap)

- Money: signed integer minor units, 3-letter currency code, explicit
  decimal scale per currency. No floating point anywhere (GC-1).
- MoneyBag: set of (currency, integer amount) entries; addition and
  subtraction are entrywise and deterministic.
- Evidence record fields: what, when, authority, outcome, proof (GC-5).
- External results may be UNKNOWN; the only exit from UNKNOWN is
  reconciliation (area 14); blind retry is forbidden (GC-2).
- External effects occur only behind area 13 rail adapters with explicit
  authorization (GC-3).
- The protocol layer is the single financial authority (GC-4).

## 1. Area 1 — Intent and demand

### Purpose

Capture a payer's demand for value transfer as a durable, authorized
statement with fixed monetary terms, from which all downstream execution
derives. The intent is the unit of demand; it is not itself money
movement.

### Core objects and state

PaymentIntent — durable statement of demand.
  States: DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING ->
  terminal(FULFILLED | FAILED | CANCELLED).
  Transitions are one-way; a failed or cancelled intent cannot be
  restarted. A retry is a new intent linked to the prior intent id.

DemandDescriptor — immutable attachment created at DRAFT: amount
(Money), source and destination descriptors, constraints (deadline,
allowed rails, cost ceiling), idempotency key.

IntentReceipt — idempotent response object: intent id, current state,
and recorded outcome for the submitted idempotency key.

### Owning authority

Intent Authority (protocol layer, area 1). Sole writer of PaymentIntent
state. Product layers may submit intents; they never mutate intent
state directly.

### Key invariants

- INV-1-1 (financial correctness): monetary terms are fixed at
  AUTHORIZATION. Any change after authorization requires a new intent;
  the old intent moves to CANCELLED with an evidence record.
- INV-1-2 (concurrency): state transitions are serialized per intent
  id. Concurrent submissions carrying the same idempotency key collapse
  to one intent and one receipt.
- INV-1-3 (idempotency): re-submission with a recorded idempotency key
  returns the recorded receipt; it never creates a second intent or a
  second financial effect.

### Failure and UNKNOWN semantics

Intent creation and transition are internal operations with
deterministic outcomes; this area has no UNKNOWN state. If routing or
fulfillment later fails, the intent moves to FAILED with a machine
readable reason code and a link to the failing evidence record.
Recovery: create a new intent referencing the prior intent id.

### Evidence produced

- INTENT_CREATED (what: intent terms; when; authority: Intent
  Authority; outcome: DRAFT; proof: submitted descriptor hash).
- INTENT_AUTHORIZED (outcome: AUTHORIZED; proof: policy decision id).
- INTENT_STATE_CHANGED (one record per transition, with reason code).

### Boundaries

- No rail access; no external effects (GC-3).
- No mutation of balances, obligations, or reservations; those belong
  to areas 5-12.
- Depends on area 2 at authorization, area 3 at routing, and area 16
  for compliance gating before AUTHORIZED.

## 2. Area 2 — Fulfillment policy

### Purpose

Define how an authorized intent selects its fulfillment shape: allowed
rails, ordering, cost ceilings, deadlines, and fallback preferences.
Policies are evaluated deterministically; they never move money.

### Core objects and state

FulfillmentPolicy — versioned, immutable policy document attached to
an intent at authorization time.
  Lifecycle: AUTHORED -> VERSIONED -> ATTACHED. No further state
  changes; a policy attached to an intent is fixed for that intent.

PolicyEvaluation — deterministic result of evaluating a policy against
an intent and a capability snapshot.
  States: EVALUATED -> CONSUMED.
  Contents: ranked route requirements, constraint envelope, cost
  ceiling, deadline.

### Owning authority

Policy Authority (protocol layer, area 2) owns policy semantics and
versioning. Intent Authority owns the attachment decision.

### Key invariants

- INV-2-1 (financial correctness): cost ceilings are Money values;
  policy comparisons are integer comparisons. Evaluation is a pure
  function of (policy version, intent terms, capability snapshot).
- INV-2-2 (concurrency): the capability snapshot id used for
  evaluation is recorded; re-evaluation with the same snapshot yields
  the same result.
- INV-2-3 (idempotency): one policy evaluation id per (intent,
  policy version, snapshot id); duplicate requests return the recorded
  evaluation.

### Failure and UNKNOWN semantics

Evaluation is internal and deterministic; failures are reason-coded
(POLICY_UNSATISFIABLE) and route the intent to FAILED. No UNKNOWN
state exists in this area. Recovery: attach a new policy version to a
new intent.

### Evidence produced

- POLICY_ATTACHED (policy version, snapshot id).
- POLICY_EVALUATED (outcome: evaluation id and result hash).

### Boundaries

- Policies do not create reservations, obligations, or rail
  operations.
- Policies never reference product UX state or deployment topology.
- Depends on area 3 for the capability snapshot format.

## 3. Area 3 — Capability discovery and commitments

### Purpose

Maintain the registry of what the network can currently do (rails,
corridors, limits, service tiers) and the commitment mechanism by
which capability holders promise capacity for specific intents.

### Core objects and state

Capability — advertised ability: rail id, corridor (source/destination
currencies and geographies), capacity limits, cost schedule, tier.
  States: REGISTERED -> ACTIVE -> DEGRADED -> RETIRED.
  Degraded capabilities accept no new commitments. Retirement is
  terminal.

Commitment — binding promise of capacity for one intent.
  States: OFFERED -> RESERVED -> CONSUMED | EXPIRED | RELEASED.
  RESERVED commitments count against capability capacity; CONSUMED is
  terminal and exactly once per intent.

CapabilitySnapshot — immutable, sequenced view of all capabilities at
a point in protocol time; consumed by policy evaluation and routing.

### Owning authority

Capability Authority (protocol layer, area 3) owns the capability
registry and commitment state. Capability holders submit attestations;
the authority validates and sequences them.

### Key invariants

- INV-3-1 (financial correctness): capacity limits are integer Money
  bounds; sum of RESERVED and CONSUMED commitments never exceeds the
  capability's declared capacity.
- INV-3-2 (concurrency): commitment transitions are serialized per
  (capability, intent); capacity accounting is updated atomically with
  commitment state.
- INV-3-3 (idempotency): commitment ids are derived from
  (intent id, capability id); duplicate requests return the recorded
  commitment state.

### Failure and UNKNOWN semantics

Registry operations are internal and deterministic. A capability
entering DEGRADED invalidates only OFFERED commitments; RESERVED
commitments remain valid until released by area 5 rules or expired by
deadline. No UNKNOWN state in this area. External attestations of
capability are inputs, not effects; stale attestations are ignored by
sequence number, never retried blindly.

### Evidence produced

- CAPABILITY_REGISTERED / CAPABILITY_STATE_CHANGED.
- COMMITMENT_OFFERED, COMMITMENT_RESERVED, COMMITMENT_CONSUMED,
  COMMITMENT_RELEASED, COMMITMENT_EXPIRED (each with capacity
  arithmetic in the proof field).

### Boundaries

- The registry never initiates rail operations.
- Commitments are capacity promises, not ledger entries; obligations
  are created only by clearing (area 9).
- Depends on area 15 for evidence and area 16 for risk gating of
  capability registration.

## 4. Area 4 — Routing/compiler

### Purpose

Compile an authorized intent plus its policy evaluation into a
concrete, ordered route plan: which rails, which hops, which
reservations to acquire, and which settlement instructions to expect.
Routing is a deterministic compilation step, not an execution step.

### Core objects and state

RoutePlan — compiled plan: ordered hops, each hop naming a capability
(rail id, corridor), an amount (Money), and expected settlement
semantics.
  States: COMPILED -> VALIDATED -> DISPATCHED ->
  terminal(COMPLETED | FAILED | ABANDONED).

RouteCompiler — deterministic function from (intent terms, policy
evaluation, capability snapshot) to either a RoutePlan or a
reason-coded failure (NO_VIABLE_ROUTE). Compiler versions are pinned;
the version id is recorded in every plan.

### Owning authority

Routing Authority (protocol layer, area 4) owns compilation and plan
state. Execution of a dispatched plan is owned by areas 5-13.

### Key invariants

- INV-4-1 (financial correctness): per hop, amounts are Money values;
  the plan's value preservation is checked by integer summation —
  for a simple transfer, hop amounts equal the intent amount in each
  currency leg, with explicit, recorded conversion amounts for any
  currency change. Fees are explicit Money line items; nothing is
  derived by floating point.
- INV-4-2 (concurrency): a plan is compiled against one capability
  snapshot id; dispatch acquires reservations (area 5) in the plan's
  fixed hop order.
- INV-4-3 (idempotency): compilation is keyed by (intent id, compiler
  version, snapshot id); identical inputs return the identical plan.

### Failure and UNKNOWN semantics

Compilation is internal and deterministic. NO_VIABLE_ROUTE is a
terminal failure that also emits a demand signal for area 24. During
execution, a hop may return UNKNOWN from a rail (area 13); the plan
then halts at DISPATCHED — it never re-dispatches hops blindly
(GC-2). Recovery proceeds only after reconciliation (area 14) resolves
the UNKNOWN rail operation; the plan then completes or fails based on
the resolved outcome.

### Evidence produced

- ROUTE_COMPILED (compiler version, snapshot id, plan hash).
- ROUTE_VALIDATED, ROUTE_DISPATCHED, ROUTE_COMPLETED, ROUTE_FAILED,
  ROUTE_ABANDONED (with reason codes and affected hop ids).

### Boundaries

- The compiler never calls rails and never mutates balances.
- Route plans reference capabilities by id; they do not embed
  adapter credentials or endpoints.
- Depends on areas 1-3 for inputs and area 5 for reservation
  acquisition during dispatch.

## 5. Area 5 — Reservations and concurrency

### Purpose

Provide the protocol's serialized, idempotent resource-holding
mechanism so that concurrent intents cannot over-commit liquidity,
credit, or capability capacity, and so that every hold is either
consumed or released — never silently lost.

### Core objects and state

Reservation — hold on a resource (liquidity position, credit
exposure, or capability commitment) for one intent and one hop.
  States: REQUESTED -> HELD -> terminal(CONSUMED | RELEASED |
  EXPIRED).
  Each reservation carries a deadline; expiry is deterministic on
  protocol time.

ReservationLedger — per-resource serialized log of reservation
transitions. The ledger is the concurrency frontier: all resource
mutations pass through it in sequence order.

### Owning authority

Reservation Authority (protocol layer, area 5) owns reservation state
and per-resource serialization.

### Key invariants

- INV-5-1 (financial correctness): for every resource, available =
  declared total minus held minus consumed, computed in integer
  Money; the identity holds after every transition.
- INV-5-2 (concurrency): transitions for the same resource are
  totally ordered by the ledger sequence; a REQUESTED transition
  either becomes HELD or is rejected — never left ambiguous.
- INV-5-3 (idempotency): reservation ids are derived from
  (intent id, hop id, resource id); duplicate requests return the
  recorded state; CONSUMED and RELEASED are exactly-once terminals.

### Failure and UNKNOWN semantics

Reservation operations are internal and deterministic. Crash
recovery replays the ledger tail: REQUESTED without a subsequent
transition is rolled forward to HELD or rolled back to RELEASED based
on the recorded decision, never duplicated. When a downstream rail
operation is UNKNOWN, associated reservations remain HELD until
reconciliation resolves the operation; they are then consumed or
released exactly once (GC-2).

### Evidence produced

- RESERVATION_HELD, RESERVATION_CONSUMED, RESERVATION_RELEASED,
  RESERVATION_EXPIRED (proof: ledger sequence number and arithmetic
  identity after transition).

### Boundaries

- Reservations are not obligations; obligation creation happens only
  in clearing (area 9).
- The reservation ledger does not initiate external effects.
- Depends on areas 6, 7, and 3 as resource owners, and on area 14
  for UNKNOWN resolution deadlines.
