# Protocol Architecture v0.1 — Disputes, Federation, Chains, Emergence (Areas 21-24)

Status: FROZEN — PaySwap protocol architecture v0.1
Part of: spec/architecture/v0.1/ (see README.md for global constraints)
Covers: area 21 disputes/recourse; area 22 federation; area 23
blockchain rails; area 24 capability emergence from unsupported
demand.

## 0. Shared conventions (recap)

- Money: signed integer minor units; no floating point (GC-1).
- Settled history is never mutated; recourse creates new linked
  obligations (GC-4, INV-10-1).
- External effects only through area 13 adapters (GC-3); UNKNOWN
  resolves only via reconciliation (GC-2).
- Every consequential operation writes evidence (GC-5).

## 1. Area 21 — Disputes/recourse

### Purpose

Define how parties challenge fulfilled activity — unauthorized
payments, wrong amounts, failed delivery — and how recourse is
executed as new, fully-evidenced ledger activity that reverses
economic effect without rewriting settled history.

### Core objects and state

Dispute — challenge against a completed fulfillment fact.
  States: OPEN -> UNDER_REVIEW ->
  terminal(RESOLVED_REFUNDED | RESOLVED_PARTIAL_REFUND |
  RESOLVED_REJECTED | RESOLVED_WRITTEN_OFF).
  Eligibility window and evidence requirements are fixed at OPEN.

RecourseObligation — new obligation created by clearing (area 9)
from a refund-resolution, reversing value between the parties.
  Lifecycle is the ordinary area 10 obligation lifecycle; its
  origin reference is the dispute resolution record.

RecourseClaim — the submitted claim package: disputed activity
reference, claim reason, supporting evidence references.
  States: SUBMITTED -> ADMITTED | REJECTED (admission is a
  formality gate, not a decision).

### Owning authority

Dispute Authority (protocol layer, area 21) owns dispute and claim
state. Recourse obligations are created only via the Clearing
Authority (area 9) from Dispute Authority instructions.

### Key invariants

- INV-21-1 (immutability of settled facts): disputes never mutate
  obligations, settlement, or finality records; every remedy is a
  new linked obligation (GC-4).
- INV-21-2 (finality respected): FINAL settlement records are never
  reversed in place; recourse executes as new value movement
  through areas 9-13.
- INV-21-3 (idempotency): one dispute per (activity reference,
  claimant) is adjudicated; duplicate submissions return the
  recorded dispute state; each resolution creates its recourse
  obligation exactly once.
- INV-21-4 (deadline determinism): eligibility windows are protocol
  time comparisons; late claims are terminally rejected without
  review.

### Failure and UNKNOWN semantics

Adjudication is internal and deterministic given the recorded
claim and rule version; no UNKNOWN state. If the recourse
obligation's settlement attempt becomes UNKNOWN at the rail, the
ordinary path applies: reconciliation (area 14) resolves, then
finality advances — never a blind re-submission (GC-2).

### Evidence produced

- DISPUTE_OPENED (activity reference, claim hash).
- DISPUTE_RESOLVED (outcome, rule version, adjudication proof).
- RECOURSE_CREATED (obligation id link).

### Boundaries

- Dispute handling defines no legal regimes; liability allocation
  is a policy input recorded with the resolution.
- Customer-facing dispute UX is a product concern.
- Depends on areas 9, 10, 12, 13, 14, 15, 16.

## 2. Area 22 — Federation

### Purpose

Define how independent PaySwap operators interoperate as peers:
mutual recognition of participants, exchange of obligations for
cross-operator flows, and coordinated netting and settlement —
with the same global constraints applied between peers as within
one operator.

### Core objects and state

FederationPeer — another PaySwap operator domain with a trust tier.
  States: REGISTERED -> TRUSTED | LIMITED -> SUSPENDED ->
  terminal(REVOKED).
  Trust tier bounds: netting exposure ceiling, settlement
  instruments permitted, cut-off windows. LIMITED peers net only
  within tight ceilings.

