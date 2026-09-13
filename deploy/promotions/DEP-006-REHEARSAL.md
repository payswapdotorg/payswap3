# DEP-006 — Rehearsal evidence: CI/CD and promotion

Work order: `spec/system-work-orders/DEP-006.md` — "CI/CD and promotion".
Contract: `spec/deployment/ci-cd.md` (the CI/CD and promotion contract).
This document records the REQUIRED EVIDENCE with the exact command lines
and outputs captured in the DEP-006 execution sandbox (the worker sandbox —
the same environment a fresh clone runs the gates in; no CI-only gate
exists).

- Dispatch base: `main @ 663b1d4c4e3f1e4b9ebdd2b2758520cb5d8067ed` (verified
  with `git rev-parse 663b1d4c4e3f1e4b9ebdd2b2758520cb5d8067ed^{commit}` —
  exact match).
- Branch: `dep-006/ci-cd-promotion`.
- Toolchain: Node `v24.19.0`, bun `1.3.14`, Python `3.12.14`.
- Rehearsal records (append-only store
  `deploy/promotions/promotion-records.jsonl`):
  - **R1** `pr-1789270523172-76af45c723` — the implementation commit
    `e30d42240dfb6dbce8ab08873d76512bfb2b1c46`
    (`DEP-006: CI/CD and promotion (gate runner, promotion tool, workflows,
    contract update)`), tree digest `575bb723dac50cf5793445f59ae0c2ae40ea7d23`,
    content digest `76af45c723226e2e757c154172e7a9b7e42343a7e2fcaf226aa7377a67b8133b`
    (728 tracked files).
  - **R2** `pr-1789270693798-62fe257271` — the first evidence commit
    `ba7bddcdbddd9e1d97e41fce3fd555afe3a07b0d`, tree digest
    `47f9e9ee9f18c7f0613331fecd4415507fce20c6`, content digest
    `62fe257271e7da3fd843e0a76bca162645fe9213fda3fc03c7f4d4233781eb0d`.

## (a) Successful CI battery — the gate table

Command (R1):

```bash
node scripts/promote.mjs record
```

The `record` subcommand runs a FRESH `node scripts/run_ci_gates.mjs` and
appends the gate table to the promotion record. The identical table is
produced by running the runner directly:

```bash
node scripts/run_ci_gates.mjs
```

Gate table (R1's recorded run — every gate, exit code, wall time; stdout
digests are computed with the checkout path normalized to `<REPO>`):

