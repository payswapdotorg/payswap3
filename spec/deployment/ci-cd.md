# PaySwap CI/CD and promotion contract

**Work order:** DEP-006 — CI/CD and promotion
**Status:** ACTIVE (DEP-006)
**Base:** main @ 663b1d4c4e3f1e4b9ebdd2b2758520cb5d8067ed
**Owned surfaces:** CI/CD workflows, build/package evidence, promotion and rollback automation
**Forbidden:** bypassing governance; unverified production promotion
**Companions:** `spec/deployment/topology.md` (runtime topology, rollback principles R1–R5, contract evolution), `spec/deployment/environments.md` (environment classes, fail-closed rules F1–F8), `spec/deployment/packaging.md` (the runtime package and health/readiness contract), `deploy/contracts/components.json` (the machine-readable registry, including the `ci_cd` contract object), `scripts/validate_deployment.py` (the static gate that machine-checks this contract)

## 1. Scope and principles

DEP-006 delivers CI/CD and promotion as **repository-local automation that runs identically in CI and on an operator's machine**:

1. **Repo-local gates only.** Every gate the CI workflow invokes is a repository-local script that also runs green with plain `bun` / `python3` / `node` in a fresh clone. No gate exists that only CI can run — a local "success" and a CI "success" are the same statement.
2. **GitHub Actions is the only connected infrastructure provider today.** The CI workflow (`.github/workflows/ci.yml`) targets GitHub Actions; every gate it invokes is repo-local. No other external service is bound (no artifact registry, no external deployment platform, no secret store).
3. **Production deployment binding is FUTURE-WORK.** This contract delivers promotion EVIDENCE (records, verification, rollback plans) — it never deploys to production. The `production_gate` contract in `deploy/contracts/components.json` stays authoritative; unverified production promotion is forbidden (work-order Forbidden list). The promotion tool refuses a resolved `PAYSWAP_ENV=production` context outright (§4).
4. **Fail-closed everywhere.** A missing input — an unknown record id, an unparsable records file, a dirty working tree at record time, a failed gate, an unreadable migration — is an error, never a silent pass.
5. **Zero new npm dependencies.** The tooling is plain Node (≥ 22.6) plus the repository's own toolchain (`bun`, `python3`); `package.json`, `package-lock.json` and `bun.lock` remain byte-identical.

## 2. The gate battery

`scripts/run_ci_gates.mjs` (Node, zero dependencies) executes the gates in ONE fixed order and prints a machine-parseable gate table: **one JSON object per line on stdout** (gate progress and gate output are forwarded to stderr so stdout stays pure JSON), ending with a verdict line. The runner exits non-zero if ANY gate fails.

| # | Gate | Command |
|---|------|---------|
| 1 | `governance` | `python3 scripts/validate_governance.py` |
| 2 | `deployment-contract` | `python3 scripts/validate_deployment.py` |
| 3 | `durable-contract` | `python3 scripts/validate_durable.py` |
| 4 | `typecheck` | `bun run typecheck` (`tsc --noEmit`) |
| 5 | `harnesses` | `node scripts/test_*.mjs` — every harness, enumerated by glob (never a hardcoded list that can drift); each harness's exit code and stdout digest are recorded in the gate line |
| 6 | `build` | `bun run build` (next build, standalone output per packaging.md §1) |

Gate-table line format (stdout):

```json
{"type":"gate","gate":"governance","command":"python3 scripts/validate_governance.py","exit":0,"passed":true,"wall_ms":44,"stdout_sha256":"…"}
{"type":"verdict","passed":true,"gates_total":6,"gates_failed":0,"runner":"scripts/run_ci_gates.mjs"}
```

Properties:

- **Determinism:** all gates except `build` produce byte-identical stdout across runs at the same tree; the `build` gate's stdout embeds tool timing lines (`next build` prints compilation timings) — its stdout digest is therefore exempt from byte-comparison while its exit code and its ARTIFACT determinism (the package-snapshot digests, §6) are not. Stdout digests are computed with the runner's **absolute repository-root path normalized to `<REPO>`** — the checkout location is environment, not content, so a local clone and a CI runner (different checkout paths) produce the SAME gate table for the same tree.
- **Idempotence:** the runner leaves no state that changes a second run's RESULT. Build outputs (`.next/`, `tsconfig.tsbuildinfo`) are overwritten deterministically by the underlying tools and are gitignored; the runner writes nothing else.
- **Fail-closed enumeration:** a `harnesses` gate with zero discovered `scripts/test_*.mjs` files fails (a broken glob or wrong tree is never a silent pass).

## 3. The promotion record

`deploy/promotions/promotion-records.jsonl` is the **append-only** promotion record store (JSON Lines; each non-empty line is one JSON object). Entry types:

### 3.1 `promotion-record` (written by `promote.mjs record`)

