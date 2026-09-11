-- payswap3 · RTN-001 · kernel migration 0001 — protocol runtime kernel store
--
-- Per-domain persistence convention (decided in RTN-001; see
-- spec/protocol-runtime-work-orders/README.md "Persistence convention"):
-- each authority domain owns its schema and per-domain migrations inside its
-- owned prefix, using the DEP-003 database layer read-only. This directory
-- (src/lib/protocol-runtime/kernel/migrations/) is the kernel domain's
-- migration set; every later authority domain (src/lib/protocol-runtime/
-- <domain>/migrations/) follows the same shape.
--
-- Conventions (inherited from the substrate runner,
-- src/lib/durable/db.ts · deploy/migrations/0001_durable_execution.sql):
-- * applied by the DEP-003 migration runner in ascending filename order,
--   each migration inside its own transaction, applied set recorded in
--   schema_migrations (owned by the runner, not by this file);
-- * ordered, immutable once delivered (sha256 content checksum);
-- * all timestamps are epoch milliseconds (INTEGER).

-- Kernel-owned format-version bookmarks: the kernel's deterministic
-- derivation and envelope contracts are versioned (see identity.ts
-- DERIVATION_FORMAT_VERSION), and a kernel-owned store records which format
-- versions have been introduced into this deployment's data. Rows are
-- written by kernel-owned maintenance code (not by this migration); the
-- table itself carries no protocol semantics — v0.1 prescribes no storage
-- (spec/architecture/v0.1/README.md §9) and the kernel owns no protocol
-- state (core.md §0 defines conventions, not state objects).
CREATE TABLE kernel_format_versions (
  format TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  introduced_at INTEGER NOT NULL
);
