/**
 * DEP-007 — Recovery: the incident-recovery audit identity and journal port.
 *
 * Owned surface: src/lib/recovery/journal.ts (work order DEP-007 —
 * "backup, restore, replay and recovery automation"; required evidence
 * "backup/restore drill, worker restart drill, replay/recovery test,
 * evidence-integrity verification").
 *
 * The DEP-004/DEP-005 owner-identity precedent applied to the recovery
 * family: every consequential recovery action (a backup taken, a restore
 * verified, a restore REFUSED, a replay completed, a tamper DETECTED, an
 * integrity verification) records one durable_events row under the
 * family's own owner identity — 'incident-recovery' — through the DEP-003
 * substrate's recordEvent API (the substrate records, never interprets).
 *
 * The family writes NO A15 records directly (the A15 chain's authority
 * vocabulary is closed to registry authorities; this family hosts none)
 * and never writes authoritative state: the only durable writes the
 * recovery family performs are its OWN audit rows under its OWN owner
 * identity (on the store the composition root directs), plus the backup
 * artifact files and their append-only manifest on disk.
 *
 * Runtime note: this module imports only the DEP-003 events module
 * (plain-Node loadable, type-stripping compatible) — the database handle
 * is always passed in explicitly.
 */

import { recordEvent as recordEventOnDatabase, listRecentEvents } from '../durable/events.ts';
import type { DurableDatabase } from '../durable/db.ts';
import type { DurableEvent } from '../durable/events.ts';

// ---------------------------------------------------------------------------
// The audit identity (the DEP-003 durable_events owner column)
// ---------------------------------------------------------------------------

/**
 * The durable_events owner for every recovery-family audit row. Evidence
 * without an owner is rejected by definition (the substrate's rule); the
 * recovery family names itself.
 */
export const RECOVERY_EVENT_OWNER = 'incident-recovery';

/** The recovery family's audit event vocabulary (the journal type strings). */
export const RECOVERY_EVENT_TYPES = Object.freeze({
  backupCompleted: 'recovery.backup.completed',
  restoreVerified: 'recovery.restore.verified',
  restoreFailed: 'recovery.restore.failed',
  replayCompleted: 'recovery.replay.completed',
  tamperDetected: 'recovery.tamper.detected',
  integrityVerified: 'recovery.integrity.verified',
} as const);

// ---------------------------------------------------------------------------
// The audit port (structural — the substrate's recordEvent satisfies it)
// ---------------------------------------------------------------------------

/**
 * The durable journal port: the DEP-003 substrate's recordEvent satisfies
 * it structurally (type/data/owner/jobId — the DEP-004/DEP-005
 * OperationalAuditPort/ActivityAuditPort precedent). The recovery family
 * holds ONLY this port — no gateway, no authority, no state write.
 */
export interface RecoveryAuditPort {
  readonly recordEvent: (
    type: string,
    data: unknown,
    owner: string,
    jobId?: string | null,
  ) => unknown;
}

/** Bind the audit port over an explicit durable database handle. */
export function recoveryAuditFromDatabase(database: DurableDatabase): RecoveryAuditPort {
  return {
    recordEvent: (type, data, owner, jobId) =>
      recordEventOnDatabase(database, type, data, owner, jobId ?? null),
  };
}

/** One recovery journal row as the observability reader sees it. */
export interface RecoveryJournalRow extends DurableEvent {}

/** The recovery journal rows recorded on a store, oldest first. */
export function listRecoveryEvents(
  database: DurableDatabase,
  limit: number = 500,
): readonly RecoveryJournalRow[] {
  // Read-only reuse of the substrate's public reader (listRecentEvents is
  // newest-first; the journal narrates chronologically).
  return listRecentEvents(database, limit).reverse();
}
