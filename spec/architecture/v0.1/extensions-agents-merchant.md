# Protocol Architecture v0.1 — Extensions, Agents, Merchant (Areas 18-20)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 18 extensions/capability marketplace; area 19 agents and
mediation; area 20 merchant checkout/settlement primitives.

## 0. Shared conventions (recap)

- Money: signed integer minor units; no floating point (GC-1).
- External effects only at area 13 rail adapters with protocol
  authorization (GC-3).
- UNKNOWN resolves only through reconciliation (GC-2).
- Every consequential operation writes evidence (GC-5).

## 1. Area 18 — Extensions/capability marketplace

### Purpose

Define how third parties extend protocol reach by registering
capabilities (area 3) and rail adapters (area 13) through a
reviewed marketplace process. Extensions expand what the network
can do without ever gaining direct rights over protocol ledgers
or external effects.

### Core objects and state

ExtensionManifest — reviewed declaration of an extension's
contents: capabilities offered, adapters contributed, risk
profile, attestation references.
  States: SUBMITTED -> REVIEWED -> terminal(APPROVED | REJECTED);
  after approval: REGISTERED -> ACTIVE -> RETIRED.
  Rejection is terminal for that manifest version.

MarketplaceListing — public projection of an approved manifest:
discoverable metadata only. It contains no protocol authority
and no credentials.

AttestationRecord — evidence-backed claim attached to a manifest
capability (uptime history, capacity proof references). Attestations
are claims, not guarantees; the Capability Authority validates and
sequences them (area 3).

### Owning authority

Marketplace Authority (protocol layer, area 18) owns manifest
review and listing state. Activation of contributed capabilities
and adapters remains owned by areas 3 and 13 respectively.

### Key invariants

- INV-18-1 (no direct financial effect): extensions can produce
  external effects only through adapters they contributed, and only
  when those adapters operate under protocol authorization from
  area 12 (GC-3). Extensions can never write protocol ledgers.
- INV-18-2 (review gating): a manifest reaches REGISTERED only
  with a recorded compliance decision (area 16) and risk review
  evidence.
- INV-18-3 (idempotency): manifest ids are content-addressed
  (hash of the manifest); the same manifest submitted twice yields
  one review.

### Failure and UNKNOWN semantics

Review and registration are internal and deterministic; no UNKNOWN
state. If a contributed adapter later reports UNKNOWN rail
operations, resolution follows areas 13/14 unchanged — extension
status is irrelevant to UNKNOWN handling (GC-2). Retirement of an
extension degrades its capabilities (area 3 DEGRADED) and its
adapters (area 13 DEGRADED); in-flight operations still resolve
through reconciliation.

### Evidence produced

- MANIFEST_SUBMITTED (manifest hash).
- MANIFEST_REVIEWED (decision, review references).
- EXTENSION_STATE_CHANGED (registration/activation/retirement).

### Boundaries

- The marketplace never prices protocol fees; cost schedules live
  in capabilities (area 3).
- Marketplace metadata is a projection; protocol truth lives in
  the capability and adapter registries.
- Depends on areas 3, 13, 16, 15.

## 2. Area 19 — Agents and mediation

### Purpose

Define how autonomous or human agents participate as advisors and
mediators: suggesting policies, proposing resolutions to ambiguous
situations, and mediating between parties. Agents advise; protocol
authorities decide and record. No agent ever holds financial
authority.

### Core objects and state

Agent — registered participant with a declared role (advisor,
mediator, monitor).
  States: REGISTERED -> ACTIVE -> SUSPENDED -> REVOKED.
  Suspension and revocation are recorded with reason codes.

AgentProposal — advisory input attached to a decision point
(policy choice, queue release, dispute mediation).
  States: PROPOSED -> terminal(ACCEPTED | REJECTED | EXPIRED).
  Acceptance means the owning authority adopted the proposal as
  input to its own recorded decision — the decision, not the
  proposal, is authoritative.

MediationSession — structured resolution of an ambiguity between
parties' claims (e.g., conflicting statements about a queued item
or a reconciliation discrepancy).
  States: OPEN -> PROPOSED -> DECIDED | ABANDONED.
  Outcomes feed the owning authority (e.g., area 14 case
  resolution) and are recorded with the mediator identity.