FederatedObligation — obligation (area 10 record) whose parties
  reside in different federating domains, carrying the peer id.
  Lifecycle is the ordinary obligation lifecycle; clearing and
  netting treat it like any other obligation within the peer's
  trust-tier limits.

FederationAgreement — versioned, recorded agreement fixing the
peer's tier, netting scope (bilateral only unless multilateral is
explicitly enabled), and settlement rails.

### Owning authority

Federation Authority (protocol layer, area 22) owns peer and
agreement state. Obligation, netting, and settlement semantics
remain owned by areas 10, 11, 12.

### Key invariants

- INV-22-1 (same rules): federated obligations follow identical
  invariants as domestic ones; federation adds limits, never
  exceptions to GC-1..GC-7.
- INV-22-2 (exposure ceiling): pending federated net exposure per
  peer never exceeds the trust-tier ceiling; the check is atomic
  with netting set membership (INV-11-2).
- INV-22-3 (idempotency): peer messages carry sequence numbers;
  replayed or out-of-order messages are ignored and recorded, never
  re-processed.

### Failure and UNKNOWN semantics

Peer messaging is asynchronous and unreliable by assumption.
Message loss suspends the affected flow deterministically —
cross-peer items wait in queues (area 8) or pending netting sets.
Cross-peer settlement executes through ordinary rail adapters
(area 13); UNKNOWN outcomes resolve through reconciliation
(area 14) exactly as domestic ones (GC-2). Peer suspension
freezes new obligations while in-flight ones resolve normally.

### Evidence produced

- PEER_STATE_CHANGED (tier, reason code).
- FEDERATION_OBLIGATION_REF (peer id, obligation id).
- PEER_MESSAGE_RECORDED (sequence, hash, disposition).

### Boundaries

- Federation defines no shared global ledger across peers; each
  domain's ledger is authoritative for its own records (GC-4),
  reconciled bilaterally.
- Governance of agreements (legal, commercial) is out of scope.
- Depends on areas 3, 8, 10, 11, 12, 13, 14, 15.

## 3. Area 23 — Blockchain rails

### Purpose

Specialize the area 13 rail adapter contract for blockchain rails
where finality is probabilistic before a confirmation depth and
where chain reorganizations can revert apparent confirmations.
The protocol maps chain observables to the adapter outcome classes
without ever letting the chain declare protocol finality.

### Core objects and state

BlockchainRailAdapter — RailAdapter (area 13) specialization with
chain parameters: chain id, finality depth (confirmation count),
reorg handling rules, address format.
  States follow area 13: REGISTERED -> ACTIVE -> DEGRADED ->
  RETIRED.

OnchainSubmission — the rail operation for a blockchain rail.
  States: AUTHORIZED -> SUBMITTED ->
  PENDING | terminal(CONFIRMED | FAILED | UNKNOWN).
  Semantics:
  - SUBMITTED: transaction broadcast; presence in mempool or a
    block below finality depth is PENDING, never CONFIRMED.
  - CONFIRMED: transaction included with at least finality-depth
    confirmations on the canonical chain, payload hash matching.
  - FAILED: deterministic rejection (e.g., invalid payload) or
    terminal omission after the chain's inclusion rules prove
    expiry — never inferred from latency.
  - UNKNOWN: broadcast outcome indeterminable, or a reorg
    invalidated an observation; durable, resolved by
    reconciliation.

ChainObservationReport — immutable record of chain state evidence:
block hashes, heights, transaction inclusion proofs, reorg events,
produced by the adapter's observers and treated as claims.

### Owning authority

Rail Adapter Authority (protocol layer, area 13) owns adapter and
operation state; blockchain parameters are adapter configuration.
Protocol finality remains exclusively owned by the Settlement
Authority (area 12).

### Key invariants

- INV-23-1 (no early finality): CONFIRMED requires finality-depth
  confirmations; PROVISIONAL finality in area 12 may precede FINAL
  but never skips the depth rule.