```json
{"type":"gate","gate":"governance","command":"python3 scripts/validate_governance.py","exit":0,"passed":true,"wall_ms":30,"stdout_sha256":"8f0d4aea6d425789ae1a3ed9a7406dd7349f24060f7cd0c7bc4e95b5364767b26"}
{"type":"gate","gate":"deployment-contract","command":"python3 scripts/validate_deployment.py","exit":0,"passed":true,"wall_ms":52,"stdout_sha256":"f8ad68c39056fa3d245d6d97f7b3cf8c1128dbf860a9930c99945fd253599bf4"}
{"type":"gate","gate":"durable-contract","command":"python3 scripts/validate_durable.py","exit":0,"passed":true,"wall_ms":35,"stdout_sha256":"02dbe2d287735184d6b2954fb25381126fe7fea2573d84618bea0307d3b5e93e7"}
{"type":"gate","gate":"typecheck","command":"bun run typecheck","exit":0,"passed":true,"wall_ms":2559,"stdout_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
{"type":"gate","gate":"harnesses","command":"node scripts/test_*.mjs (15 files, glob)","exit":0,"passed":true,"wall_ms":6651,"stdout_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","harnesses":[{"file":"scripts/test_durable.mjs","exit":0,"stdout_sha256":"36de9c399654fd78d1335b829ed5c4e7ed2e01fc38d0bfe01ab66532d100c269"},{"file":"scripts/test_operations.mjs","exit":0,"stdout_sha256":"520349f8d58a873178a54a5e02c956546973852d3f3a455a0e8824990ce69f38"},{"file":"scripts/test_protocol_authorities.mjs","exit":0,"stdout_sha256":"f06b0c9a61323258d33dfe6f5b36e05fe39b13ac20bd018ebcddfe5749e61b1d"},{"file":"scripts/test_protocol_clearing_obligations.mjs","exit":0,"stdout_sha256":"1fe991636a3cb4ffc77a9fc678960027fae1c6406018672e6c104f8ec2d497b8"},{"file":"scripts/test_protocol_composed_journey.mjs","exit":0,"stdout_sha256":"d5b0357d4b964ef9d93aacaf1724348908525103709cc9b95c15cdb870acfb9b"},{"file":"scripts/test_protocol_evidence.mjs","exit":0,"stdout_sha256":"f236eed17a23d212f6af8439145cccef606b6ad549f97688c6969d07afd49834"},{"file":"scripts/test_protocol_gateway.mjs","exit":0,"stdout_sha256":"7dd3c8366af5f43a6977457f372b1273941e7ec7cf51ccdf2a16000aef2b79bf"},{"file":"scripts/test_protocol_kernel.mjs","exit":0,"stdout_sha256":"0603471c54a731545a97b7ed34989765a1e3739e4ff53f41d632ddc28a5f2cee"},{"file":"scripts/test_protocol_liquidity_credit_queues.mjs","exit":0,"stdout_sha256":"bf3ff19b8e83df1dee0c46f1812969b8fb8e08665b2cb46235776d11de55cc7e"},{"file":"scripts/test_protocol_netting_settlement.mjs","exit":0,"stdout_sha256":"41b0115df73d7bce77c443e69ac6ebb975103059659f1ecae89795ec4342d7e8"},{"file":"scripts/test_protocol_rails.mjs","exit":0,"stdout_sha256":"2bbf51281e4d030e0a94ecae2f96d42bea77fb45df3544635e774cb666d4f88e"},{"file":"scripts/test_protocol_routing_reservations.mjs","exit":0,"stdout_sha256":"2f1f4888383a7e09ad60a80543757a67aa5e0f4680d45d432633126662d887bb"},{"file":"scripts/test_protocol_transition_hosting.mjs","exit":0,"stdout_sha256":"7508e3536c067826b579ce3c66d9d032c7db29476a3f3d741745918f7f704d30"},{"file":"scripts/test_rail_connectivity.mjs","exit":0,"stdout_sha256":"5fdd132f13d4a1be2505e9db42c8d93c489445d5645c1d8a241ffcf92e54432a"},{"file":"scripts/test_risk_authority.mjs","exit":0,"stdout_sha256":"9ddc6651ea44fd53a22b351c5d6b30567cd360cce5dfe5e5fbfa47428913e302"}]}
{"type":"gate","gate":"build","command":"bun run build","exit":0,"passed":true,"wall_ms":29304,"stdout_sha256":"ad8d50aa11d7d06e92a35e24af72d2dfff22e8025fb018c94f8331f391526d5e"}
{"type":"verdict","passed":true,"gates_total":6,"gates_failed":0,"runner":"scripts/run_ci_gates.mjs"}
```

Validator outputs at the recorded revision (direct invocations):

- `python3 scripts/validate_governance.py` →
  `RESULT: PASS — 17 authority paths validated (17 present, 0 sibling-wave pending), 0 errors`
- `python3 scripts/validate_deployment.py` →
  `DEP-001/DEP-002/RTN-012/DEP-004/DEP-005/DEP-006 deployment contract validation … result: PASS`
  (865 checks at the empty-records bootstrap; more once records exist — every
  record re-validated)
- `python3 scripts/validate_durable.py` →
  `validate_durable: 69 check(s) passed, 0 failed`
- `bun run typecheck` → exit 0 (0 errors)

## (b) Reproducible build/package — the double-build digests

