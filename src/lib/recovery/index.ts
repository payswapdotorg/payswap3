/**
 * DEP-007 — The recovery family barrel: backup, restore, and replay over
 * the DEP-003 durable substrate (read-only integration).
 *
 * Owned surface: src/lib/recovery/ (work order DEP-007 — "Owned surfaces:
 * ... backups, restore, replay and recovery automation").
 *
 * WHAT THIS LAYER IS: the deployment-owned disaster-recovery automation:
 *   - backup.ts  — the verified ONLINE backup (VACUUM INTO through the
 *     substrate handle, WAL-checkpoint discipline, immediate read-only
 *     verification, the append-only JSONL manifest with per-row evidence
 *     digests);
 *   - restore.ts — restore INTO A TARGET COPY (never in place) with the
 *     fail-closed verification battery (integrity_check, migration
 *     checksums vs the backup record AND the repository files, event/journal
 *     continuity with no restore-introduced gaps, evidence-integrity
 *     re-verification with the tampered row identified) + the standalone
 *     verifyEvidenceIntegrity the tamper drill drives;
 *   - replay.ts  — recovery replay THROUGH THE EXISTING worker/queue API
 *     (bindDurableRuntime composes the exported DurableQueue/DurableWorker
 *     classes over an explicit handle — never a second execution path; the
 *     drain-until-settled loop with lease-expiry redelivery; the
 *     idempotency report the drills assert on);
 *   - journal.ts — the family's audit identity (owner 'incident-recovery')
 *     and the RecoveryAuditPort.
 *
 * WHAT THIS LAYER IS NOT (the work-order boundary, structural):
 *   - NOT a protocol authority and NOT a second command path: no gateway
 *     import, no authority import, no state mutation beyond the family's
 *     OWN audit rows under its OWN owner identity;
 *   - NOT a finality reverser: recovery restores infrastructure and
 *     replays authorized work; finality is NEVER reversed by recovery
 *     (topology.md R3); evidence is append-only and never rewritten (R4);
 *   - NOT a retry engine for UNKNOWN: UNKNOWN outcomes surface to A14
 *     reconciliation exactly as the DEP-005 contract requires — recovery
 *     never blind-retries them.
 *
 * The evidence harness scripts/test_observability_resilience.mjs drives
 * every drill through this barrel's exports.
 */

// --- the audit identity ---------------------------------------------------------
export {
  RECOVERY_EVENT_OWNER,
  RECOVERY_EVENT_TYPES,
  recoveryAuditFromDatabase,
  listRecoveryEvents,
} from './journal.ts';
export type { RecoveryAuditPort, RecoveryJournalRow } from './journal.ts';

// --- backup ----------------------------------------------------------------------
export {
  createBackup,
  appendToManifest,
  readBackupManifest,
  manifestSummary,
  evidenceRowDigest,
  evidenceRootDigest,
} from './backup.ts';
export type {
  BackupManifestEntry,
  BackupMigrationRecord,
  BackupOptions,
  EvidenceRowDigest,
} from './backup.ts';

// --- restore ----------------------------------------------------------------------
export { restoreBackup, verifyEvidenceIntegrity, RestoreVerificationError } from './restore.ts';
export type {
  RestoreOptions,
  RestoreResult,
  RestoreVerification,
  EvidenceIntegrityResult,
  EvidenceMismatch,
} from './restore.ts';

// --- replay ------------------------------------------------------------------------
export {
  bindDurableRuntime,
  drainUntilSettled,
  replayRestoredQueue,
} from './replay.ts';
export type {
  BindDurableRuntimeOptions,
  BoundDurableRuntime,
  DrainOptions,
  DrainReport,
  ReplayReport,
  ReplayRestoredQueueOptions,
} from './replay.ts';
