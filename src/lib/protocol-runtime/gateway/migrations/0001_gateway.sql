-- payswap3 · RTN-010 · gateway migration 0001 — Protocol Gateway store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/gateway/migrations/) is the gateway
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
-- CommandReceipt rows — the generalized IntentReceipt (core.md §1 Area 1
-- lines 43-44: "IntentReceipt — idempotent response object: intent id,
-- current state, and recorded outcome for the submitted idempotency key.",
-- generalized per RTN-010.md line 10 to every protocol command admitted by
-- the gateway). The PRIMARY KEY (kind, idempotency_key) mirrors the DEP-003
-- dedupe identity UNIQUE (idempotency_key, kind) — one row per admitted
-- command; re-submission returns the recorded receipt, never a second
-- effect (INV-1-3, core.md lines 60-62). job_id is the durable command
-- path position (durable_jobs.id) of the admitted command.
CREATE TABLE gateway_command_receipts (
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ADMITTED')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ADMITTED', 'DUPLICATE')),
  job_id TEXT NOT NULL,
  recorded_seq INTEGER NOT NULL CHECK (recorded_seq >= 0),
  recorded_wall_ms INTEGER NOT NULL,
  written_at INTEGER NOT NULL,
  PRIMARY KEY (kind, idempotency_key)
);
CREATE INDEX gateway_command_receipts_by_command
  ON gateway_command_receipts(command_id);