Command (run TWICE, each a FRESH `bun run build`):

```bash
node scripts/package_snapshot.mjs pr-1789270523172-76af45c723
```

Run 1 (`bld-1789270256093-…`):

```json
{"ok":true,"action":"package-snapshot","record_id":"pr-1789270523172-76af45c723","build_output_digest":"ade4906782b59781e3f76bcf839a0807a7944da291837c630f7b19c0b51c8042","build_output_files":1922,"build_output_normalized_files":64,"image_context_digest":"82b5660782574303fff407c4b623cebc28e222ce1afcaf2903ab54cf852fdd10","image_context_files":567,"appended_to":"deploy/promotions/promotion-records.jsonl"}
```

Run 2 (`bld-1789270292658-…`):

```json
{"ok":true,"action":"package-snapshot","record_id":"pr-1789270523172-76af45c723","build_output_digest":"ade4906782b59781e3f76bcf839a0807a7944da291837c630f7b19c0b51c8042","build_output_files":1922,"build_output_normalized_files":64,"image_context_digest":"82b5660782574303fff407c4b623cebc28e222ce1afcaf2903ab54cf852fdd10","image_context_files":567,"appended_to":"deploy/promotions/promotion-records.jsonl"}
```

**Digests identical across the two fresh runs** — the reproducible-build
contract holds: same tree digest → same normalized build digest.

- `build_output_digest` = content digest over `.next/standalone` (the
  runtime package: 1922 files) with the per-build identity tokens normalized
  (64 files contained identity material: BUILD_ID incl. its woven
  occurrences, the prerender identity comment token + RSC `"b"` build token,
  the previewMode keys, the server-reference-manifest encryptionKey — none
  source-derived).
- `image_context_digest` = Dockerfile sha256 + one `"<path> <sha256>"` line
  per git-tracked file passing the repository `.dockerignore` filter (567
  context files).

A three-build determinism study in the same sandbox (before recording)
produced the identical `build_output_digest`
(`ade4906782b59781e3f76bcf839a0807a7944da291837c630f7b19c0b51c8042`) on every
run, isolating exactly the four identity-token classes above as the only
per-build variation in the output.

## (c) Migration gate — on a throwaway copy

### (c1) Fresh-deploy case (no durable database present)

```bash
node scripts/promote.mjs migrate pr-1789270523172-76af45c723
```

```json
{"ok":true,"action":"migrate","record_id":"pr-1789270523172-76af45c723","source":"fresh-throwaway (no durable database present at record time)","applied":["0001_durable_execution.sql"],"verified":true,"real_database_mutated":false,"appended_to":"deploy/promotions/promotion-records.jsonl"}
```

stderr: `no durable database present … the migration gate runs on a fresh
throwaway file (the fresh-deploy case)` / `migration gate VERIFIED — applied
set matches disk exactly (1 migration(s); applied by this run: 1)`.

### (c2) Copy-of case (a real durable database present)

The real database stand-in was bootstrapped with the repository's own
runner (`openDurableDatabase` — exactly what the application does at
startup), then digested before and after the gate:

```
sha256 BEFORE: d94499ae954a859228c4d18ccdf1c0b64d95f7084af79732e1e62ad99ef4de6a
sha256 AFTER:  d94499ae954a859228c4d18ccdf1c0b64d95f7084af79732e1e62ad99ef4de6a
```

```json
{"ok":true,"action":"migrate","record_id":"pr-1789270523172-76af45c723","source":"copy-of:var/durable.sqlite","applied":["0001_durable_execution.sql"],"verified":true,"real_database_mutated":false,"appended_to":"deploy/promotions/promotion-records.jsonl"}
```

stderr: `migration gate VERIFIED — applied set matches disk exactly (1
migration(s); applied by this run: 0)` (the no-op re-run path: the copy was
already migrated; the runner's immutability verification re-checked the
sha256 checksums).

