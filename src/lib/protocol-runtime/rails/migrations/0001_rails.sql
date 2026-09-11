-- payswap3 · RTN-004 · rails migration 0001 — Rail Adapter Authority +
-- Reconciliation Authority store (areas 13-14)
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix (here: src/lib/protocol-runtime/rails/migrations/),
-- using the DEP-003 database layer read-only. Applied by the substrate's
-- explicit migration runner (src/lib/durable/db.ts runMigrations): lexical
-- filename order, one transaction per migration, applied set recorded in
-- schema_migrations (owned by the runner).
--
-- Conventions (inherited from the substrate runner and the kernel
-- migration 0001):
-- * all timestamps are epoch milliseconds (INTEGER);
-- * all protocol-time pairs are stored as (sequence INTEGER, wall_ms
--   INTEGER) columns named <prefix>_seq / <prefix>_wall_ms;
-- * all JSON columns hold canonical serialized arrays/objects built by the
--   rails store code (deterministic construction);
-- * state machines are enforced with CHECK constraints mirroring the frozen
--   v0.1 transition tables (types.ts), so an illegal state is
--   unrepresentable even at the storage layer.
--
-- Spec source (binding): spec/architecture/v0.1/
-- rails-adapters-reconciliation.md §1 Area 13 (lines 29-48: RailAdapter,
-- RailOperation, RailResultReport) and §2 Area 14 (lines 119-141:
-- ReconciliationCase, ReconciliationCycle, ReconciliationSource);
-- rtn-plan-rulings.md Q1/delta 1 (authority state lives here, under the
-- protocol-owned store; the adapter component hosts no authority).

-- Monotonic protocol-time sequence mint for the rails domain. Every
-- authority command mints one (or more) sequence positions from this
-- counter; the pair (sequence, wall_ms) is the A15 'when' slot.
CREATE TABLE rails_sequence (
name TEXT PRIMARY KEY,
next_value INTEGER NOT NULL
);

INSERT INTO rails_sequence (name, next_value) VALUES ('protocol', 1);

-- Area 13 — RailAdapter registry (protocol-owned authoritative state).
CREATE TABLE rail_adapters (
adapter_id TEXT PRIMARY KEY,
rail_family TEXT NOT NULL,
name TEXT NOT NULL,
status TEXT NOT NULL CHECK (status IN ('REGISTERED', 'ACTIVE', 'DEGRADED', 'RETIRED')),
reason_code TEXT,
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL,
updated_seq INTEGER NOT NULL,
updated_wall_ms INTEGER NOT NULL
);

