-- payswap3 · DEP-003 · migration 0001 — durable execution substrate

-- Ordered, immutable once delivered. Applied by the explicit migration runner
-- in src/lib/durable/db.ts (runMigrations): filenames are applied in lexical
-- order, each migration runs inside its own transaction, and the applied set
-- (name + sha256 content checksum) is recorded in schema_migrations, which is
-- owned by the runner, not by this file.

-- Conventions:
-- * all timestamps are epoch milliseconds (INTEGER)
-- * status values for durable_jobs: queued | reserved | succeeded | failed | dead_lettered
-- * UNIQUE (idempotency_key, kind): enqueue dedupe. SQLite treats NULLs as
-- distinct inside UNIQUE constraints, so a NULL idempotency_key opts the
-- job out of dedupe (registering intent, not identity).
-- * durable_events is the persistent home for lifecycle events and protocol
-- evidence; the owner column names the party that recorded the row.
-- There is deliberately no foreign key from durable_events.job_id to
-- durable_jobs.id: evidence must remain queryable even if a job row were
-- ever archived or removed by an operator.

CREATE TABLE durable_jobs (
id TEXT PRIMARY KEY,
kind TEXT NOT NULL,
idempotency_key TEXT,
payload TEXT NOT NULL,
status TEXT NOT NULL CHECK (status IN ('queued', 'reserved', 'succeeded', 'failed', 'dead_lettered')),
attempts INTEGER NOT NULL DEFAULT 0,
max_attempts INTEGER NOT NULL,
reserved_by TEXT,
lease_expires_at INTEGER,
available_at INTEGER NOT NULL,
created_at INTEGER NOT NULL,
updated_at INTEGER NOT NULL,
UNIQUE (idempotency_key, kind)
);

-- Reservation lookup: jobs eligible for claim are filtered by
-- (status, available_at) — this is the hot path for reserve().
CREATE INDEX durable_jobs_status_available_idx
ON durable_jobs (status, available_at);

-- Lease-expiry reclaim: reclaimExpired scans reserved jobs whose
-- lease_expires_at has passed.
CREATE INDEX durable_jobs_lease_reclaim_idx
ON durable_jobs (status, lease_expires_at);

CREATE TABLE durable_events (
id INTEGER PRIMARY KEY AUTOINCREMENT,
job_id TEXT,
type TEXT NOT NULL,
data TEXT NOT NULL,
owner TEXT NOT NULL,
recorded_at INTEGER NOT NULL
);

CREATE INDEX durable_events_job_id_idx
ON durable_events (job_id);

CREATE INDEX durable_events_type_idx
ON durable_events (type);