**The real database's sha256 is identical before and after the gate — the
migration gate never opened it for write.** The applied set
(`0001_durable_execution.sql` with sha256 content checksum
`6515f9a7cc38fa15c93118779214ae1ebc1741a5dc70ca713e4077c88da76c60`, recorded
in the `migration-audit` entry) matches the migration files on disk exactly
(`sha256sum deploy/migrations/0001_durable_execution.sql` → the same digest).

## (d) Promotion `record` + `verify` cycle

`record` outputs (stdout, machine-parseable):

- R1: `{"ok":true,"action":"record","record_id":"pr-1789270523172-76af45c723","commit_sha":"e30d42240dfb6dbce8ab08873d76512bfb2b1c46","tree_digest":"575bb723dac50cf5793445f59ae0c2ae40ea7d23","content_digest":"76af45c723226e2e757c154172e7a9b7e42343a7e2fcaf226aa7377a67b8133b","gates":"governance:pass deployment-contract:pass durable-contract:pass typecheck:pass harnesses:pass build:pass","appended_to":"deploy/promotions/promotion-records.jsonl"}`
- R2: `{"ok":true,"action":"record","record_id":"pr-1789270693798-62fe257271","commit_sha":"ba7bddcdbddd9e1d97e41fce3fd555afe3a07b0d","tree_digest":"47f9e9ee9f18c7f0613331fecd4415507fce20c6","content_digest":"62fe257271e7da3fd843e0a76bca162645fe9213fda3fc03c7f4d4233781eb0d","gates":"governance:pass deployment-contract:pass durable-contract:pass typecheck:pass harnesses:pass build:pass","appended_to":"deploy/promotions/promotion-records.jsonl"}`

`verify` (temp git worktree at the recorded SHA, `bun install
--frozen-lockfile`, digests recomputed, full battery re-run, gate tables
compared byte-identically modulo wall times and the build stdout digest):

```bash
node scripts/promote.mjs verify pr-1789270523172-76af45c723
```

```json
{"ok":true,"action":"verify","record_id":"pr-1789270523172-76af45c723","commit_sha":"e30d42240dfb6dbce8ab08873d76512bfb2b1c46","tree_digest":"575bb723dac50cf5793445f59ae0c2ae40ea7d23","content_digest_recomputed":"76af45c723226e2e757c154172e7a9b7e42343a7e2fcaf226aa7377a67b8133b","content_digest_matches":true,"gates_rerun":[{"gate":"governance","exit":0,"passed":true},{"gate":"deployment-contract","exit":0,"passed":true},{"gate":"durable-contract","exit":0,"passed":true},{"gate":"typecheck","exit":0,"passed":true},{"gate":"harnesses","exit":0,"passed":true},{"gate":"build","exit":0,"passed":true}],"gate_table_matches":true,"problems":[]}
```

```bash
node scripts/promote.mjs verify pr-1789270693798-62fe257271
```

```json
{"ok":true,"action":"verify","record_id":"pr-1789270693798-62fe257271","commit_sha":"ba7bddcdbddd9e1d97e41fce3fd555afe3a07b0d","tree_digest":"47f9e9ee9f18c7f0613331fecd4415507fce20c6","content_digest_recomputed":"62fe257271e7da3fd843e0a76bca162645fe9213fda3fc03c7f4d4233781eb0d","content_digest_matches":true,"gates_rerun":[{"gate":"governance","exit":0,"passed":true},{"gate":"deployment-contract","exit":0,"passed":true},{"gate":"durable-contract","exit":0,"passed":true},{"gate":"typecheck","exit":0,"passed":true},{"gate":"harnesses","exit":0,"passed":true},{"gate":"build","exit":0,"passed":true}],"gate_table_matches":true,"problems":[]}
```

Both verifications PASS: content digests recomputed at the recorded SHAs
match, the full battery is green in the temp worktrees, and the gate tables
are byte-identical to the recorded ones.

## (e) Rollback-plan emission

