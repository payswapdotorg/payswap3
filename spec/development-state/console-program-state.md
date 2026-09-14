# PaySwap Developer Console Program State

**Program:** `payswap-developer-console`

**Status:** IN IMPLEMENTATION — PC-004 merged (+ Lead registry flip); PC-005 released

**Architecture baseline:** `4f973c92d7534a13854dfa4468bfa3a72dd14756`

**Design revision:** `05aa67535d0a2a28f5244f6f0e17e20059634144`

**Program baseline integration:** `9abc805c17ed81e8562a88c03170e44b2f8b8874` (Lead governed merge of the approved frozen package `arch/dev-console-spec` @ `65e85cd3bdbbe4bd634cd9d53c685c4b55951c38`; 13 files, 996 insertions, purely additive — no closed-record mutation)

## Work state

```text
PC-001  MERGED — 465e2f7ec489eefbd7638452e94860be367f5643 (PR #43)
   │
   ├───────────────┐
   ▼               ▼
PC-002  MERGED — de52ceed4b9e35db3f69de4af751b3e6d10148c9 (PR #44)   PC-003  MERGED — 324a1320e4c4b338296d9e42a382baa154bff70d (PR #45, head of main)
   │               │
   └───────┬───────┘
           ▼
        PC-004  MERGED — c47dc0e26d237819a48f69953bc0fbc23f52853a (PR #46) + Lead registry flip f310163
           │
           ▼
        PC-005  DISPATCHABLE
           │
           ▼
        PC-006  BLOCKED
           │
           ▼
        PC-007  BLOCKED
           │
           ▼
   Architect approval
```

Maximum three workers; safe concurrent set is PC-002 and PC-003 only.

## Merged revisions ledger

| Work item | Merged SHA | Merge path | Verification evidence |
|---|---|---|---|
| Program baseline integration | `9abc805c17ed81e8562a88c03170e44b2f8b8874` | Lead governed merge (additive docs only) | diff --name-status: 13 × A, 0 modifications |
| Lead baseline repair (RTN-010 DEP-007 recovery whitelist) | `0d528832b31767ce92f45fd411d60c09d338f20a` | Lead direct (6114e4e gate-repair precedent) | full bun suite 1965 pass / 0 fail (pre-existing failure proven identical at clean parent 9abc805 by worker AND independent Lead reproduction) |
| PC-001 console foundation, contracts, governance | `465e2f7ec489eefbd7638452e94860be367f5643` | PR #43 squash-merge (worker branch 38744fd, parent 9abc805) | `spec/console/PC-001-evidence.md`; typecheck 0 errors; build exit 0; focused 52/52; full suite 2017 pass / 0 fail at merged HEAD; owned boundary 22 × A / 0 M |
| PC-002 console shell and navigation | `de52ceed4b9e35db3f69de4af751b3e6d10148c9` | PR #44 squash-merge (worker branch cd75176, parent 8feb63c) | typecheck 0 errors; build exit 0; focused 43/43; full suite 2060 pass / 0 fail at branch HEAD (Lead reproduced); owned boundary 35 × A + 2 × M inside owned root; worker interrupted before final report — Lead verification record substitutes |
| PC-003 console API boundary and read models | `324a1320e4c4b338296d9e42a382baa154bff70d` | PR #45 squash-merge (worker branch 3a862af, parent 8feb63c; concurrent-wave sibling of #44, disjoint owned paths) | typecheck 0 errors; build exit 0 (8 API routes); focused 98/98; full suite 2111 pass / 0 fail at branch HEAD (Lead reproduced); owned boundary 30 × A / 0 M; developer-requests gap recorded (no owning source at baseline — explicit UNKNOWN, PENDING-PC-005) |
| PC-004 composed console views | `c47dc0e26d237819a48f69953bc0fbc23f52853a` | PR #46 squash-merge (worker branch cd6d656, parent 369c035) | typecheck 0 errors; build exit 0; focused 101/101; full suite 2240 pass / 0 fail (baseline 2154 + 86); owned boundary 47 files within owned roots; three-worker lineage (2 timeouts + finisher); finisher fixed 12 fixture-type errors, 1 genuine view bug (gap panel dropped in unavailable branch), 2 test-seam poisonings |
| Lead registry status flip (post-PC-004) | `f31016368138cc78799ead47b743b872ba465b36` | Lead direct (governed flip, 0d52883 precedent) | 16 PC-004-composed modules planned->available (developers/documentation stay planned pending PC-005); registry policy test + contracts summary assertion + matrix policy note updated in step; full suite 2240 pass / 0 fail; build green |

Battery progression: post-wave 2154 pass / 0 fail (baseline 2017 + 43 + 94) → post-PC-004 **2240 pass / 0 fail** (2154 + 86); typecheck 0 errors and build exit 0 throughout.

Next dispatch frontier: **PC-005** (serial; parent = `f31016368138cc78799ead47b743b872ba465b36`).

### Recorded observations (non-blocking)

- `spec/console-work-orders/README.md` references `console-program-state.json`; the Architect-created canonical artifact is this `.md` file (the handoff message names it). Recorded here rather than editing the frozen work-order surface.
- Administrator default access is fail-closed (design §6 grants administrator only explicitly-authorized visibility; nothing explicit exists yet — widening requires a governed change).
- The full `bun test` suite is NOT covered by `run_ci_gates` (which runs the `scripts/test_*.mjs` batteries); the console program therefore re-baselines the full suite at every merge gate.

## Immutable history

The closed completion program remains untouched. Its WORK/UI/DEP/SYS records and historical evidence are not a source of mutable console state.

## Provider truth

At the design baseline, live provider access must be re-verified at execution time. No Vercel, database, queue, Cloudflare, observability, or other provider is to be treated as connected without actual evidence from the connected integration.

## State-update rule

The Tech Lead updates this record only after merging a verified PC work item. Each update records the merged commit SHA, verification evidence location, and next dispatch frontier. Completion cannot be recorded here until Architect approval is explicit.
