-- payswap3 · RTN-008 · obligations migration 0001 — Obligation Ledger
-- Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/obligations/migrations/) is the
-- obligations domain's migration set, following the kernel's template
-- (src/lib/protocol-runtime/kernel/migrations/0001_kernel.sql) and the
-- RTN-007 sibling template.
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
-- ObligationLedger entries (clearing-netting-settlement.md §2 Area 10
-- lines 104-106: "ObligationLedger — append-only, totally sequenced log
-- of obligation records and transitions."): ONE entry table with the
-- total sequence as the PRIMARY KEY (the gapless total order — INV-10-2
-- "ledger transitions are serialized by sequence"); the kind CHECK makes
-- the two entry kinds the complete vocabulary; the instruction-kind
-- CHECK is the INV-10-4 closed surface at the storage layer; the state
-- CHECKs are the exact obligation machine; amount_minor INTEGER is the
-- GC-1 integer Money discipline. There is deliberately NO update path
-- and no mutable amount column outside the INSERT (append-only —
-- INV-10-1 "the ledger never mutates an amount after creation").
CREATE TABLE obligation_ledger_entries (
  sequence INTEGER NOT NULL PRIMARY KEY CHECK (sequence >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('OBLIGATION_CREATED', 'OBLIGATION_TRANSITIONED')),
  obligation_id TEXT NOT NULL CHECK (length(obligation_id) > 0),
  -- creation-entry columns (NOT NULL iff kind = OBLIGATION_CREATED —
  -- enforced by the triggers below)
  created_by TEXT CHECK (created_by IS NULL OR created_by IN (
    'CLEARING_COMMIT', 'DISPUTE_RESOLUTION'
  )),
  origin_kind TEXT CHECK (origin_kind IS NULL OR origin_kind IN ('CLEARING', 'DISPUTE_RESOLUTION')),
  origin_record_id TEXT,
  origin_activity_id TEXT,
  origin_batch_id TEXT,
  origin_dispute_id TEXT,
  origin_resolved_obligation_id TEXT,
  debtor_participant_id TEXT,
  creditor_participant_id TEXT,
  currency TEXT,
  scale INTEGER,
  amount_minor INTEGER,
  reason TEXT,
  linked_prior_obligation_id TEXT,
  -- transition-entry columns (NOT NULL iff kind = OBLIGATION_TRANSITIONED)
  from_state TEXT CHECK (from_state IS NULL OR from_state IN (
    'CREATED', 'NETTED', 'SETTLEMENT_PENDING', 'SETTLED', 'DISPUTED', 'WRITTEN_OFF', 'CANCELLED'
  )),
  to_state TEXT CHECK (to_state IS NULL OR to_state IN (
    'CREATED', 'NETTED', 'SETTLEMENT_PENDING', 'SETTLED', 'DISPUTED', 'WRITTEN_OFF', 'CANCELLED'
  )),
  instruction_kind TEXT CHECK (instruction_kind IS NULL OR instruction_kind IN (
    'CLEARING_COMMIT', 'DISPUTE_RESOLUTION', 'DISPUTE_OPEN', 'RISK_WRITE_OFF',
    'CLEARING_CORRECTION_CANCEL', 'SETTLEMENT_FINALITY', 'NETTING_COMMIT', 'SETTLEMENT_INSTRUCTION'
  )),
  cause_reference TEXT,
  replacement_obligation_id TEXT,
  replacement_obligation_ids TEXT,
  when_seq INTEGER NOT NULL CHECK (when_seq >= 0),
  when_wall_ms INTEGER NOT NULL
);

-- Structural backstops: a creation entry carries its creation columns; a
-- transition entry carries its transition columns (the closed shapes).
CREATE TRIGGER obligation_creation_columns_required
BEFORE INSERT ON obligation_ledger_entries
WHEN NEW.kind = 'OBLIGATION_CREATED' AND (
  NEW.created_by IS NULL OR NEW.origin_kind IS NULL OR
  NEW.debtor_participant_id IS NULL OR NEW.creditor_participant_id IS NULL OR
  NEW.currency IS NULL OR NEW.scale IS NULL OR NEW.amount_minor IS NULL OR
  NEW.reason IS NULL OR NEW.from_state IS NOT NULL OR NEW.to_state IS NOT NULL OR
  NEW.instruction_kind IS NOT NULL OR NEW.cause_reference IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'an OBLIGATION_CREATED entry requires its creation columns and no transition columns');
END;

CREATE TRIGGER obligation_transition_columns_required
BEFORE INSERT ON obligation_ledger_entries
WHEN NEW.kind = 'OBLIGATION_TRANSITIONED' AND (
  NEW.from_state IS NULL OR NEW.to_state IS NULL OR
  NEW.instruction_kind IS NULL OR NEW.cause_reference IS NULL OR
  NEW.created_by IS NOT NULL OR NEW.origin_kind IS NOT NULL OR
  NEW.debtor_participant_id IS NOT NULL OR NEW.creditor_participant_id IS NOT NULL OR
  NEW.currency IS NOT NULL OR NEW.amount_minor IS NOT NULL OR NEW.reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'an OBLIGATION_TRANSITIONED entry requires its transition columns and no creation columns');
END;