Two emissions were captured. For R1 (the FIRST record in the chain — the
honest no-previous case):

```bash
node scripts/promote.mjs rollback-plan pr-1789270523172-76af45c723
```

```json
{
  "rollback_target": null,
  "rollback_target_status": "absent — this is the FIRST promotion record in the chain; the plan refuses to invent a target: the operator must supply the last known-good artifact revision from the deployment history outside this record chain (fail-closed)",
  "executable": false,
  …steps R1–R5, external-effect safety, per-component contracts…
}
```

For R2 (the previous-target case — THE rehearsal):

```bash
node scripts/promote.mjs rollback-plan pr-1789270693798-62fe257271
```

Key sections of the emitted plan (complete JSON on stdout, 174 lines):

- `rollback_target` = R1's revision exactly:
  `{"record_id":"pr-1789270523172-76af45c723","commit_sha":"e30d42240dfb6dbce8ab08873d76512bfb2b1c46","commit_subject":"DEP-006: CI/CD and promotion (gate runner, promotion tool, workflows, contract update)","tree_digest":"575bb723dac50cf5793445f59ae0c2ae40ea7d23","content_digest":"76af45c723226e2e757c154172e7a9b7e42343a7e2fcaf226aa7377a67b8133b"}`,
  `executable: true`.
- `steps` (in order): `redeploy-previous-artifact` (R1 — redeploy R1's
  recorded revision; the build is reproduced from the recorded tree digest
  per the record's build-evidence), `durable-command-replay` (R2 — in-flight
  commands replay from the durable command queue with the SAME deterministic
  idempotency keys; recorded receipts, never a second effect),
  `stateful-point-in-time-recovery` (R2+R4 — authoritative state by
  point-in-time recovery plus replay; evidence restored append-only),
  `finality-protection` (R3 — finality NEVER reversed; corrections only
  through protocol-governed recourse),
  `external-effect-safety` (R5+R3 — only idempotent, explicitly-retryable
  pre-effect submissions re-driven with the same rail idempotency keys;
  UNKNOWN never retried), `authorization-boundary` (R5 — replay through the
  protocol gateway and the transition runtime only).
- `external_effect_safety`: `"unknown_never_retried": true`;
  `"unknown_handling": "UNKNOWN outcomes are never retried, never
  translated to success or failure — they are held for the A14
  reconciliation path (GC-2: the only exit from UNKNOWN)"`; three
  post-effect cases LISTED with recourse routing and
  `"execution": "listed-not-executed — this tool performs no external
  effects"`:
  1. settlement attempt already delivered-with-report before rollback →
     protocol-governed recourse — listed, NOT executed;
  2. finalized settlement records → finality never reversed (R3) — listed,
     NOT executed;
  3. rail submission with UNKNOWN outcome at rollback time → NEVER retried,
     routed to the A14 Reconciliation Authority path (GC-2) — listed, NOT
     executed.
- `per_component`: the rollback contracts of all 11 components, copied from
  `deploy/contracts/components.json` (the registry is the single source of
  truth — the plan invents nothing).
- `tool_boundary`: "this tool PLANS rollback; it does not perform external
  effects, does not reverse finality, does not mutate authoritative state,
  and does not touch any real database".

## Fail-closed refusals exercised (negative evidence)

| Command | Result |
|---|---|
| `node scripts/promote.mjs` (no subcommand) | exit 1 — usage error (fail-closed: no default action) |
| `node scripts/promote.mjs migrate` (no record id) | exit 1 — a record id is required |
| `node scripts/promote.mjs verify pr-0000-deadbeef` (unknown id) | exit 1 — record not found |
| `node scripts/promote.mjs record` (dirty working tree) | exit 1 — "a promotion record must freeze a committed, clean revision" |
| `node scripts/package_snapshot.mjs` (no record id) | exit 1 — a record id is required |

The dirty-tree refusal is the guard that makes `verify` sound: the frozen
content digest is always recomputable at the recorded SHA.
