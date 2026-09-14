# SYS-003 — the system closure corpus

**Status:** the SYS-003 deliverable evidence (the closure gate's inputs and
outputs; the `.json` matrix is machine-generated, the `.md` documents are the
human records bound to the machine output)
**Work order:** `spec/system-work-orders/SYS-003.md`
**Closure gate:** `scripts/test_system_closure.mjs` (fail-closed; deterministic stdout; the `closure-verdict` line is the machine verdict)

## The corpus index (file → role → generator)

| File | Role | Generator |
|---|---|---|
| `spec/system-closure/final-reconciliation-matrix.json` | the MACHINE artifact: the final reconciliation matrix — 70 acceptance-surface rows (33 protocol-frozen, 3 bootstrap, 12 RTN, 11 UI, 8 DEP, 3 SYS) + the 24-row honest-handoff ledger, each row with its evidence pointers, recorded merge SHA, ancestor-of-HEAD and subject-containment proofs | `scripts/generate_final_reconciliation_matrix.mjs` (deterministic; pure derivation from the state files + Git history) |
| `spec/system-closure/final-reconciliation-matrix.md` | the human mirror of the matrix (same rows, same totals — the gate cross-checks the mirror documents every row) | `scripts/generate_final_reconciliation_matrix.mjs` (written with the json) |
| `spec/system-closure/state-synchronization-proof.md` | the state synchronization proof: per development-state file — claims vs Git history vs reconciliation result vs residual deltas (family C) | hand-authored, bound to the machine output (the `closure:state-sync` group's assertions; every merge fact re-proven live) |
| `spec/system-closure/closure-record.md` | the Architect closure record FINAL (family D): program identity, the acceptance mapping (each bullet → matrix rows → mechanical proof → result), the run-time release revision mechanism, the sandbox-environment disclaimer, the honest-handoff ledger summary, the stop-condition audit, the post-closure governance contract, and the recorded `Architect sign-off: RECORDED (Lead finalize)` block | hand-authored; signed and RECORDED at the Lead finalize; the residual DRAFT vocabulary was removed at the closure-hygiene pass |
| `spec/system-closure/README.md` | this corpus index | hand-authored |

## The supporting scripts

| Script | Role |
|---|---|
| `scripts/test_system_closure.mjs` | the closure gate (family A): mechanically asserts every SYS-003 acceptance bullet; spawns the governance + deployment validators and parses their RESULT/result lines; re-derives the matrix live and fails closed on divergence from the committed artifact; emits the `closure-verdict` JSON line with the per-bullet results, the evidence pointers, and the run-time release revision (`git rev-parse HEAD` / `HEAD^{tree}` — never hand-written) |
| `scripts/generate_final_reconciliation_matrix.mjs` | the matrix generator (family B engine): the pure derivation (`deriveMatrixContent`) + the CLI that writes the json/md pair. Fail-closed on unparseable state, missing dispositions, or unproven merge facts |

## How to verify the closure

```bash
node scripts/test_system_closure.mjs
```

The gate is additive and read-only over the repository: it composes
(spawns) the validators, parses the state files and Git history, and never
modifies anything. Exit 0 = every acceptance bullet mechanically proven
(the `closure-verdict` line carries the per-bullet table); exit 1 = fail
closed with the failing group and assertion.

## How to regenerate the matrix (the Lead finalize flow)

```bash
node scripts/generate_final_reconciliation_matrix.mjs
```

Deterministic (pure function of the state files + Git history — no
timestamps, no wall clock). At the Lead finalize — after the state files
record SYS-003 merged and the program status moves to SYSTEM COMPLETE —
re-run the generator and commit the refreshed matrix alongside the finalize
state update, then re-run the closure gate (it fails closed on any
divergence between the committed matrix and the live derivation — stale
evidence never passes).

## Environment class

SANDBOX. The closure proves the REPOSITORY system; production claims stay
gated on the DEP-002+ production deployment binding
(environments.md F8 — the hard boundary). No production financial claim may
be derived from this corpus.
