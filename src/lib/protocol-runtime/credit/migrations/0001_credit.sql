-- payswap3 · RTN-007 · credit migration 0001 — Credit Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/credit/migrations/) is the credit
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
-- CreditLine rows (liquidity-credit-queues.md §2 Area 7 lines 96-98:
-- "CreditLine — agreement extending fulfillment capacity against future
-- repayment. States: OFFERED -> ACTIVE -> SUSPENDED ->
-- terminal(CLOSED)."). The limit is the area-5 ledger resource's
-- declared total (resource id `credit-line:<lineId>`, declared at
-- activation): limit_minor + currency + scale carry it; the ledger's
-- INV-5-1 over that resource IS INV-7-1 here.
CREATE TABLE credit_lines (
  line_id TEXT NOT NULL PRIMARY KEY,
  limit_minor INTEGER NOT NULL CHECK (limit_minor > 0),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  state TEXT NOT NULL CHECK (state IN ('OFFERED', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  offered_seq INTEGER NOT NULL CHECK (offered_seq >= 0),
  offered_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL
);

-- CreditDecision rows (liquidity-credit-queues.md §2 Area 7 lines
-- 105-111: "CreditDecision — deterministic evaluation result for a
-- requested credit usage. States: EVALUATED -> APPLIED. Outcome:
-- APPROVED with approved amount, or DENIED with reason code."). The
-- UNIQUE (intent_id, line_id) makes INV-7-3's keying ("decisions are
-- keyed by (intent id, line id)") structural at the storage layer;
-- approved_amount is canonical Money JSON (an approval names an exact
-- integer amount — "No partial ambiguity").
CREATE TABLE credit_decisions (
  decision_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  line_id TEXT NOT NULL REFERENCES credit_lines(line_id),
  state TEXT NOT NULL CHECK (state IN ('EVALUATED', 'APPLIED')),
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN ('APPROVED', 'DENIED')),
  approved_amount TEXT,
  denial_reason TEXT CHECK (denial_reason IS NULL OR denial_reason IN ('LINE_NOT_ACTIVE', 'INSUFFICIENT_REMAINING_LIMIT')),
  reservation_id TEXT,
  evaluated_seq INTEGER NOT NULL CHECK (evaluated_seq >= 0),
  evaluated_wall_ms INTEGER NOT NULL,
  applied_seq INTEGER,
  applied_wall_ms INTEGER,
  UNIQUE (intent_id, line_id),
  CHECK (
    (outcome_kind = 'APPROVED' AND approved_amount IS NOT NULL AND denial_reason IS NULL)
    OR (outcome_kind = 'DENIED' AND approved_amount IS NULL AND denial_reason IS NOT NULL)
  ),
  CHECK (
    (state = 'APPLIED' AND reservation_id IS NOT NULL AND applied_seq IS NOT NULL)
    OR (state = 'EVALUATED' AND reservation_id IS NULL AND applied_seq IS NULL)
  )
);
CREATE INDEX credit_decisions_by_line ON credit_decisions(line_id);

-- CreditExposure rows (liquidity-credit-queues.md §2 Area 7 lines
-- 101-104: "CreditExposure — current outstanding amount (Money, integer)
-- on a credit line, mutated only through area 5 reservations tied to
-- obligations from clearing (area 9)."). A denormalized durable
-- projection of the ledger resource accounting (reserved = held,
-- consumed = settled into obligations) kept in lockstep with the ledger
-- transitions; the CHECK (reserved + consumed <= limit) is the
-- storage-level backstop of INV-7-1 ("exposure never exceeds the line
-- limit"). The authoritative computation is ALWAYS the ledger fold.
CREATE TABLE credit_exposure (
  line_id TEXT NOT NULL PRIMARY KEY REFERENCES credit_lines(line_id),
  limit_minor INTEGER NOT NULL CHECK (limit_minor > 0),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  reserved_minor INTEGER NOT NULL CHECK (reserved_minor >= 0),
  consumed_minor INTEGER NOT NULL CHECK (consumed_minor >= 0),
  CHECK (reserved_minor + consumed_minor <= limit_minor)
);