| Field | Meaning |
|-------|---------|
| `record_id` | unique id: `pr-<epoch-ms>-<content-digest-prefix>` |
| `created_at` / `created_at_epoch_ms` | creation timestamp |
| `work_order` / `base_branch` / `schema_version` | provenance (`DEP-006`, `main`, 1) |
| `revision.commit_sha` | the exact immutable commit being promoted |
| `revision.commit_subject` | the commit subject (one-line human identification) |
| `revision.tree_digest` | `git rev-parse HEAD^{tree}` |
| `revision.content_digest` | sha256 over `"<sha256-of-file>  <path>\n"` lines for every git-tracked file in lexical order — the node-computed equivalent of `git ls-files -z \| sort -z \| xargs -0 sha256sum`, hashed again |
| `revision.tracked_file_count` | size of the tracked file set |
| `environment_context` | the `PAYSWAP_ENV` allowlist context recorded through the frozen `src/lib/environment.ts` module (raw value, resolved value, the `sandbox \| production` allowlist, the `sandbox` fail-safe, and the production-promotion refusal note) |
| `gate_table` / `gate_verdict` | the gate table + verdict from a FRESH `run_ci_gates.mjs` run |
| `evidence` | pointers to the audit trail and the rehearsal document |

**Refusal rules (fail-closed, nothing appended):**

1. ANY failed gate in the fresh battery run.
2. A dirty working tree (`git status --porcelain` must be empty — the frozen digest must be reproducible at the recorded SHA; build outputs are gitignored and do not count).
3. A resolved `PAYSWAP_ENV=production` context: the tool records and verifies evidence only; production deployment binding is FUTURE-WORK and the `production_gate` contract stays authoritative.
4. A duplicate record for the same exact revision (records are append-only — promote a new revision).
5. A missing or unparsable records file.

### 3.2 `migration-audit` (written by `promote.mjs migrate <record-id>`)

The migration gate evidence: the source (a **throwaway copy** of the durable database — or a fresh throwaway file when no database exists yet), the migrations directory, the applied set (migration name + sha256 content checksum per row of `schema_migrations`), the verification verdict, and the invariant `real_database_mutated: false`.

### 3.3 `build-evidence` (written by `scripts/package_snapshot.mjs <record-id>`)

The reproducible build/package evidence (§6): the normalized `build_output_digest` over the runtime package, the `image_context_digest` over the docker build context, file counts, and the exact normalization description.

The records file starts EMPTY at the DEP-006 implementation commit (append-only records can only trail the revision they freeze); `scripts/validate_deployment.py` enforces per-record validity whenever entries exist.

## 4. The migration gate

`node scripts/promote.mjs migrate <record-id>`:

1. Locates the durable database (`PAYSWAP_DURABLE_DB` or the default `var/durable.sqlite`). If it exists, the tool **copies it to a throwaway temp file** — the real database is never opened for write; if it does not exist, a fresh throwaway file represents the fresh-deploy case.
2. Invokes the repository's own migration runner — `runMigrations` from `src/lib/durable/db.ts`, imported as a black box (lexical filename order, per-migration transaction, `schema_migrations` with sha256 content checksums).
3. Verifies, independently of the runner, that the `schema_migrations` applied set and checksums match the migration files on disk **exactly and completely**.
4. Appends the `migration-audit` entry to the record's audit trail.

The real database is migrated by the **deploy step**, never by the promotion tool. The tool refuses a production context (§3.1 rule 3).

## 5. The rollback-plan contract

`node scripts/promote.mjs rollback-plan <record-id>` **EMITS** a rollback plan as JSON on stdout; it performs no external effects, touches no real database, and never asserts or reverses finality. The plan honors `spec/deployment/topology.md` principles R1–R5:

- **R1** — the plan's step 1 redeploys the **previous record's artifact revision** (the last `promotion-record` appended before the given one in the append-only chain). For the first record in the chain the plan refuses to invent a target (`rollback_target: null`, `executable: false`) — the operator must supply the last known-good revision from the deployment history outside the record chain (fail-closed).
- **R2** — in-flight commands replay from the durable command queue; idempotent consumers make replay safe; stateful components recover by point-in-time recovery plus replay.
- **R3** — finality is NEVER reversed; post-finality corrections flow only through protocol-governed recourse; the plan restores infrastructure, not financial outcomes.
- **R4** — evidence is append-only; restore-from-backup preserves history.
- **R5** — replay flows through the protocol gateway and the transition runtime; rollback never bypasses protocol authorization and never hand-edits authoritative state.

