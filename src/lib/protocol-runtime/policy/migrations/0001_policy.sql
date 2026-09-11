-- payswap3 · RTN-005 · policy migration 0001 — Fulfillment Policy Authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/policy/migrations/) is the policy
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
-- FulfillmentPolicy rows (core.md §2 Area 2 lines 97-100: "FulfillmentPolicy
-- — versioned, immutable policy document attached to an intent at
-- authorization time. Lifecycle: AUTHORED -> VERSIONED -> ATTACHED."). The
-- AUTHORED draft of a policy identity is the version-0 row (the risk-rule
-- precedent); publishing assigns the next integer version as a new
-- immutable row. One open draft per policy identity (partial unique
-- index); the partial unique index on attached_intent_id makes the 1:1
-- attachment contract ("a policy attached to an intent is fixed for that
-- intent") structural at the storage layer.
CREATE TABLE fulfillment_policies (
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  state TEXT NOT NULL CHECK (state IN ('AUTHORED', 'VERSIONED', 'ATTACHED')),
  definition TEXT NOT NULL,
  attached_intent_id TEXT,
  attached_snapshot_id TEXT,
  created_seq INTEGER NOT NULL CHECK (created_seq >= 0),
  created_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  PRIMARY KEY (policy_id, version)
);
CREATE UNIQUE INDEX fulfillment_policies_one_draft_per_policy
  ON fulfillment_policies(policy_id) WHERE state = 'AUTHORED';
CREATE UNIQUE INDEX fulfillment_policies_one_policy_per_intent
  ON fulfillment_policies(attached_intent_id) WHERE attached_intent_id IS NOT NULL;

-- PolicyEvaluation rows (core.md §2 Area 2 lines 102-107: "PolicyEvaluation
-- — deterministic result of evaluating a policy against an intent and a
-- capability snapshot. States: EVALUATED -> CONSUMED."). evaluation_id is
-- the derived (intent, policy version, snapshot id) identity of INV-2-3 —
-- the UNIQUE (intent_id, policy_id, policy_version, snapshot_id) makes the
-- one-evaluation-per-key contract structural at the storage layer; result
-- is the canonical JSON of the recorded outcome (satisfiable result or the
-- reason-coded failure); result_hash is the POLICY_EVALUATED proof
-- material.
CREATE TABLE policy_evaluations (
  evaluation_id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('EVALUATED', 'CONSUMED')),
  result TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  evaluated_seq INTEGER NOT NULL CHECK (evaluated_seq >= 0),
  evaluated_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL CHECK (state_seq >= 0),
  state_wall_ms INTEGER NOT NULL,
  UNIQUE (intent_id, policy_id, policy_version, snapshot_id)
);
