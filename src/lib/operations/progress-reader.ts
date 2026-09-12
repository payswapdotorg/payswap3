/**
 * DEP-004 — Operational jobs: the job-progress audit reader (READS ONLY).
 *
 * Owned surface: src/lib/operations/progress-reader.ts (work order DEP-004
 * IMPLEMENTATION 3 — "a job-progress reader for audit (reads only)").
 *
 * The reader produces the operational-jobs audit report by joining three
 * READ-ONLY sources over the DEP-003 database:
 *
 *   1. durable_events under OPERATIONS_EVENT_OWNER — the jobs' own
 *      journal (started / work-derived / command-submitted /
 *      unknown-held / no-work / completed).
 *   2. durable_events COMMAND_EXECUTED observation rows (owner = the
 *      registry authority name) — the transition runtime's execution
 *      evidence for the durable command jobs the jobs' submissions
 *      created (joined by the command's durable job id, which the
 *      journal's command-submitted rows record).
 *   3. The durable_jobs statuses of the operations.* job kinds — the
 *      substrate's own lifecycle rows (enqueued / succeeded / …).
 *
 * The join answers the audit question per submitted command: admitted →
 * executed? (applied / replayed / rejected), or admitted → still queued
 * (the recorded D-2 vocabulary-gap subset — an honest status, never a
 * silent gap). The reader never writes anything and imports no authority.
 *
 * Spec sources (binding): spec/system-work-orders/DEP-004.md ("Clearing/
 * netting jobs are restart-safe and auditable"; the required
 * audit-evidence tests); spec/durable/execution.md (the durable_events
 * evidence home with the explicit owner column).
 */

import { listRecentEvents } from '../durable/events.ts';
import type { DurableDatabase } from '../durable/db.ts';
import type { DurableEvent } from '../durable/events.ts';
import { OPERATIONS_EVENT_OWNER } from './jobs.ts';

/** The transition runtime's command-execution observation event type. */
const COMMAND_EXECUTED_EVENT_TYPE = 'protocol.command.executed';

/** One audited command submission (the journal row joined with its execution). */
export interface AuditedJobCommand {
  readonly jobKind: string;
  readonly cycle: number;
  readonly commandKind: string;
  readonly subject: string;
  readonly idempotencyKey: string;
  readonly ok: boolean;
  readonly created: boolean;
  readonly replayed: boolean;
  readonly reasonCode?: string;
  /** The durable command-path job id (when admitted). */
  readonly commandJobId?: string;
  /** The command's execution status, when an observation row exists: applied | replayed | rejected. */
  readonly executionStatus?: string;
  /** The execution's typed rejection code (when status is 'rejected'). */
  readonly executionCode?: string;
}

/** One job run's audit summary. */
export interface AuditedJobRun {
  readonly jobKind: string;
  readonly cycle: number;
  readonly jobId: string | null;
  readonly derivedCount: number;
  readonly createdCount: number;
  readonly replayedCount: number;
  readonly refusedCount: number;
  readonly unknownHeldCount: number;
}

/** The full operational-jobs progress report (reads only). */
export interface OperationalJobProgress {
  /** The journal rows under the operations owner, oldest first. */
  readonly journal: readonly DurableEvent[];
  /** Every audited command submission (admission + execution join). */
  readonly commands: readonly AuditedJobCommand[];
  /** Every job run's summary. */
  readonly runs: readonly AuditedJobRun[];
  /** The UNKNOWN-held observations (the never-retry discipline's evidence). */
  readonly unknownHeld: readonly { readonly jobKind: string; readonly cycle: number; readonly subject: string; readonly caseId?: string }[];
  /** The A15 chain height over the composition's log (cross-reference). */
  readonly totalEventRows: number;
}

/**
 * Read the operational-jobs progress report. READS ONLY — one
 * listRecentEvents pass over the durable_events table (bounded), joined
 * in memory. The database handle is passed in explicitly (the plain-Node
 * composition convention).
 */