- INV-23-2 (reorg honesty): a reorg below finality depth moves the
  observation back to PENDING with a new report; it never flips a
  FINAL protocol record — because protocol FINAL is declared only
  after depth was reached, and reorgs deeper than the finality
  depth are handled as reconciliation adjustment cases.
- INV-23-3 (payload integrity): amounts and addresses are integer
  and string canonical forms; the payload hash recorded at
  authorization is re-verified on every observation.
- INV-23-4 (idempotency): the derived rail idempotency key maps to
  the chain transaction nonce discipline; double-broadcast of the
  same signed payload is the same external effect.

### Failure and UNKNOWN semantics

All ambiguous chain observables map to UNKNOWN, which opens a
reconciliation case automatically (GC-2). Reconciliation resolves
by chain evidence: transaction confirmed at depth -> attempt
CONFIRMED; provably dropped/expired -> FAILED; otherwise the case
remains INVESTIGATING. Protocol state never guesses on chain
silence.

### Evidence produced

- RAIL_OP_AUTHORIZED / SUBMITTED / REPORTED (area 13 records with
  chain-specific proof: tx id, block hash, height, confirmations).
- REORG_OBSERVED (depth, affected operation ids).

### Boundaries

- No protocol component other than this adapter reads chain state
  for operational decisions; chain data used elsewhere is recorded
  claim data.
- Gas fees and chain fee markets are adapter operational concerns;
  fee amounts, when charged into protocol Money, are explicit
  integer line items.
- Depends on areas 12, 13, 14, 15.

## 4. Area 24 — Capability emergence from unsupported demand

### Purpose

Define how the protocol learns from demand it cannot fulfill:
routing failures (NO_VIABLE_ROUTE), queue expirations in
under-served corridors, and merchant checkout cancellations in
unsupported geographies become demand signals that feed a
reviewed pipeline proposing new capabilities. Emergence is
analysis and review, never automatic deployment.

### Core objects and state

DemandSignal — one recorded instance of unsupported demand.
  States: COLLECTED -> ANALYZED | DISMISSED.
  Contents: what was demanded (corridor, currencies, constraints
  hash — never customer identity), where fulfillment failed
  (reason code), when.

SignalAnalysis — periodic aggregation over a window of signals.
  States: RUNNING -> terminal(COMPLETED | FAILED).
  Output: ranked underserved-demand findings with integer
  aggregation counts. No monetary estimates other than recorded
  Money sums of failed intent amounts.

EmergenceProposal — proposal to register a new capability (area 3)
or solicit a marketplace extension (area 18) addressing findings.
  States: DRAFT -> REVIEWED -> terminal(ACCEPTED | REJECTED).
  ACCEPTED routes to the area 3 registration process or the area
  18 manifest process; it never activates anything by itself.

### Owning authority

Emergence Authority (protocol layer, area 24) owns signal,
analysis, and proposal state. Capability activation remains with
area 3; marketplace review with area 18.

### Key invariants

- INV-24-1 (privacy floor): signals record demand shape and reason
  codes only; customer identity and full intent payloads are
  excluded.
- INV-24-2 (no auto-deployment): no state transition in this area
  creates capabilities, adapters, or external effects; acceptance
  only opens the standard reviewed processes.
- INV-24-3 (determinism): analysis over a fixed window and version
  yields identical findings; counts and sums are integer.

### Failure and UNKNOWN semantics

Collection and analysis are internal and deterministic; no
UNKNOWN state. Since this area never touches rails, no external
effect or reconciliation dependency exists. Analysis failures
retry safely on the next window because analysis is read-only
over immutable signals.

### Evidence produced

- SIGNAL_COLLECTED (shape hash, reason code).
- ANALYSIS_COMPLETED (window, findings hash).
- PROPOSAL_REVIEWED (decision, review references).

### Boundaries

- No product analytics responsibilities; product telemetry is a
  product concern.
- No pricing or market decisions; proposals carry findings only.
- Depends on areas 1, 4, 8, 20 for failure sources, and areas 3,
  18, 15 for downstream processes.
