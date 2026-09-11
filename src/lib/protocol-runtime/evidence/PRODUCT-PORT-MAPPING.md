# RTN-002 — Product-port evidence shapes → A15 slot mapping (read-only)

Work order RTN-002 "Required evidence": "a written mapping of each
product-port evidence shape (src/lib/protocol/tracking-port.ts
IntentEvidenceRecord) to A15 slots (read-only comparison; no product file
changes)."

Scope note (recorded in CONTRACT-REVIEW decision 19): the work order cites
"src/lib/protocol/tracking-port.ts IntentEvidenceRecord", but the repository
splits the shapes across the two product-port files —
`IntentEvidenceRecord` is declared in `src/lib/protocol/intent-port.ts`
(lines 196-204) and `tracking-port.ts` declares `EvidenceRecordView`
(lines 131-153). Both product-port evidence shapes are mapped below. This
document is a READ-ONLY comparison against frozen product types; no product
file was changed, and nothing here alters the product ports.

The A15 slots (spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15,
lines 26-32): `what` (operation type and subject object ids), `when`
(protocol time (sequenced) and recorded wall time), `authority` (which
protocol authority performed the operation), `outcome` (resulting state or
decision, including reason codes), `proof` (hashes, sequence numbers, and
links to prior records required to verify the record).

## 1. `IntentEvidenceRecord` (src/lib/protocol/intent-port.ts lines 196-204)

Product shape (verbatim field list):

```ts
export interface IntentEvidenceRecord {
  readonly id: string;
  readonly at: string;
  readonly authority: string;
  readonly kind:
    | 'submission-received'
    | 'consequence-terms'
    | 'authority-state-report'
    | 'acknowledgement';
  readonly summary: string;
  readonly details: readonly { readonly label: string; readonly value: string }[];
}
```

| Product field | A15 slot | Mapping (product ← A15 projection direction) | Gap vs. A15 |
|---|---|---|---|
| `id` | `proof` | A record id/link — in the A15 record this is `proof.recordId` (a kernel-derived `pid.v1.<sha256>`), not a product-minted string | Product `id` is presentation-scoped; it carries no chain link, no sequence, and no predecessor hash — the A15 `proof` slot adds `sequenceNumber`, `predecessorHash`, `recordHash` |
| `at` | `when` | The recorded wall time, as an ISO string — the presentation rendering of `when.wallMs` (integer epoch milliseconds) | Product has NO sequenced component — A15 `when` additionally carries `when.sequence` (the sequenced protocol time of the operation) |
| `authority` | `authority` | Direct 1:1 — the performing authority's name | A15 constrains the value to the registry's owning authorities; the product type is an unconstrained string (its mock backing fills it with authority names) |
| `kind` | `what` | The operation-type class of the recorded event (`submission-received`, `consequence-terms`, `authority-state-report`, `acknowledgement`) — a presentation vocabulary over the A15 `what.operationType` | Product `kind` is a closed presentation enum; A15 `what.operationType` is the protocol operation type (e.g. `INTENT_CREATED`) — a projection vocabulary, not the protocol vocabulary. Product has NO subject-object-id list; A15 `what.subjectIds` names the record's subjects |
| `summary` | `outcome` | The one-line rendering of the recorded decision — a presentation wording of the A15 `outcome.result` | Wording, not the machine result; no reason-code field (A15 `outcome.reasonCode`) |
| `details` | `outcome` / `proof` | Labeled presentation pairs expanding the outcome and the claim material (rail references, statement ids) | Free-form presentation shape; A15 keeps the machine fields (`outcome.result`/`outcome.reasonCode`) and records claim material as `proof.hashes` etc. — "External data referenced in proof fields ... is recorded as claims with their source" (A15 lines 64-68) |

