-- payswap3 · RTN-005 · capability migration 0001 — Capability Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/capability/migrations/) is the
-- capability domain's migration set, following the kernel's template
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
-- Capability rows (core.md §3 Area 3 lines 154-158: "Capability —
-- advertised ability: rail id, corridor (source/destination currencies
-- and geographies), capacity limits, cost schedule, tier. States:
-- REGISTERED -> ACTIVE -> DEGRADED -> RETIRED."). declaration is the
-- canonical JSON of rail id / corridor / cost schedule / tier; declared_
-- capacity is the canonical JSON Money of the INV-3-1 bound; reserved/
-- consumed totals are denormalized Money JSON columns kept in lockstep
-- with commitments (the CHECK constraint that both are non-negative is
-- the storage-level backstop of INV-3-1's non-negativity).
CREATE TABLE capabilities (
  capability_id TEXT NOT NULL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED')),
  declaration TEXT NOT NULL,
  declared_capacity TEXT NOT NULL,
  reserved_total TEXT NOT NULL,
  consumed_total TEXT NOT NULL,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL
);

-- Commitment rows (core.md §3 Area 3 lines 160-163: "Commitment — binding
-- promise of capacity for one intent. States: OFFERED -> RESERVED ->
-- CONSUMED | EXPIRED | RELEASED."). commitment_id is the derived
-- (intent id, capability id) identity of INV-3-3 — the UNIQUE
-- (intent_id, capability_id) makes the one-commitment-per-pair contract
-- structural at the storage layer. amount is canonical JSON Money in the
-- capability's capacity unit.
CREATE TABLE commitments (
  commitment_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OFFERED', 'RESERVED', 'CONSUMED', 'EXPIRED', 'RELEASED')),
  deadline_epoch_ms INTEGER NOT NULL,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  UNIQUE (intent_id, capability_id),
  FOREIGN KEY (capability_id) REFERENCES capabilities(capability_id)
);

-- CapabilitySnapshot rows (core.md §3 Area 3 lines 165-166:
-- "CapabilitySnapshot — immutable, sequenced view of all capabilities at
-- a point in protocol time"). Append-only: one row per sequence; entries
-- is the canonical JSON of the frozen entry array. INSERT-only — the
-- snapshot is immutable by construction (no UPDATE/DELETE path exists in
-- the bridge).
CREATE TABLE capability_snapshots (
  sequence INTEGER NOT NULL PRIMARY KEY CHECK (sequence >= 0),
  snapshot_id TEXT NOT NULL UNIQUE,
  wall_ms INTEGER NOT NULL,
  entries TEXT NOT NULL
);
