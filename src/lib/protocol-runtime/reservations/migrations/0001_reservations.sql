-- payswap3 · RTN-006 · reservations migration 0001 — Reservation Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/reservations/migrations/) is the
-- reservations domain's migration set, following the kernel's template
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
-- ReservationLedgerEntry rows (core.md §5 Area 5 lines 293-295:
-- "ReservationLedger — per-resource serialized log of reservation
-- transitions. The ledger is the concurrency frontier: all resource
-- mutations pass through it in sequence order."). The log is APPEND-ONLY:
-- no UPDATE or DELETE path exists in the bridge. The UNIQUE
-- (resource_id, resource_sequence) makes INV-5-2's per-resource total
-- order structural at the storage layer; the REQUESTED rows carry the
-- recorded decision (HOLD | REJECT) the ledger-tail crash recovery
-- consumes (core.md lines 316-318: "rolled forward to HELD or rolled back
-- to RELEASED based on the recorded decision, never duplicated").
CREATE TABLE reservation_ledger_entries (
  global_sequence INTEGER NOT NULL PRIMARY KEY CHECK (global_sequence >= 0),
  resource_sequence INTEGER NOT NULL CHECK (resource_sequence >= 0),
  resource_id TEXT NOT NULL,
  reservation_id TEXT,
  intent_id TEXT,
  hop_id TEXT,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('RESOURCE_DECLARED', 'REQUESTED', 'HELD', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  amount TEXT,
  deadline_epoch_ms INTEGER,
  decision TEXT CHECK (decision IS NULL OR decision IN ('HOLD', 'REJECT')),
  reason_code TEXT,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  wall_ms INTEGER NOT NULL,
  UNIQUE (resource_id, resource_sequence)
);
CREATE INDEX reservation_ledger_entries_by_reservation
  ON reservation_ledger_entries(reservation_id);

-- Reservation rows (core.md §5 Area 5 lines 286-291: "Reservation — hold
-- on a resource ... for one intent and one hop. States: REQUESTED -> HELD
-- -> terminal(CONSUMED | RELEASED | EXPIRED)."). reservation_id is the
-- derived (intent id, hop id, resource id) identity of INV-5-3 — the
-- UNIQUE (intent_id, hop_id, resource_id) makes the derivation contract
-- structural at the storage layer. amount is canonical JSON Money in the
-- resource's unit; deadline_epoch_ms is the deterministic expiry input.
CREATE TABLE reservations (
  reservation_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  hop_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('REQUESTED', 'HELD', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  deadline_epoch_ms INTEGER NOT NULL,
  reason_code TEXT,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  UNIQUE (intent_id, hop_id, resource_id)
);

-- Resource accounting rows (core.md §5 Area 5 lines 304-306: "INV-5-1:
-- for every resource, available = declared total minus held minus
-- consumed, computed in integer Money; the identity holds after every
-- transition."). The declared total is the resource owner's integration
-- input ("Depends on areas 6, 7, and 3 as resource owners", lines
-- 335-336); held/consumed totals are denormalized Money JSON columns kept
-- in lockstep with the ledger entries (the CHECK constraints on
-- non-negativity are the storage-level backstop of INV-5-1).
CREATE TABLE reservation_resources (
  resource_id TEXT NOT NULL PRIMARY KEY,
  declared_total TEXT NOT NULL,
  held_total TEXT NOT NULL,
  consumed_total TEXT NOT NULL
);
