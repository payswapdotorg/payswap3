-- payswap3 · RTN-003 · risk migration 0001 — risk/compliance authority store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside
-- its owned prefix, using the DEP-003 database layer read-only. This
-- directory (src/lib/protocol-runtime/risk/migrations/) is the risk
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

-- RiskRule versions (evidence-risk-compliance.md §2 lines 98-100:
-- "RiskRule — versioned, immutable rule definition ... States: AUTHORED ->
-- VERSIONED -> ACTIVE -> RETIRED."). The AUTHORED draft of a rule identity
-- is the version-0 row; publishing assigns the next integer version and
-- replaces the draft row. One open draft per rule identity (partial unique
-- index); every published version is an immutable row.
CREATE TABLE risk_rules (
  rule_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  state TEXT NOT NULL CHECK (state IN ('AUTHORED', 'VERSIONED', 'ACTIVE', 'RETIRED')),
  definition TEXT NOT NULL,
  created_wall_ms INTEGER NOT NULL,
  created_seq INTEGER NOT NULL,
  state_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL,
  PRIMARY KEY (rule_id, version)
);
CREATE UNIQUE INDEX risk_rules_one_draft_per_rule
  ON risk_rules(rule_id) WHERE state = 'AUTHORED';

-- Screening list versions (evidence-risk-compliance.md §2 lines 109-110,
-- 137-139: versioned list configuration; "a failed list refresh leaves the
-- prior version active and records the failure"). Append-only: one row per
-- (list id, version); entries are the canonical JSON array of party
-- digests (configuration data; boundary line 152-154: "list contents remain
-- configuration data").
CREATE TABLE screening_lists (
  list_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  entries TEXT NOT NULL,
  registered_wall_ms INTEGER NOT NULL,
  registered_seq INTEGER NOT NULL,
  PRIMARY KEY (list_id, version)
);

-- The recorded trail of failed list refreshes ("records the failure —
-- never a silent guess"). prior_version is the version that remains
-- active (NULL when none was ever registered).
CREATE TABLE screening_list_refresh_failures (
  failure_id TEXT NOT NULL PRIMARY KEY,
  list_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  prior_version INTEGER,
  failed_wall_ms INTEGER NOT NULL,
  failed_seq INTEGER NOT NULL
);

-- ScreeningResult rows (evidence-risk-compliance.md §2 lines 109-113:
-- "ScreeningResult — deterministic outcome of matching subject data
-- against a screening list version. States: COMPUTED -> terminal(CLEAR |
-- HIT)."). The UNIQUE (list_id, list_version, subject_data_hash) makes
-- INV-16-1 structural at the screening level: identical input triples
-- address the identical recorded outcome.
CREATE TABLE screening_results (
  screening_id TEXT NOT NULL PRIMARY KEY,
  list_id TEXT NOT NULL,
  list_version INTEGER NOT NULL CHECK (list_version >= 1),
  subject_data_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('COMPUTED', 'CLEAR', 'HIT')),
  matched_entry TEXT,
  created_wall_ms INTEGER NOT NULL,
  created_seq INTEGER NOT NULL,
  state_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL,
  UNIQUE (list_id, list_version, subject_data_hash)
);

-- ComplianceCheck rows (evidence-risk-compliance.md §2 lines 102-107:
-- "ComplianceCheck — one evaluation instance tied to a subject ... States:
-- EVALUATED -> terminal(APPROVED | DENIED | MANUAL_REVIEW) -> after
-- review: APPROVED | DENIED."). check_id is the derived
-- (subject id, rule set version) key of INV-16-4 — the primary key makes
-- re-evaluation return the recorded result. evaluation is the canonical
-- JSON of the full recorded INV-16-1 basis; review is the canonical JSON
-- of the recorded reviewed decision (present only after review).
CREATE TABLE compliance_checks (
  check_id TEXT NOT NULL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('INTENT', 'CAPABILITY_REGISTRATION', 'MERCHANT_ONBOARDING')),
  rule_set_version TEXT NOT NULL,
  screening_list_version_id TEXT NOT NULL,
  subject_data_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('EVALUATED', 'APPROVED', 'DENIED', 'MANUAL_REVIEW')),
  evaluation TEXT NOT NULL,
  review TEXT,
  created_wall_ms INTEGER NOT NULL,
  created_seq INTEGER NOT NULL,
  state_wall_ms INTEGER NOT NULL,
  state_seq INTEGER NOT NULL
);
CREATE INDEX compliance_checks_by_subject
  ON compliance_checks(subject_id);