-- Area 13 — RailOperation lifecycle (protocol-owned authoritative state).
-- UNIQUE (idempotency_key): the deterministic rail idempotency key derived
-- from the instruction id (INV-13-3) is also the store-level operation
-- identity, so a duplicate authorization collapses to the recorded row.
CREATE TABLE rail_operations (
operation_id TEXT PRIMARY KEY,
instruction_id TEXT NOT NULL,
adapter_id TEXT NOT NULL REFERENCES rail_adapters (adapter_id),
status TEXT NOT NULL CHECK (status IN ('AUTHORIZED', 'SUBMITTED', 'PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
reason_code TEXT,
idempotency_key TEXT NOT NULL UNIQUE,
payload_json TEXT NOT NULL,
payload_hash TEXT NOT NULL,
rail_refs_json TEXT NOT NULL,
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL,
updated_seq INTEGER NOT NULL,
updated_wall_ms INTEGER NOT NULL
);

CREATE INDEX rail_operations_instruction_idx ON rail_operations (instruction_id);
CREATE INDEX rail_operations_status_idx ON rail_operations (status);
CREATE INDEX rail_operations_window_idx ON rail_operations (created_wall_ms);

-- Area 13 — RailResultReport: immutable, append-only report log. The
-- (operation_id, ordinal) pair totally orders reports per operation.
CREATE TABLE rail_result_reports (
report_id TEXT PRIMARY KEY,
operation_id TEXT NOT NULL REFERENCES rail_operations (operation_id),
ordinal INTEGER NOT NULL,
outcome_class TEXT NOT NULL CHECK (outcome_class IN ('CONFIRMED', 'FAILED', 'PENDING', 'UNKNOWN')),
reason_code TEXT,
rail_refs_json TEXT NOT NULL,
payload_hash TEXT NOT NULL,
reported_wall_ms INTEGER NOT NULL,
recorded_seq INTEGER NOT NULL,
recorded_wall_ms INTEGER NOT NULL,
UNIQUE (operation_id, ordinal)
);

-- Area 14 — ReconciliationCase. The partial UNIQUE index on
-- origin_operation_id is INV-14-1 at the storage layer: every UNKNOWN rail
-- operation has EXACTLY ONE case, ever ("every rail operation in UNKNOWN
-- state has exactly one open case at all times" + "automatically opens
-- exactly one case").
CREATE TABLE reconciliation_cases (
case_id TEXT PRIMARY KEY,
status TEXT NOT NULL CHECK (status IN ('OPEN', 'INVESTIGATING', 'MATCHED', 'RESOLVED_CONFIRMED', 'RESOLVED_FAILED', 'RESOLVED_ADJUSTED')),
origin_kind TEXT NOT NULL CHECK (origin_kind IN ('UNKNOWN_OPERATION', 'CYCLE_DISCREPANCY')),
origin_operation_id TEXT,
origin_cycle_id TEXT,
origin_detail_json TEXT NOT NULL,
resolution_json TEXT,
recovery_json TEXT,
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL,
updated_seq INTEGER NOT NULL,
updated_wall_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX reconciliation_cases_one_per_operation
ON reconciliation_cases (origin_operation_id)
WHERE origin_operation_id IS NOT NULL;

CREATE INDEX reconciliation_cases_status_idx ON reconciliation_cases (status);
CREATE INDEX reconciliation_cases_cycle_idx ON reconciliation_cases (origin_cycle_id);

-- Area 14 — ReconciliationCycle: window, rule version, and counters. The
-- collected statement set + protocol-record snapshot are the cycle's
-- matching INPUTS (INV-14-4 makes them part of the pure function); they are
-- snapshotted at COLLECTED so a later MATCHED decision is reproducible.
CREATE TABLE reconciliation_cycles (
cycle_id TEXT PRIMARY KEY,
status TEXT NOT NULL CHECK (status IN ('OPEN', 'COLLECTED', 'MATCHED', 'CLOSED')),
window_start_wall_ms INTEGER NOT NULL,
window_end_wall_ms INTEGER NOT NULL,
rule_version INTEGER NOT NULL,
source_ids_json TEXT NOT NULL,
statement_count INTEGER NOT NULL DEFAULT 0,
matched_count INTEGER NOT NULL DEFAULT 0,
discrepancy_count INTEGER NOT NULL DEFAULT 0,
open_case_count INTEGER NOT NULL DEFAULT 0,
statements_json TEXT NOT NULL DEFAULT '[]',
operations_snapshot_json TEXT NOT NULL DEFAULT '[]',
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL,
updated_seq INTEGER NOT NULL,
updated_wall_ms INTEGER NOT NULL
);

-- Area 14 — ReconciliationSource: untrusted statement providers with
-- per-source sequence numbers. last_sequence enforces the strictly
-- increasing consumption discipline (SEQUENCE_REGRESSION otherwise).
CREATE TABLE reconciliation_sources (
source_id TEXT PRIMARY KEY,
kind TEXT NOT NULL,
description TEXT NOT NULL,
last_sequence INTEGER NOT NULL DEFAULT 0,
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL,
updated_seq INTEGER NOT NULL,
updated_wall_ms INTEGER NOT NULL
);

-- Area 14 — ReconciliationAdjustment: NEW linked entries only (INV-14-3:
-- "adjustments create new linked obligations or ledger entries; existing
-- evidence and settled records are never rewritten"). Append-only: no
-- UPDATE path exists in the store code.
CREATE TABLE reconciliation_adjustments (
adjustment_id TEXT PRIMARY KEY,
case_id TEXT NOT NULL REFERENCES reconciliation_cases (case_id),
operation_id TEXT,
links_json TEXT NOT NULL,
description TEXT NOT NULL,
created_seq INTEGER NOT NULL,
created_wall_ms INTEGER NOT NULL
);

CREATE INDEX reconciliation_adjustments_case_idx ON reconciliation_adjustments (case_id);