export function readOperationalJobProgress(
  database: DurableDatabase,
  options: { readonly eventLimit?: number } = {},
): OperationalJobProgress {
  const limit = options.eventLimit ?? 4_000;
  const recent = listRecentEvents(database, limit);
  // listRecentEvents is newest-first; the journal narrates chronologically.
  const chronological = [...recent].reverse();
  const journal = chronological.filter((event) => event.owner === OPERATIONS_EVENT_OWNER);

  // The execution observations, by durable command job id.
  const executions = new Map<string, DurableEvent>();
  for (const event of chronological) {
    if (event.type === COMMAND_EXECUTED_EVENT_TYPE && event.jobId !== null) {
      executions.set(event.jobId, event);
    }
  }

  const commands: AuditedJobCommand[] = [];
  const runs: AuditedJobRun[] = [];
  const unknownHeld: Array<{ jobKind: string; cycle: number; subject: string; caseId?: string }> = [];
  let currentRun: {
    jobKind: string;
    cycle: number;
    jobId: string | null;
    derivedCount: number;
    createdCount: number;
    replayedCount: number;
    refusedCount: number;
    unknownHeldCount: number;
  } | null = null;

  for (const event of journal) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case 'operations.job.started': {
        currentRun = {
          jobKind: String(data.jobKind),
          cycle: Number(data.cycle),
          jobId: event.jobId,
          derivedCount: 0,
          createdCount: 0,
          replayedCount: 0,
          refusedCount: 0,
          unknownHeldCount: 0,
        };
        break;
      }
      case 'operations.command.submitted': {
        const commandJobId = typeof data.commandJobId === 'string' ? data.commandJobId : undefined;
        const execution = commandJobId === undefined ? undefined : executions.get(commandJobId);
        const executionData =
          execution === undefined ? undefined : ((execution.data ?? {}) as Record<string, unknown>);
        commands.push({
          jobKind: String(data.jobKind),
          cycle: Number(data.cycle),
          commandKind: String(data.commandKind),
          subject: String(data.subject),
          idempotencyKey: String(data.idempotencyKey),
          ok: Boolean(data.ok),
          created: Boolean(data.created),
          replayed: Boolean(data.replayed),
          ...(typeof data.reasonCode === 'string' ? { reasonCode: data.reasonCode } : {}),
          ...(commandJobId === undefined ? {} : { commandJobId }),
          ...(executionData === undefined
            ? {}
            : typeof executionData.status === 'string'
              ? { executionStatus: executionData.status }
              : {}),
          ...(executionData !== undefined && typeof executionData.code === 'string'
            ? { executionCode: executionData.code }
            : {}),
        });
        if (currentRun !== null && currentRun.cycle === Number(data.cycle) && currentRun.jobKind === String(data.jobKind)) {
          if (Boolean(data.ok)) {
            if (Boolean(data.created)) {
              currentRun.createdCount += 1;
            } else if (Boolean(data.replayed)) {
              currentRun.replayedCount += 1;
            }
          } else {
            currentRun.refusedCount += 1;
          }
        }
        break;
      }
      case 'operations.work.derived': {
        if (currentRun !== null) {
          currentRun.derivedCount = Array.isArray(data.derived) ? (data.derived as unknown[]).length : 0;
        }
        break;
      }
      case 'operations.unknown.held': {
        unknownHeld.push({
          jobKind: String(data.jobKind),
          cycle: Number(data.cycle),
          subject: String(data.subject),
          ...(typeof data.caseId === 'string' ? { caseId: data.caseId } : {}),
        });
        if (currentRun !== null) {
          currentRun.unknownHeldCount += 1;
        }
        break;
      }
      case 'operations.job.completed': {
        if (currentRun !== null) {
          runs.push({
            jobKind: currentRun.jobKind,
            cycle: currentRun.cycle,
            jobId: currentRun.jobId,
            derivedCount: Number(data.derivedCount ?? currentRun.derivedCount),
            createdCount: Number(data.createdCount ?? currentRun.createdCount),
            replayedCount: Number(data.replayedCount ?? currentRun.replayedCount),
            refusedCount: Number(data.refusedCount ?? currentRun.refusedCount),
            unknownHeldCount: Number(data.unknownHeldCount ?? currentRun.unknownHeldCount),
          });
          currentRun = null;
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    journal,
    commands,
    runs,
    unknownHeld,
    totalEventRows: recent.length,
  };
}
