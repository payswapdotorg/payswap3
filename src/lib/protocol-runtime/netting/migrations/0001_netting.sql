-- payswap3 · RTN-009 · netting migration 0001 — Netting Authority
-- store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/netting/migrations/) is the netting
-- domain's migration set, following the kernel's template
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
-- NettingSet records (clearing-netting-settlement.md §3 Area 11
-- lines 157-163): "NettingSet — one netting computation over a closed set
-- of obligations. States: OPEN -> COMPUTED -> COMMITTED." The state CHECK
-- is the exact three-state machine; the input obligation ids are fixed
-- at OPEN (INV-11-3) and carried as the sorted JSON array; the scope
-- (bilateral: exactly two participants / multilateral: three or more) is
-- carried as kind + sorted JSON participants; the gross snapshot, net
-- positions, and the recorded conservation proof (INV-11-1: "the check
-- is recorded in the set's proof before commit") are carried as canonical
-- JSON blobs — written once at COMPUTED, immutable thereafter.
--
-- NetObligation records (lines 161-166, "replaced by net obligations in
-- the ledger" — materialized in the netting domain; see the netting
-- types.ts recorded interpretation and CONTRACT-REVIEW.md): the
-- settlement-facing lifecycle CREATED -> SETTLEMENT_PENDING -> SETTLED is
-- the exact CHECK; the amount columns are the GC-1 integer Money
-- discipline (currency + scale + amount_minor), set once at
-- materialization (the INV-10-1 discipline applied to the netting
-- domain); the UNIQUE constraint over (netting_set_id, debtor,
-- creditor, currency) is the deterministic net-obligation identity.
CREATE TABLE netting_sets (
  netting_set_id TEXT NOT NULL PRIMARY KEY CHECK (length(netting_set_id) > 0),
  label TEXT NOT NULL UNIQUE CHECK (length(label) > 0),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'COMPUTED', 'COMMITTED')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('BILATERAL', 'MULTILATERAL')),
  scope_participants TEXT NOT NULL CHECK (length(scope_participants) > 0),
  algorithm_version INTEGER NOT NULL CHECK (algorithm_version >= 1),
  input_obligation_ids TEXT NOT NULL CHECK (length(input_obligation_ids) > 0),
  gross_obligations TEXT,
  net_positions TEXT,
  conservation_proof TEXT,
  opened_seq INTEGER NOT NULL CHECK (opened_seq >= 0),
  opened_wall_ms INTEGER NOT NULL,
  computed_seq INTEGER,
  computed_wall_ms INTEGER,
  committed_seq INTEGER,
  committed_wall_ms INTEGER,
  CHECK (
    (state = 'OPEN' AND gross_obligations IS NULL AND net_positions IS NULL AND conservation_proof IS NULL AND computed_seq IS NULL)
    OR (state IN ('COMPUTED', 'COMMITTED') AND gross_obligations IS NOT NULL AND net_positions IS NOT NULL AND conservation_proof IS NOT NULL AND computed_seq IS NOT NULL)
  ),
  CHECK (
    (state = 'COMMITTED' AND committed_seq IS NOT NULL)
    OR (state IN ('OPEN', 'COMPUTED') AND committed_seq IS NULL)
  )
);

CREATE TABLE net_obligations (
  net_obligation_id TEXT NOT NULL PRIMARY KEY CHECK (length(net_obligation_id) > 0),
  netting_set_id TEXT NOT NULL
    REFERENCES netting_sets (netting_set_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  debtor_participant_id TEXT NOT NULL CHECK (length(debtor_participant_id) > 0),
  creditor_participant_id TEXT NOT NULL CHECK (length(creditor_participant_id) > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  state TEXT NOT NULL CHECK (state IN ('CREATED', 'SETTLEMENT_PENDING', 'SETTLED')),
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_changed_seq INTEGER NOT NULL CHECK (state_changed_seq >= 0),
  state_changed_wall_ms INTEGER NOT NULL,
  UNIQUE (netting_set_id, debtor_participant_id, creditor_participant_id, currency)
);

CREATE INDEX net_obligations_by_set ON net_obligations (netting_set_id);
