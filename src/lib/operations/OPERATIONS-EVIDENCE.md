# DEP-004 — Operational evidence: the durable operational-jobs layer

Work order: `spec/system-work-orders/DEP-004.md` — "Run durable
operational processes for reconciliation, clearing, netting and
settlement support through existing protocol authorities."

This document is the operational-jobs family's evidence surface (alongside
the family barrel `src/lib/operations/index.ts` and the evidence harness
`scripts/test_operations.mjs`). It records WHAT the jobs do, the
disciplines that make them safe, and the honest boundaries — including
one recorded execution gap inherited from the composed runtime's filed
defect D-2.

- Base: main @ 2c3f9cf0efb7bae808662d4dd1adaf604d69de0e (the composed
  protocol runtime: RTN-001..012 merged — the wave barrel
  `src/lib/protocol-runtime/index.ts` documents the composed surface).
- Form: in-process first (the DEP-001/002/003/RTN-012 precedent) — the
  jobs run as/over the DEP-003 durable substrate
  (`src/lib/durable/`: db, queue, worker, scheduler, events — read-only
  integration: import + the documented public API). Externalized process
  binding is recorded FUTURE-WORK in the deployment contract trio
  (updated together in this work item: `deploy/contracts/components.json`
  + `spec/deployment/topology.md` + `scripts/validate_deployment.py`).
- Harness: `scripts/test_operations.mjs` (plain Node ≥ 22.6, node:sqlite
  + type stripping; exit 0 = all scenarios green).

## The job family (the four recurring operational duties)

| Duty (the topology's worker duties) | Job kind | Command kinds emitted (COMMAND-SURFACE.md) | Executes in the composed runtime? |
|---|---|---|---|
| Reconciliation sweeps (A14) | `operations.reconciliation-sweep` | `reconciliation.source.register`; `reconciliation.cycle.open` / `.statements.collect` / `.matching.run` / `.close`; `reconciliation.case.investigate` | source.register + cycle.close: YES; cycle.open / statements.collect / matching.run / case.investigate: admitted, queued (D-2 — below) |
| Clearing batch progression (A09) | `operations.clearing-progression` | `clearing.batch.open` / `.stage` / `.commit` / `.finalize` | YES (all four) |
| Netting-settlement progression (A11+A12) | `operations.netting-settlement-progression` | `netting.set.open` / `.compute` / `.commit`; `settlement.instruction.create` / `.attempt.authorize` / `.attempt.submit` | YES (all six) |
| Queue-draining support (A08) | `operations.queue-drain-support` | `queues.queue.create` / `.queue.drain.start` / `.eligibility.evaluate` / `.items.due.expire` | create + evaluate: YES; drain.start + items.due.expire: admitted, queued (D-2 — below) |

Every command goes through **the one admission point**
(`ProtocolGateway.submitCommand`, a kernel `CommandEnvelope`). The jobs
hold no authority reference, no enqueue path for protocol commands, and
no state-write capability: the job runtime's ports are exactly
`gateway.submitCommand`, the authorities' public reads
(`OperationalReadSurface` — a structural projection), and the substrate
audit port (`recordEvent`). The single authoritative-state writer remains
the transition runtime.

## The disciplines (mapped to the work order's acceptance criteria)

1. **Jobs consume only authoritative protocol state.** Every work
   derivation reads the authorities' public read surfaces (batch/set/
   instruction/attempt/case/queue reads; the obligation projection; the
   INV-11-2 membership claims). External inputs (the reconciliation
   statement feed) enter only through a configured provider port — job
   INPUT, clearly separated from authoritative state, and only ever
   handed to the A14 command surface (external statements are untrusted
   input by contract).

2. **Duplicate execution is harmless or prevented.** Two levels:
   the job TRIGGER is deduplicated by the DEP-003 queue
   (`UNIQUE (idempotency_key, kind)`; re-triggering the same cycle is
   `job_enqueue_deduped`); the job's COMMANDS carry deterministic keys
   per (job, cycle, subject) — `deriveIdempotencyKey('command',
   commandKind, jobKind, cycle, subject)` — so a re-execution
   re-submits the same key and the gateway returns the RECORDED receipt
   verbatim (admission-level dedupe: `DUPLICATE`, never a second effect),
   and the authorities' own guards (typed rejections) backstop any
   interleaving. The harness proves both levels.

3. **UNKNOWN external outcomes trigger reconciliation rather than blind
   retry.** The discipline is split exactly as the composed runtime
   owns it: the INV-14-1 auto-case opens protocol-automatically when a
   rail operation lands UNKNOWN (the protocol's own reconciliation
   engagement — no job action involved); the settlement-support job
   records an UNKNOWN-held audit observation and submits NOTHING for the
   held subject (never a retry — and the authorities' refusals
   `LIVE_ATTEMPT_EXISTS` / `UNKNOWN_HELD` structurally enforce it); the
   reconciliation-sweep job owns the A14 trigger — it submits
   `reconciliation.case.investigate` for every OPEN case plus the window
   cycle path (`reconciliation.cycle.open` → `.statements.collect` →
   `.matching.run` → `.close` per the cycle's state). The job NEVER
   resolves a case (the terminal resolution states the true outcome and
   requires external proof — an authority/operator judgment) and NEVER
   re-submits the held attempt. The composed UNKNOWN-confirmed journey
   (`INTEGRATION-EVIDENCE.md`) is the oracle; the harness re-runs it
   through the jobs layer's boundary.

4. **Clearing/netting jobs are restart-safe and auditable.** A job run
   is a pure function of (the deterministic payload, the authoritative
   state at run time): after a crash, the substrate's at-least-once
   redelivery (lease expiry → reclaim → redeliver) re-executes the
   handler, which re-derives the pending work and re-submits with the
   SAME keys (recorded receipts, no second effect). The audit trail is
   threefold: the jobs' own durable_events journal (owner
   `operational-jobs`), the gateway's admission receipts, and the A15
   chain itself (every EXECUTED job command produces the owning
   authority's records; every admission refusal produces a
   `GATEWAY_COMMAND_REJECTED` record on the real A15 log). The
   job-progress reader (`readOperationalJobProgress`) joins the journal
   with the transition runtime's `protocol.command.executed`
   observations by durable command job id — the audit question
   "admitted → executed (applied/replayed/rejected) or still queued?"
   is answered per command, reads only.

