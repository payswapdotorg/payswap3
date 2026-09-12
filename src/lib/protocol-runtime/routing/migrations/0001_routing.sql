-- payswap3 · RTN-006 · routing migration 0001 — Routing Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/routing/migrations/) is the routing
-- domain's migration set, following the kernel's template
-- (src/lib/protocol-runtime/kernel/migrations/0001_kernel.sql).
--
-- Conventions (inherited from the substrate runner, src/lib/durable/db.ts
-- · deploy/migrations/0001_durable_execution.sql):
-- * applied by the DEP-003 migration runner in ascending filename order,
--   each migration inside its own transaction, applied set recorded in
--   schema_migrations (owned by the runner, not by this file);
-- * ordered, immutable once delivered (sha256 content checksum);
-- * all timestamps are epoch milliseconds (INTEGER) paired with their
--   sequenced protocol-time position (INTEGER).
--
-- RoutePlan rows (core.md §4 Area 4 lines 221-225: "RoutePlan — compiled
-- plan: ordered hops, each hop naming a capability (rail id, corridor), an
-- amount (Money), and expected settlement semantics. States: COMPILED ->
-- VALIDATED -> DISPATCHED -> terminal(COMPLETED | FAILED | ABANDONED).").
-- plan_id is the derived compilation key of INV-4-3 (intent id, compiler
-- version, snapshot id) — the UNIQUE (intent_id, compiler_version,
-- snapshot_id) makes the compilation-key contract structural at the
-- storage layer. hops is the canonical JSON of the frozen hop array; the
-- value ledger (explicit conversions + explicit fees, INV-4-1) is the
-- canonical JSON of RouteValueLedger; the UNKNOWN-hop halt annotations and
-- the dispatch-acquired reservation references ride as canonical JSON.
CREATE TABLE route_plans (
  plan_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  compiler_version INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('COMPILED', 'VALIDATED', 'DISPATCHED', 'COMPLETED', 'FAILED', 'ABANDONED')),
  hops TEXT NOT NULL,
  value_ledger TEXT NOT NULL,
  deadline_epoch_ms INTEGER NOT NULL,
  reservation_refs TEXT NOT NULL,
  unknown_hops TEXT NOT NULL,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  UNIQUE (intent_id, compiler_version, snapshot_id)
);
CREATE INDEX route_plans_by_intent
  ON route_plans(intent_id);

-- RouteDemandSignal rows (core.md §4 Area 4 lines 253-254: "NO_VIABLE_ROUTE
-- is a terminal failure that also emits a demand signal for area 24.").
-- signal_id is derived from the same compilation key, so the UNIQUE
-- (intent_id, compiler_version, snapshot_id) makes the exactly-one-signal-
-- per-compilation-key contract structural. emission_record_id records the
-- emission point (the derived id of the ROUTE_FAILED evidence record that
-- carries the NO_VIABLE_ROUTE outcome).
CREATE TABLE route_demand_signals (
  signal_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  compiler_version INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  requested_corridor TEXT NOT NULL,
  amount TEXT NOT NULL,
  emission_record_id TEXT NOT NULL,
  emitted_seq INTEGER NOT NULL CHECK (emitted_seq >= 0),
  emitted_wall_ms INTEGER NOT NULL,
  UNIQUE (intent_id, compiler_version, snapshot_id)
);
