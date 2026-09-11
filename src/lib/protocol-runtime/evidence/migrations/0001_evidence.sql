-- payswap3 · RTN-002 · evidence migration 0001 — Evidence Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside its
-- owned prefix, using the DEP-003 database layer read-only. This directory
-- (src/lib/protocol-runtime/evidence/migrations/) is the evidence domain's
-- migration set, following the kernel domain's shape
-- (src/lib/protocol-runtime/kernel/migrations/).
--
-- Conventions (inherited from the substrate runner,
-- src/lib/durable/db.ts · deploy/migrations/0001_durable_execution.sql):
-- * applied by the DEP-003 migration runner in ascending filename order,
--   each migration inside its own transaction, applied set recorded in
--   schema_migrations (owned by the runner, not by this file);
-- * ordered, immutable once delivered (sha256 content checksum);
-- * all timestamps are epoch milliseconds (INTEGER).
--
-- This table is the A15 EvidenceLog's durable schema demonstration
-- (spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15):
--   * one row per WRITTEN EvidenceRecord — "one immutable record per
--     consequential operation" (lines 25-33), five semantic slots:
--     what (operation_type + subject_ids), when (protocol_sequence +
--     wall_ms), authority, outcome (outcome_result + outcome_reason_code),
--     proof (submitter_proof JSON + the chain material columns);
--   * "append-only, totally sequenced" (lines 35-37): sequence_number is
--     the INTEGER PRIMARY KEY — the log's total order;
--   * "Each record's proof includes the hash of its predecessor" (lines
--     36-37): predecessor_hash; record_hash is the record's own digest;
--   * INV-15-4 (lines 56-58): write_key is UNIQUE — "evidence write keys
--     derived from the subject operation id prevent duplicate records for
--     one operation"; record_id (also UNIQUE) is the write key's derived
--     record identity;
--   * INV-15-2 (lines 51-53): "the log is append-only; no record is
--     modified or removed" — enforced at the storage boundary by the
--     triggers below.
--
-- The substrate's durable_events table is a DIFFERENT thing and is NOT
-- reused here: substrate lifecycle events are substrate-owned
-- (spec/durable/execution.md §11, owner durable-substrate); the A15 log is
-- protocol-owned (the RTN-002 stop condition against that conflation).
-- This store lives in its own database file (var/evidence.sqlite), disjoint
-- from the substrate's var/durable.sqlite and the kernel's
-- var/kernel.sqlite.

CREATE TABLE evidence_records (
  sequence_number INTEGER PRIMARY KEY,   -- the log's total sequence (A15 lines 35-37)
  record_id TEXT NOT NULL,               -- derived record identity (INV-15-4 route)
  write_key TEXT NOT NULL UNIQUE,        -- derived subject-operation write key (INV-15-4)
  authority TEXT NOT NULL,               -- the registry's owning authority names (A15 line 29)
  operation_type TEXT NOT NULL,          -- 'what' slot: operation type (A15 line 27)
  subject_ids TEXT NOT NULL,             -- 'what' slot: subject object ids, canonical JSON array (A15 line 27)
  protocol_sequence INTEGER NOT NULL,    -- 'when' slot: sequenced protocol time (A15 line 28)
  wall_ms INTEGER NOT NULL,              -- 'when' slot: recorded wall time, epoch ms (A15 line 28)
  outcome_result TEXT NOT NULL,          -- 'outcome' slot: resulting state or decision (A15 line 30)
  outcome_reason_code TEXT,              -- 'outcome' slot: reason code, when present (A15 line 30)
  submitter_proof TEXT NOT NULL,         -- 'proof' slot: submitter material, canonical JSON (A15 lines 31-32)
  predecessor_hash TEXT NOT NULL,        -- 'proof' slot: predecessor hash link (A15 lines 35-37)
  record_hash TEXT NOT NULL              -- 'proof' slot: this record's own hash (A15 lines 31-37)
);

CREATE UNIQUE INDEX evidence_records_record_id ON evidence_records (record_id);

-- INV-15-2 (evidence-risk-compliance.md lines 51-53): "the log is
-- append-only; no record is modified or removed." The code has no update
-- or delete path; these triggers make the storage boundary enforce the
-- same invariant against any other means.
CREATE TRIGGER evidence_records_no_update
BEFORE UPDATE ON evidence_records
BEGIN
  SELECT RAISE (ABORT, 'INV-15-2: evidence records are append-only - no record is modified');
END;

CREATE TRIGGER evidence_records_no_delete
BEFORE DELETE ON evidence_records
BEGIN
  SELECT RAISE (ABORT, 'INV-15-2: evidence records are append-only - no record is removed');
END;
