-- payswap3 · RTN-008 · clearing migration 0001 — Clearing Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/clearing/migrations/) is the
-- clearing domain's migration set, following the kernel's template
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
-- ClearingBatch rows (clearing-netting-settlement.md §1 Area 9 lines
-- 29-33: "ClearingBatch — unit of staged processing. States: OPEN ->
-- STAGED -> COMMITTED -> FINAL. Contents are immutable after STAGED.
-- COMMITTED means obligations have been created; FINAL means all
-- produced obligations are handed to the obligation ledger."). The
-- CHECK over the state vocabulary makes the exact machine structural at
-- the storage layer; batch_sequence is the INV-9-2 processing position
-- (UNIQUE — the total order); per_currency_totals is the INV-9-1 staged
-- integer summation (canonical MoneyBag JSON); contents_hash is the
-- BATCH_STAGED proof ("record count, per-currency totals hash").
CREATE TABLE clearing_batches (
  batch_id TEXT NOT NULL PRIMARY KEY,
  batch_label TEXT NOT NULL UNIQUE,
  batch_sequence INTEGER NOT NULL UNIQUE CHECK (batch_sequence >= 0),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'STAGED', 'COMMITTED', 'FINAL')),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  per_currency_totals TEXT NOT NULL,
  contents_hash TEXT NOT NULL,
  opened_seq INTEGER NOT NULL CHECK (opened_seq >= 0),
  opened_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  commit_idempotency_key TEXT,
  commit_obligation_ids TEXT NOT NULL DEFAULT '[]',
  commit_duplicate_origins TEXT NOT NULL DEFAULT '[]',
  commit_seq INTEGER,
  commit_wall_ms INTEGER
);

-- ClearingRecord rows (clearing-netting-settlement.md §1 Area 9 lines
-- 35-40: "ClearingRecord — one economic event inside a batch: reference
-- to the fulfilling activity (route plan hop, intent), parties, Money
-- amounts, and reason. States: ACCEPTED -> STAGED | QUARANTINED.
-- Quarantined records never produce obligations; they await manual or
-- automated disposition with reason codes."). The CHECK constraints make
-- the exact record machine and the reason-code-mandatory quarantine
-- structural; quarantined rows are KEPT (never dropped) — the
-- disposition is out of band. record_id is the DERIVED identity of the
-- origin (the INV-10-3 creation key); origin_activity_id is the INV-9-2
-- dedup key. The (batch_id, position) pair preserves the stored record
-- order (the deterministic commit order).
CREATE TABLE clearing_records (
  batch_id TEXT NOT NULL REFERENCES clearing_batches(batch_id),
  position INTEGER NOT NULL CHECK (position >= 0),
  record_id TEXT NOT NULL,
  origin_activity_id TEXT NOT NULL CHECK (length(origin_activity_id) > 0),
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('ROUTE_PLAN_HOP', 'INTENT', 'RECONCILIATION_ADJUSTMENT')),
  debtor_participant_id TEXT NOT NULL CHECK (length(debtor_participant_id) > 0),
  creditor_participant_id TEXT NOT NULL CHECK (length(creditor_participant_id) > 0),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  amount_minor INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  correction_of TEXT,
  state TEXT NOT NULL CHECK (state IN ('ACCEPTED', 'STAGED', 'QUARANTINED')),
  quarantine_reason TEXT CHECK (quarantine_reason IS NULL OR quarantine_reason IN (
    'INVALID_MONEY_NOT_INTEGER', 'INVALID_MONEY_SHAPE', 'SCALE_MISMATCH_WITHIN_CURRENCY',
    'ZERO_AMOUNT', 'SELF_PARTY', 'UPSTREAM_UNRESOLVED_UNKNOWN'
  )),
  accepted_seq INTEGER NOT NULL CHECK (accepted_seq >= 0),
  accepted_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  PRIMARY KEY (batch_id, position)
);

-- Structural backstop: a QUARANTINED row MUST carry its reason code
-- ("with reason codes"); a STAGED/ACCEPTED row must not.
CREATE TRIGGER clearing_quarantine_reason_required
BEFORE INSERT ON clearing_records
WHEN NEW.state = 'QUARANTINED' AND (NEW.quarantine_reason IS NULL OR NEW.quarantine_reason = '')
BEGIN
  SELECT RAISE(ABORT, 'quarantined clearing records require a reason code');
END;

CREATE TRIGGER clearing_quarantine_reason_forbidden
BEFORE INSERT ON clearing_records
WHEN NEW.state != 'QUARANTINED' AND NEW.quarantine_reason IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'only quarantined clearing records carry a reason code');
END;