**External-effect safety (the plan's hard rules):**

- The plan may re-drive ONLY **idempotent, explicitly-retryable pre-effect submissions**, re-driven with the SAME rail idempotency keys (INV-13-3 retransmission identity — recorded receipts prevent a second effect).
- **UNKNOWN is never retried** (the DEP-005 rail retry contract): UNKNOWN outcomes are never translated and never retransmitted; they are held for the A14 Reconciliation Authority path (GC-2, the only exit from UNKNOWN).
- **Post-effect cases** (delivered submissions, finalized records, UNKNOWN-at-rollback) are **listed with their recourse routing, not executed** — `post_effect_cases[].execution === "listed-not-executed"`.

Per-component rollback contracts are copied from `deploy/contracts/components.json` (the registry is the single source of truth — the plan never invents component behavior).

## 6. Reproducible build/package evidence

`node scripts/package_snapshot.mjs <record-id>` runs a FRESH `bun run build` and records two digests as a `build-evidence` entry:

1. **`build_output_digest`** — content digest over the runtime package (`.next/standalone/` per packaging.md §1), with the **per-build identity tokens** normalized to fixed placeholders. Next.js injects random per-build identity material that is not source-derived; normalizing exactly these classes makes the digest a function of the tree alone:
   - `BUILD_ID` (including its woven occurrences in manifests, asset URLs and the prerendered pages' identity comment `<!DOCTYPE html><!--TOKEN-->`),
   - the RSC `"b"` build identity token,
   - `previewModeId` / `previewModeSigningKey` / `previewModeEncryptionKey` (per-build preview-mode crypto material),
   - the server-reference-manifest `encryptionKey`.

   **Reproducible-build contract:** same tree digest → same normalized build digest across two fresh runs in the same environment. Run the script twice and compare the digests.

2. **`image_context_digest`** — sha256 of the Dockerfile plus one `"<path> <sha256>"` line per **docker build context file**: every git-tracked file that passes the repository `.dockerignore` filter (the filter implements the pattern syntax present in this repository — comments, plain names, anchored paths, `*`/`?` globs, directory prefixes; negation patterns are refused fail-closed).

## 7. Record verification

`node scripts/promote.mjs verify <record-id>` re-checks a record end-to-end:

1. The recorded gate table must itself be all-passing (a record with failed gates cannot be verified).
2. Creates a **temporary git worktree** at the recorded commit SHA (the recorded revision must exist in the local history — CI uses `fetch-depth: 0`).
3. Installs the locked dependency graph there (`bun install --frozen-lockfile`).
4. Recomputes the tree digest and the content digest over that checkout and compares against the record.
5. Re-runs the full gate battery in the worktree.
6. Compares the re-run gate table against the recorded one: **byte-identical for deterministic gates, wall times exempt, and the `build` gate's stdout digest exempt** (its stdout embeds tool timing lines; artifact determinism is proven by the package-snapshot digests). Every other field — gate names, commands, exit codes, pass flags, per-harness entries and their stdout digests — must match exactly.
7. Cleans up the worktree; exits non-zero on any mismatch (fail-closed).

## 8. CI workflows

- **`.github/workflows/ci.yml`** — on push/PR to `main`: checkout, `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, then `node scripts/run_ci_gates.mjs`. Nothing else: the workflow defines NO gates of its own.
- **`.github/workflows/promotion.yml`** — `workflow_dispatch` accepting a promotion record id (passed through the environment, not interpolated into the shell): checkout with full history, setup bun, frozen install, then `node scripts/promote.mjs verify "$PAYSWAP_PROMOTION_RECORD_ID"`. This is promotion EVIDENCE in CI — still no production binding.

Both workflows reference only repo-local gate scripts; `scripts/validate_deployment.py` machine-checks this (workflow files exist; every repository script they reference exists on disk; no `run:` step fetches or executes remote code).

## 9. Evidence requirements

A complete DEP-006 delivery captures, with exact command lines and outputs:

1. a full successful CI battery (the gate table),
2. the double-build reproducibility digests (two fresh `package_snapshot.mjs` runs — identical digests),
3. a migration-gate run on a throwaway copy (applied set + checksum verification),
4. a promotion `record` + `verify` cycle,
5. a `rollback-plan` emission for the record.

The DEP-006 rehearsal evidence lives in `deploy/promotions/DEP-006-REHEARSAL.md`; the machine-readable trail lives in `deploy/promotions/promotion-records.jsonl`. The sandbox (or CI) run itself is the proof that the gates are repo-local.

## 10. Verification (machine contract)

`python3 scripts/validate_deployment.py` (from the repository root) validates this contract as its DEP-006 section: the workflow files exist and reference only repo-local gate scripts; the CI/CD toolchain files exist on disk; the `ci_cd` contract object in `deploy/contracts/components.json` agrees with the tree; `deploy/promotions/` is present and `promotion-records.jsonl` exists with every record carrying all gates passing and a content digest (migration-audit and build-evidence entries reference existing records and carry their digests); `spec/deployment/topology.md` records the DEP-006 governed contract change; `spec/deployment/configuration.md` references this document; the S1 secret-boundary scan covers the new surfaces.

## 11. Future work (FUTURE-WORK)

| Item | Status |
|------|--------|
| production deployment binding (deploying a verified record to the production environment under the separately authorized production configuration) | FUTURE-WORK (DEP-002+; the `production_gate` contract in components.json stays authoritative) |
| artifact/image publishing to a registry with digest pinning | FUTURE-WORK |
| external secret-store binding for CI (none needed today — the battery is hermetic and needs no credentials) | FUTURE-WORK |
| merge/push automation (the Tech Lead verifies, pushes and merges; workers never push) | FUTURE-WORK (governance model) |

None of these may be pre-filled: each arrives with its own governed work item.