5. **Settlement-support work never asserts finality itself.** The
   settlement-support phase submits exactly
   `settlement.instruction.create`, `settlement.attempt.authorize` and
   `settlement.attempt.submit` — progression per the A12 state machine.
   `settlement.finality.declare` is the Settlement Authority's own
   command, admitted like any other — NEVER the job's: the harness
   asserts the job's journal contains no finality command, and shows
   finality advancing through the AUTHORITY (the PROVISIONAL mirror on
   the confirmed attempt, and the authority's own declaration — the
   composed-journey precedent), never through the job. The job also
   never submits `settlement.resolution.apply` (the A14 recovery
   consumer) or `settlement.attempt.railoutcome.apply` (the report
   mirror) — those are authority-side consumers of external evidence,
   not progression.

## The honest execution gap (the filed composition defect D-2)

The composed runtime's INTEGRATION-EVIDENCE.md files a vocabulary gap
between the RTN-010 gateway registry (112 admitted kinds, the
COMMAND-SURFACE.md catalogue this work order binds the jobs to) and the
RTN-011 hosted bindings (44 kinds; several with DIFFERENT names for
overlapping surfaces). Gateway-admitted commands of un-hosted kinds are
admitted (recorded receipts, dedupe-protected) but sit QUEUED on the
durable path — the worker reserves only registered kinds. No invariant
is violated; the composed runtime simply does not execute them yet.

The operational-jobs family submits the DOCUMENTED kinds (the
submission contract is what DEP-004 owns and what the work order binds
the jobs to). Of the family's emitted kinds, these execute end-to-end
(mechanically verified by the harness — every executed kind has its
`protocol.command.executed` observation): `clearing.batch.open/stage/
commit/finalize`, `netting.set.open/compute/commit`,
`settlement.instruction.create/attempt.authorize/attempt.submit`,
`reconciliation.source.register`, `reconciliation.cycle.close` (when a
cycle reaches MATCHED), `queues.queue.create`,
`queues.eligibility.evaluate`. These are admitted-but-queued (recorded
receipts, dedupe-protected; the harness asserts the queued status
honestly) pending the recorded vocabulary-alignment follow-up:
`reconciliation.cycle.open`, `reconciliation.cycle.statements.collect`,
`reconciliation.cycle.matching.run`, `reconciliation.case.investigate`,
`queues.queue.drain.start`, `queues.items.due.expire` (the hosted
binding's kind name is `queues.items.expire` — the same class of
sibling-name divergence as the others).

The jobs' UNKNOWN→reconciliation discipline is therefore evidenced at
two levels in the harness: the protocol level (the INV-14-1 auto-case —
real, opened by the protocol itself) and the orchestration level (the
sweep's A14 submissions — recorded receipts). The A14 cycle/case
semantics themselves are already proven by the merged RTN suites and
the composed journey (the oracle); the harness additionally completes
the UNKNOWN lifecycle (and the queue-expiry sweep) through
authority-direct fixtures (the composed-journey D-2 precedent) so the
end-to-end evidence is self-contained, clearly narrated as harness
fixtures — never as job actions. **Recommended follow-up (unchanged from
INTEGRATION-EVIDENCE.md D-2): the vocabulary-alignment work item
converging the hosted bindings on the gateway's documented catalogue;
once it lands, the queued submissions begin executing with no change to
the jobs.**

## The composition (how the jobs layer composes onto the runtime)

The family barrel documents the composition order (read-only
integration over the composed runtime): the composed runtime per the
wave barrel's order → the read surface (the authorities' public reads) →
the job deps (gateway submitCommand + reads + audit + config) →
`registerOperationalJobs` (the DEP-003 register() integration point for
the four `operations.*` kinds) → `wireOperationalJobScheduler`
(scheduleRecurring per duty — the scheduler-wiring precedent: timing-
driven job-trigger emission only, commands/jobs, never state) and/or
`enqueueOperationalJob` (the on-demand trigger with the deterministic
`operations:<jobKind>:<cycle>` key) → `readOperationalJobProgress` (the
audit reader).

The web boundary keeps zero operations reach: no `src/app` route
imports this family (the topology's web boundary rules); no bun suite
imports it (the merged 1901 remain untouched); the plain-Node harness
binds the real substrate.

## Sandbox boundary (stated honestly)

The evidence demonstrates behavior under the sandbox topology
(simulated rails, no credentials, fail-closed). It is NOT production
financial execution and does not claim to be; DEP-005 remains where
real external transmission binding lands, and externalized process
binding for the jobs family is recorded FUTURE-WORK (DEP-002+) in the
deployment contract.