Direction and lossiness: the product shape is a **presentation projection**
of an A15 record (or of an authority's answer). `A15 record →
IntentEvidenceRecord` is realizable (project `proof.recordId` → `id`,
`when.wallMs` → `at` (ISO), `authority` → `authority`, `what.operationType`
→ `kind` (via a presentation vocabulary), `outcome.result` → `summary` +
`details`). The reverse is NOT realizable: `IntentEvidenceRecord → A15
record` cannot recover `when.sequence`, `what.subjectIds`, the chain
material, or the machine-readable `outcome.result`. The product type
declares no `pending`/`no-answer` evidence variant — absence of a record is
modeled at the snapshot level (intent-port's `IntentQueryResult`
'no-answer'), which matches A15's "There is no UNKNOWN state in the log
itself" (line 64): absence of an answer is a query-level result, never a
log state.

## 2. `EvidenceRecordView` (src/lib/protocol/tracking-port.ts lines 131-153)

Product shape (verbatim field list):

```ts
export type EvidenceRecordView =
  | {
      readonly kind: 'recorded';
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      readonly recordedAt: string;          // ISO timestamp
      readonly outcomeWording: string;
    }
  | {
      readonly kind: 'no-answer';
      readonly recordId: string;
      readonly label: string;
      readonly owningAuthority: string;
      readonly explanation: string;
      readonly reconciliation: {
        readonly whoResolves: string;
        readonly recheckTrigger: string;
      };
    };
```

| Product field ('recorded' variant) | A15 slot | Mapping | Gap vs. A15 |
|---|---|---|---|
| `recordId` | `proof` | The record's id — the A15 `proof.recordId` projected | No sequence number, no predecessor hash, no record hash |
| `label` | `what` | The presentation wording of what the record is about — a rendering of `what` (operation type and subject) as one string | The subjects themselves (`what.subjectIds`) and the protocol operation type are not carried |
| `owningAuthority` | `authority` | Direct 1:1 — the owning authority that answers for the record | Same as above: A15 constrains to the registry's owning authorities |
| `recordedAt` | `when` | ISO rendering of `when.wallMs` | No sequenced component (`when.sequence`) |
| `outcomeWording` | `outcome` | "The outcome wording as recorded — presented, never rewritten" (tracking-port.ts line 140): the presentation wording of `outcome.result` (+ reason code) | Machine result and reason code are not carried as fields |

The 'no-answer' variant maps to **no A15 record at all**: it is the
product-side UNKNOWN presentation (P5/P7: absence of an answer is
first-class, with a reconciliation path). A15 line 64: "There is no UNKNOWN
state in the log itself" — the log records facts; a missing answer is a
query-level condition owned by the answering authority, not a record state.
The `reconciliation` field of the variant corresponds to A15's reconciliation
boundary (lines 64-68: "verification of external claims is reconciliation's
job (area 14), not the log's") — the product surface points at the same
area-14 exit that GC-2 defines for UNKNOWN.

Direction and lossiness: identical to `IntentEvidenceRecord` — a one-way
projection; the chain, the sequence, and the machine fields are dropped.
The tracking port's own header (lines 18-21) states the ownership split
this mapping confirms: "the Intent Authority (tracked consequential states
+ plain-language history) and the Evidence Authority (proof-trail records).
This port is a read-only projection of their answers; it never decides,
computes, or synthesizes."

## 3. What the A15 record adds over both product shapes (the projection gap)

Both product-port shapes are presentation projections; the A15
`EvidenceRecord` is the authoritative form. The material only A15 carries:

- `when.sequence` — the sequenced protocol time (totally ordered evidence).
- `what.subjectIds` — the record's subject object ids (not a wording).
- `proof.sequenceNumber` — the log's total sequence.
- `proof.predecessorHash` + `proof.recordHash` — the hash chain ("Each
  record's proof includes the hash of its predecessor, making tampering
  detectable", A15 lines 35-37).
- `proof.recordId` — the derived (INV-15-4) record identity.
- `outcome.result` / `outcome.reasonCode` — machine-readable decision and
  reason code.
- The write discipline: an A15 record is committed synchronously with the
  operation it records (A15 lines 62-64); the product shapes have no commit
  semantics — they are read-side views.

Consequence for later work (informational, not a change proposal): when the
product ports re-anchor to the composed runtime (UI-011, gated on the
merged composed runtime per the wave README), each product evidence view
can be derived from an A15 record by projection; the projection is lossy in
the A15 → product direction only, which is the safe direction (the product
ports keep no second evidence authority — GC-4's single-financial-authority
discipline extends to evidence ownership: the A15 Evidence Authority owns
the log and schema, A15 lines 39-43).