### Owning authority

Agent Authority (protocol layer, area 19) owns agent registration
and proposal/session lifecycle. All financial decisions remain
with their owning authorities (areas 4, 8, 12, 14, 21).

### Key invariants

- INV-19-1 (advisory only): agent proposals never directly mutate
  financial state; every mutation carries the owning authority's
  decision record.
- INV-19-2 (determinism of record): accepted/rejected proposals
  are keyed by (decision point id, proposal id); one terminal
  outcome each.
- INV-19-3 (accountability): every proposal and decision names
  the agent identity and the deciding authority; both are recorded
  in evidence.

### Failure and UNKNOWN semantics

Agent participation is internal and asynchronous; proposals expire
deterministically. No UNKNOWN state. If a mediation concerns an
UNKNOWN rail operation, the operation remains UNKNOWN until the
Reconciliation Authority resolves it (GC-2); mediation may
recommend, not resolve.

### Evidence produced

- AGENT_REGISTERED / AGENT_STATE_CHANGED.
- PROPOSAL_RECORDED (decision point, proposal hash).
- PROPOSAL_RESOLVED (outcome, deciding authority).
- MEDIATION_DECIDED (session, outcome, parties).

### Boundaries

- Agents never write ledgers, never call rails, never declare
  finality.
- Agent behavior policies (models, heuristics) are out of scope;
  only the interaction contract is defined here.
- Depends on areas 14, 21, 15 as primary decision points.

## 3. Area 20 — Merchant checkout/settlement primitives

### Purpose

Define the protocol primitives that merchant-facing flows build
on: checkout sessions that produce intents, merchant settlement
obligations, and payout schedules. This area defines semantics,
not product UX; the checkout experience itself is a product
concern.

### Core objects and state

CheckoutSession — protocol-side anchor for one merchant payment
request: fixed terms (amount, currencies, deadline), merchant
identity, and the intent id it produces.
  States: OPEN -> terminal(COMPLETED | EXPIRED | CANCELLED).
  COMPLETED means the linked intent reached FULFILLED.

MerchantObligation — obligation (area 10 record) owed to or from
a merchant, created exclusively by clearing (area 9) from
fulfilled merchant activity. This area references obligations; it
never creates them.

PayoutSchedule — agreed schedule for settling merchant net
positions: cadence rule, minimum payout amount, destination rail
reference.
  States: AUTHORED -> ACTIVE -> SUSPENDED -> RETIRED.
  Execution of a payout is an ordinary settlement instruction
  (area 12) against the merchant's net obligations.

### Owning authority

Merchant Authority (protocol layer, area 20) owns session and
schedule state. Obligation state is owned by area 10; settlement
by area 12.

### Key invariants

- INV-20-1 (financial correctness): checkout terms are fixed at
  OPEN and copied verbatim into the intent (INV-1-1); payout
  minimums and amounts are integer Money.
- INV-20-2 (single intent): one checkout session produces at most
  one intent; retries with the same merchant request id reuse the
  session idempotently.
- INV-20-3 (no side settlement): merchant payouts always flow
  through netting and settlement (areas 11-12); there is no
  direct merchant rail path outside area 13 (GC-3).

### Failure and UNKNOWN semantics

Session expiry and cancellation are internal and deterministic.
Payout execution is a settlement attempt (area 12): if the rail
operation is UNKNOWN, the payout remains pending and a
reconciliation case (area 14) drives resolution — no blind
re-payout (GC-2). Confirmed failure allows a new fully-evidenced
payout instruction.

### Evidence produced

- CHECKOUT_OPENED / CHECKOUT_COMPLETED / CHECKOUT_EXPIRED /
  CHECKOUT_CANCELLED (terms hash).
- SCHEDULE_STATE_CHANGED.
- PAYOUT_INSTRUCTION_REF (link to area 12 evidence).

### Boundaries

- No UX semantics, presentation, or product flows are defined
  here.
- No direct balance exposure to merchants; balances are ledger
  projections (GC-4).
- Depends on areas 1, 9, 10, 11, 12, 13, 14, 15.
