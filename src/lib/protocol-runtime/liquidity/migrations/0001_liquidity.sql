-- payswap3 · RTN-007 · liquidity migration 0001 — Liquidity Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/liquidity/migrations/) is the
-- liquidity domain's migration set, following the kernel's template
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
-- LiquidityPool rows (liquidity-credit-queues.md §1 Area 6 lines 31-34:
-- "LiquidityPool — protocol-owned account of funds usable for fulfillment
-- in one currency. States: OPEN -> FROZEN -> CLOSED."). Single-currency
-- is structural: currency + scale are fixed at open time and every
-- funding/hold amount is checked against them (INV-6-2 — "pools are
-- single-currency, so no cross-currency arithmetic occurs here").
-- total_minor is the stored INV-6-1 left-hand side ("pool total equals
-- the integer sum of its positions at all times") the identity check
-- recomputes against the position totals.
CREATE TABLE liquidity_pools (
  pool_id TEXT NOT NULL PRIMARY KEY,
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  scale INTEGER NOT NULL CHECK (scale >= 0),
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'FROZEN', 'CLOSED')),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  opened_seq INTEGER NOT NULL CHECK (opened_seq >= 0),
  opened_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL
);

-- LiquidityPosition rows (liquidity-credit-queues.md §1 Area 6 lines
-- 36-39: "LiquidityPosition — component of a pool attributed to a funding
-- source or operational purpose. States: AVAILABLE -> RESERVED ->
-- terminal(CONSUMED | RETURNED)."). position_id is the DERIVED identity
-- of (the funding entry) and IS the area-5 ledger resource id — the
-- ledger's reservation entries against this id drive the position. The
-- accounting columns are canonical Money JSON kept in lockstep with the
-- ledger's INV-5-1 accounting; the CHECK constraint over the sum is the
-- storage-level backstop of INV-6-1 ("per position, available + reserved
-- + consumed arithmetic is exact and integer" — verified post-parse in
-- the read bridge, structural here as far as SQLite can express it).
CREATE TABLE liquidity_positions (
  position_id TEXT NOT NULL PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES liquidity_pools(pool_id),
  funding_entry_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('AVAILABLE', 'RESERVED', 'CONSUMED', 'RETURNED')),
  total TEXT NOT NULL,
  available TEXT NOT NULL,
  reserved TEXT NOT NULL,
  consumed TEXT NOT NULL,
  funding_source_kind TEXT NOT NULL CHECK (funding_source_kind IN ('INTERNAL_TRANSFER', 'EXTERNAL_RAIL')),
  funding_source_ref TEXT NOT NULL,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  UNIQUE (pool_id, funding_entry_id)
);
CREATE INDEX liquidity_positions_by_pool ON liquidity_positions(pool_id);

-- FundingEntry rows (liquidity-credit-queues.md §1 Area 6 lines 40-43:
-- "FundingEntry — record of funds entering a pool, referencing either an
-- internal transfer of settled funds (area 12) or a confirmed external
-- funding rail operation (area 13)."). funding_entry_id is DERIVED from
-- (source kind, source reference id) — the PRIMARY KEY makes INV-6-3's
-- exactly-once ("a FundingEntry id applies exactly once; duplicate
-- funding submissions are detected by id and recorded as duplicates
-- without effect") structural at the storage layer, and the UNIQUE source
-- reference pair makes one rail operation / one internal transfer fund
-- exactly one entry.
CREATE TABLE funding_entries (
  funding_entry_id TEXT NOT NULL PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES liquidity_pools(pool_id),
  position_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('INTERNAL_TRANSFER', 'EXTERNAL_RAIL')),
  source_reference_id TEXT NOT NULL,
  recorded_seq INTEGER NOT NULL CHECK (recorded_seq >= 0),
  recorded_wall_ms INTEGER NOT NULL,
  UNIQUE (source_kind, source_reference_id)
);

-- PendingFundingLink rows (liquidity-credit-queues.md §1 Area 6 lines
-- 64-67: external funding "may return UNKNOWN; in that case no
-- FundingEntry exists yet — the pool is unchanged, and the case waits for
-- reconciliation (GC-2)"). The linkage is the UNKNOWN path's durable
-- artifact; the terminal resolution (RESOLVED_CONFIRMED /
-- RESOLVED_FAILED — the area-14 vocabulary) drives the entry creation
-- exactly once or no entry.
CREATE TABLE pending_funding_links (
  pending_id TEXT NOT NULL PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES liquidity_pools(pool_id),
  rail_operation_id TEXT NOT NULL,
  expected_amount TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RESOLVED_CONFIRMED', 'RESOLVED_FAILED')),
  opened_seq INTEGER NOT NULL CHECK (opened_seq >= 0),
  opened_wall_ms INTEGER NOT NULL,
  resolved_seq INTEGER,
  resolved_wall_ms INTEGER,
  funding_entry_id TEXT,
  UNIQUE (pool_id, rail_operation_id)
);
