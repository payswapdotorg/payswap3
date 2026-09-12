-- payswap3 · RTN-007 · queues migration 0001 — Queue Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/queues/migrations/) is the queues
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
-- FulfillmentQueue rows (liquidity-credit-queues.md §3 Area 8 lines
-- 163-165: "FulfillmentQueue — ordered waiting area with an eligibility
-- rule (resource availability, capability tier, deadline class).
-- States: OPEN -> DRAINING -> PAUSED -> CLOSED."). The policy columns
-- (ordering_rule, max_wait_epoch_ms, release_conditions) are written ONCE
-- at creation and never updated by the bridge — "QueuePolicy — immutable
-- per-queue policy: ordering rule, max wait, release conditions."
CREATE TABLE fulfillment_queues (
  queue_id TEXT NOT NULL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'DRAINING', 'PAUSED', 'CLOSED')),
  ordering_rule TEXT NOT NULL CHECK (ordering_rule = 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER'),
  max_wait_epoch_ms INTEGER NOT NULL CHECK (max_wait_epoch_ms > 0),
  release_conditions TEXT NOT NULL,
  next_sequence INTEGER NOT NULL CHECK (next_sequence >= 0),
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL
);

-- QueuedItem rows (liquidity-credit-queues.md §3 Area 8 lines 167-170:
-- "QueuedItem — one waiting intent (or route plan awaiting dispatch).
-- States: QUEUED -> ELIGIBLE -> DISPATCHED ->
-- terminal(GRADUATED | CANCELLED | EXPIRED)."). item_id is the DERIVED
-- (queue id, intent id) identity; the UNIQUE (queue_id, intent_id) makes
-- the derivation structural, and the UNIQUE (queue_id, queue_sequence)
-- makes the deterministic ordering's tie-breaker (the arrival position)
-- total. The terms column is the intent's FIXED monetary terms (INV-8-1
-- — canonical Money JSON, written once at enqueue, never updated);
-- linked_operation_id carries the INV-8-4 reconciliation linkage of a
-- DISPATCHED item.
CREATE TABLE queued_items (
  item_id TEXT NOT NULL PRIMARY KEY,
  queue_id TEXT NOT NULL REFERENCES fulfillment_queues(queue_id),
  intent_id TEXT NOT NULL,
  priority_class INTEGER NOT NULL CHECK (priority_class >= 0),
  queue_sequence INTEGER NOT NULL CHECK (queue_sequence >= 0),
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'ELIGIBLE', 'DISPATCHED', 'GRADUATED', 'CANCELLED', 'EXPIRED')),
  terms TEXT NOT NULL,
  enqueued_wall_ms INTEGER NOT NULL,
  enqueued_seq INTEGER NOT NULL CHECK (enqueued_seq >= 0),
  enqueued_wall_ms_seq INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  linked_operation_id TEXT,
  reason_code TEXT,
  UNIQUE (queue_id, intent_id),
  UNIQUE (queue_id, queue_sequence)
);
CREATE INDEX queued_items_by_queue ON queued_items(queue_id);
CREATE INDEX queued_items_by_operation ON queued_items(linked_operation_id);
