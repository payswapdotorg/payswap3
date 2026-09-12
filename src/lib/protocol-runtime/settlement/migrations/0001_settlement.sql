-- payswap3 · RTN-009 · settlement migration 0001 — Settlement and
-- Finality Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/settlement/migrations/) is the
-- settlement domain's migration set, following the kernel's template
-- (src/lib/protocol-runtime/kernel/migrations/0001_kernel.sql) and the
-- RTN-007/RTN-008 sibling templates.
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
-- SettlementInstruction records (clearing-netting-settlement.md §4 Area
-- 12 lines 224-227): "SettlementInstruction — protocol authorization to
-- move value externally for one obligation or net position. States:
-- CREATED -> ISSUED -> terminal(CONFIRMED | FAILED)." The state CHECK is
-- the exact machine; the subject is the (kind, id) pair with kind
-- OBLIGATION (an A10 ledger id) or NET_POSITION (an A11 net obligation
-- id) — lines 224-225 verbatim ("one obligation or net position"); the
-- subject_ordinal records the recovery order ("recovery is a new
-- instruction with a new attempt"); the amount columns are the GC-1
-- integer Money discipline copied VERBATIM from the subject (INV-12-1);
-- the payload hash is recorded at creation and compared on every result
-- (INV-12-1/INV-13-2); the UNIQUE (subject_kind, subject_id,
-- subject_ordinal) is the deterministic instruction identity.
CREATE TABLE settlement_instructions (
  instruction_id TEXT NOT NULL PRIMARY KEY CHECK (length(instruction_id) > 0),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('OBLIGATION', 'NET_POSITION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) > 0),
  subject_ordinal INTEGER NOT NULL CHECK (subject_ordinal >= 1),
  state TEXT NOT NULL CHECK (state IN ('CREATED', 'ISSUED', 'CONFIRMED', 'FAILED')),
  beneficiary TEXT NOT NULL CHECK (length(beneficiary) > 0),
  memo TEXT,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  amount_minor INTEGER NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) > 0),
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  issued_seq INTEGER,
  issued_wall_ms INTEGER,
  terminal_seq INTEGER,
  terminal_wall_ms INTEGER,
  UNIQUE (subject_kind, subject_id, subject_ordinal)
);

CREATE INDEX settlement_instructions_by_subject
  ON settlement_instructions (subject_kind, subject_id);

-- SettlementAttempt records (lines 228-233): "SettlementAttempt — one
-- authorized external attempt for one instruction. States: CREATED ->
-- SUBMITTED -> PENDING | terminal(CONFIRMED | FAILED | UNKNOWN)." The
-- state CHECK is the exact machine INCLUDING the UNKNOWN -> {CONFIRMED,
-- FAILED} resolution edges (the A13 RailOperation mirror); the UNIQUE
-- instruction_id is INV-12-2/INV-12-3 at the storage layer — at most one
-- attempt per instruction, keyed by the instruction id; the idempotency
-- key column carries the deterministic rail idempotency key derived from
-- the instruction id (INV-12-3/INV-13-3); reconciliation_case_id carries
-- the automatically opened area-14 case when the attempt landed UNKNOWN.
CREATE TABLE settlement_attempts (
  attempt_id TEXT NOT NULL PRIMARY KEY CHECK (length(attempt_id) > 0),
  instruction_id TEXT NOT NULL UNIQUE
    REFERENCES settlement_instructions (instruction_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  state TEXT NOT NULL CHECK (
    state IN ('CREATED', 'SUBMITTED', 'PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN')
  ),
  operation_id TEXT NOT NULL CHECK (length(operation_id) > 0),
  adapter_id TEXT NOT NULL CHECK (length(adapter_id) > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  reconciliation_case_id TEXT,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  submitted_seq INTEGER,
  submitted_wall_ms INTEGER,
  resolved_seq INTEGER,
  resolved_wall_ms INTEGER
);

-- FinalityRecord records (lines 235-240): "FinalityRecord — protocol
-- declaration that value movement is irreversible. States: PROVISIONAL
-- -> FINAL." The state CHECK is the exact two-state machine — FINAL has
-- no successor (no reversal anywhere: INV-12-4); the UNIQUE
-- (subject_kind, subject_id) is INV-12-4's exactly-once at the storage
-- layer — one FinalityRecord per settlement subject, ever; only the
-- Settlement and Finality Authority's command surface writes this table.
CREATE TABLE finality_records (
  finality_record_id TEXT NOT NULL PRIMARY KEY CHECK (length(finality_record_id) > 0),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('OBLIGATION', 'NET_POSITION')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) > 0),
  state TEXT NOT NULL CHECK (state IN ('PROVISIONAL', 'FINAL')),
  instruction_id TEXT
    REFERENCES settlement_instructions (instruction_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  operation_id TEXT,
  rule_reference TEXT NOT NULL CHECK (length(rule_reference) > 0),
  payload_hash TEXT,
  declared_provisional_seq INTEGER,
  declared_provisional_wall_ms INTEGER,
  declared_final_seq INTEGER,
  declared_final_wall_ms INTEGER,
  UNIQUE (subject_kind, subject_id)
);
