# PaySwap production readiness proof contract

**Work order:** DEP-008 — Production readiness proof
**Status:** the proof harness and evidence contract defined by DEP-008 (`scripts/test_production_readiness.mjs` + `deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md`); production deployment binding stays FUTURE-WORK (the `production_gate` contract in `deploy/contracts/components.json` is authoritative)
**Base:** main @ a39cccf312cf55aff6321eb5e0dbbde7936f201b (DEP-006 + DEP-007 + the product closure candidate UI-010 all merged — the work order's dependency gate)
**Owned surfaces:** release-candidate operational verification (the readiness proof harness, the verification transcript, the release-record freeze)
**Forbidden:** claiming production readiness from sandbox-only evidence
**Companions:** `spec/deployment/ci-cd.md` (the promotion contract the freeze composes over), `spec/deployment/observability.md` (the drill machinery the proof composes over), `spec/deployment/environments.md` (the fail-closed rules F1–F8), `spec/deployment/topology.md` (rollback principles R1–R5), `deploy/contracts/components.json` (the registry incl. the `ci_cd` object), `scripts/validate_deployment.py` (the static gate)

## 1. Scope and the hard evidence boundary

DEP-008 delivers a **release-readiness proof harness** that freezes ONE exact release revision and drives every acceptance dimension of the work order against it. It is a bounded extension of the existing harnesses — it WRAPS `scripts/test_protocol_composed_journey.mjs`, `scripts/test_observability_resilience.mjs`, `scripts/test_operations.mjs` and `scripts/test_rail_connectivity.mjs` (re-running them as child processes and asserting their green exit and composed markers) and COMPOSES the DEP-006 promotion tooling (`scripts/promote.mjs` record / migrate / rollback-plan) and the DEP-007 machinery (`src/lib/recovery/`, `src/lib/observability/`, the rail-connectivity boundary). No drill is forked; no runtime surface is edited.

**The hard boundary (environments.md F8):** everything the harness proves is SANDBOX evidence. Production readiness is never inferred from sandbox behavior; the sandbox proves nothing about production. The harness's final line states this itself. The forbidden claim of the work order — production readiness from sandbox-only evidence — is a contract violation, not a wording preference. What the evidence DOES establish: the release candidate's protocol integration, UI integration, failure-injection behavior, substrate-level scaling invariants, configuration/secret safety, backup/restore/replay recovery, UNKNOWN reconciliation, external-effect safety, rollback-plan conformance and observability, all at one exact, reproducible revision, in the same environment a fresh clone runs the gates in.

## 2. The release freeze

The immutable release identifier is the DEP-006 promotion record: `node scripts/promote.mjs record` on a committed, clean revision appends a `promotion-record` entry (commit SHA, tree digest, tracked-file-set content digest, the fresh gate table) to `deploy/promotions/promotion-records.jsonl`. Two properties of the append-only store shape every proof run:

- **Records trail revisions** (ci-cd.md §3): a record for revision X can only be committed at some Y > X. The proof harness therefore selects **the last promotion-record whose commit SHA resolves in the local git history** (skipping rebase-orphaned records — the DEP-006-era rehearsal records R1/R2 reference commits that were rebased away when their PRs merged — with the skipped count disclosed in the transcript). At any tree where a DEP-008 release record is committed, that record is the newest resolvable one and is the record under proof.
- **Only committed records are frozen identities**: the harness reads the records store from HEAD's committed version (`git show HEAD:deploy/promotions/promotion-records.jsonl`). An uncommitted append cannot be reproduced by a worktree checkout and is not a release identity; the harness notes any dirty tail and proves the committed truth.

The identity proof re-derives the record's content digest in a temp git worktree at the recorded SHA using the promotion tool's exact algorithm, verifies the recorded tree digest against `git rev-parse <sha>^{tree}`, requires the recorded gate table to be all-green, and re-runs the migration gate via `promote.mjs migrate <record-id>` inside a THROWAWAY worktree at HEAD (the append lands in the throwaway; the repository records file stays byte-identical — verified per run).

## 3. The proof groups

`scripts/test_production_readiness.mjs` (Node, zero npm dependencies, the DEP-007 harness style) runs ten named, counted, fail-closed proof groups. A failure in any group marks THAT group FAILED, the run continues (the full picture is the deliverable), and the verdict FAILS CLOSED (non-zero exit, no false green).

| # | Group | Proves (acceptance dimension) |
|---|---|---|
| 1 | `proof:release-identity` | the frozen release revision: the record located and well-formed, the commit/tree/content digests re-derived and matching, the gate table all-green, the migration gate on a copy, the sandbox recording context |
| 2 | `proof:protocol-integration` | production-like protocol integration: the wrapped composed journey (golden path to finality, evidence-chain verification, duplicate/restart safety) + a fresh gateway composition proving admission, recorded-receipt replay, the typed refusal matrix and command-path poisoning (never admitted, never executed) |
| 3 | `proof:ui-integration` | the UI-011 re-anchoring: the seven runtime adapters and port seams, the one composition root, the retired mock shims, the splice guard, the shell at `/` and the F6 liveness/readiness routes, the standalone build output when present (mode declared honestly) |
| 4 | `proof:failure-injection` | the wrapped DEP-007 drill battery + an adapter timeout storm (N=25, none retried, none translated), bounded retry exhaustion (the 4th attempt never issued), duplicate external submissions collapsing at every layer, and no injected failure mutating authoritative state |
| 5 | `proof:scaling-behavior` | SUBSTRATE-level scaling evidence in-sandbox: a 500-job burst across 25 kinds (no loss, FIFO discipline, exactly-once effects), worker lease exclusivity and no double execution under two-worker contention, and the bounded-refusal surfaces (drain pass bound, deadline cutoff, concurrency bound, attempt bound). NOT a claim about production horizontal scaling |
| 6 | `proof:config-secret-safety` | fail-closed startup configuration (missing production names ⇒ NOT ready, ids only), the F1 allowlist agreement across implementation/registry/documents, credential REFERENCES only, the S1-style secret scan over the whole tracked tree, and the environment-crossing refusal (the promotion tool refuses a resolved production context; sandbox rail config never satisfies production scope; cross-contamination refused) |
| 7 | `proof:backup-restore-queue-recovery` | the composed DEP-007 drill: populate (all reachable statuses incl. a dead letter and a reserved zombie) → verified backup → destroy → restore with the full verification battery → queue replay to settlement → exactly-once effects → the worker-restart path |
| 8 | `proof:unknown-reconciliation` | UNKNOWN surfaced (never silently retried, never translated), held for the A14 path, resolved to terminal states with evidence (the wrapped composed-journey and operations drills); zero unreconciled UNKNOWN at proof end |
| 9 | `proof:external-effect-safety` | unsafe retries refused (UNKNOWN/timeout/in-flight never retransmitted; safe pre-effect failures re-driven with the SAME rail idempotency keys, bounded), duplicates deduped by key at every layer, post-effect failures routed to recourse (listed, not executed), the rollback plan honoring R1–R5 (finality never reversed) |
| 10 | `proof:rollback-observability` | the rollback plan for the release record referencing the recorded immutable revision (and the previous record as the R1 target), and the observability stack reporting the full proof run (telemetry snapshots over the injected degradation, the worst-of health rollup, the drill log as the transcript) |

## 4. Stop conditions (the alarm system)

The work order's six stop conditions are CHECKED by real assertions in their owning groups; the harness computes a verdict per condition and fails closed if any is triggered — or left unverifiable by a failed group:

| Stop condition | Checked in |
|---|---|
| any unsafe external retry | `proof:failure-injection` + `proof:external-effect-safety` |
| environment crossing | `proof:config-secret-safety` |
| missing recovery path | `proof:backup-restore-queue-recovery` |
| unreconciled UNKNOWN | `proof:unknown-reconciliation` |
| configuration ambiguity | `proof:config-secret-safety` |
| unexplained authority bypass | `proof:protocol-integration` |

A failed-but-honest proof (a group FAILED, a stop condition recorded as triggered, the limitation reported) is a valid deliverable state; a green-but-fudged one is a governance violation.

## 5. Evidence requirements and the output contract

- **The immutable release identifier**: the promotion record (id + commit SHA + tree/content digests + the gate table) committed in `deploy/promotions/promotion-records.jsonl`.
- **The complete verification transcript**: a captured run of the harness committed as `deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md` — the exact command lines, the full group tables, the release record id, the per-group timings, and the stop-condition audit (each condition explicitly checked and NOT triggered).
- **Machine-parseable JSONL**: the harness emits one record per proof scenario on STDOUT (`{"type":"proof-scenario",...}` plus group and verdict records). STDOUT is byte-deterministic across runs at the same tree — REQUIRED by the ci-cd.md §2 battery determinism contract, because the harness is glob-enumerated into the `harnesses` gate whose per-harness stdout digests `promote.mjs verify` compares. Wall-clock timing therefore lives on STDERR as companion `{"type":"proof-timing",...}` records (machine-parseable; captured in the transcript): the dispatch guidance's ask for timing inside the stdout JSONL loses to the repository's own determinism contract, and this is the disclosed resolution.
- **The security/configuration proof**: the `proof:config-secret-safety` group's captured output in the transcript (the S1 scan result over the release tree, the fail-closed refusal matrix, the environment-crossing refusal evidence).
- **Architect approval**: the harness and transcript end with a RECOMMENDATION addressed to the Architect. The approval itself is NOT the worker's to claim — the state file records it separately.

## 6. Verification (machine contract)

`python3 scripts/validate_deployment.py` validates this contract as its DEP-008 section: the proof harness and this document exist and name all ten proof groups and all six stop conditions; the `ci_cd` object in `deploy/contracts/components.json` carries the readiness-harness, transcript and contract paths agreeing with the tree; the S1 secret-boundary scan covers the new surfaces; and — once a promotion record exists whose recorded commit subject begins `DEP-008:` (the release revision of this work item) — the transcript document exists and names that record id, its release revision, the ten groups and the stop-condition audit. Until that record exists the transcript requirement is waived (append-only records trail the revision they freeze — ci-cd.md §3); the battery stays green at the implementation commit so the record can be created.

## 7. FUTURE-WORK (recorded, not invented here)

- The production deployment binding (DEP-002+; the `production_gate` contract stays authoritative — this proof is promotion EVIDENCE, never a deployment).
- Production-shaped restore rehearsal (the sandbox drills are the evidence here — observability.md §8).
- Horizontal/vertical capacity planning and load testing against production-shaped infrastructure (the scaling group is substrate-level in-sandbox evidence only).
- Externalized observability backends (metrics endpoints, alerting — DEP-002+ per component).
