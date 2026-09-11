-- payswap3 · RTN-005 · intent migration 0001 — Intent Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/intent/migrations/) is the intent
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
-- PaymentIntent rows (core.md §1 Area 1 lines 33-37: "PaymentIntent —
-- durable statement of demand. States: DRAFT -> AUTHORIZED -> ROUTED ->
-- FULFILLING -> terminal(FULFILLED | FAILED | CANCELLED)"). intent_id is
-- the derived id (deriveProtocolId('intent', idempotency_key)); the UNIQUE
-- idempotency_key makes INV-1-2's collapse structural at the storage
-- layer. descriptor is the canonical JSON of the immutable DRAFT
-- attachment (lines 39-41); recorded_outcome is the receipt outcome for
-- the key (lines 43-44).
CREATE TABLE payment_intents (
  intent_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED')),
  descriptor TEXT NOT NULL,
  descriptor_hash TEXT NOT NULL,
  prior_intent_id TEXT,
  policy_decision_id TEXT,
  recorded_outcome TEXT NOT NULL CHECK (recorded_outcome IN ('DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED')),
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL
);
CREATE INDEX payment_intents_by_prior
  ON payment_intents(prior_intent_id);

-- IntentReceipt rows (core.md §1 Area 1 lines 43-44: "IntentReceipt —
-- idempotent response object: intent id, current state, and recorded
-- outcome for the submitted idempotency key."). One row per recorded
-- idempotency key (INV-1-3: re-submission returns the recorded receipt).
CREATE TABLE intent_receipts (
  idempotency_key TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED')),
  outcome TEXT NOT NULL CHECK (outcome IN ('DRAFT', 'AUTHORIZED', 'ROUTED', 'FULFILLING', 'FULFILLED', 'FAILED', 'CANCELLED')),
  recorded_seq INTEGER NOT NULL CHECK (recorded_seq >= 0),
  recorded_wall_ms INTEGER NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)
);
