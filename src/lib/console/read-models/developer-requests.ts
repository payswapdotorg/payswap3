/**
 * PC-003 — Developer request-log read scaffold (for PC-005).
 *
 * RECORDED GAP (the design §17 developer-request-log row, read side): NO
 * request-log authority or persistence exists at this baseline — the
 * console/API logging boundary is PENDING-PC-005 (see
 * spec/console/reconciliation-matrix.md). This module therefore:
 *
 *   - answers readConsoleDeveloperRequests() with the UNAVAILABLE branch
 *     (presentation UNKNOWN) and the owning-authority gap recorded in the
 *     attached authority metadata — a log gap is a DIAGNOSTIC unknown, never
 *     a business verdict, and NO request-log data is fabricated here;
 *   - exports normalizeDeveloperRequestRecord(): a PURE presentation
 *     normalizer over the EXISTING structured-log record contract
 *     (LogRecord, src/lib/observability/logging.ts) that PC-005's future
 *     request-log boundary can feed records through. It applies the EXISTING
 *     fail-closed redaction primitive scrubCredentialReferences
 *     (src/lib/observability/logging.ts) to every payload BEFORE it becomes
 *     a console DTO — credentials, authorization headers, and secret-bearing
 *     fields never cross this boundary unredacted (design §11).
 *
 * Console logs are diagnostic records, not evidence substitutes (design
 * §11): the DTO carries no protocol-evidence claims and the authority
 * metadata says so.
 */

import { scrubCredentialReferences } from '@/lib/observability/logging';
import type { LogRecord } from '@/lib/observability/logging';
import { consoleUnavailable } from '../dto';
import type { ConsoleReadResult } from '../types';
import { consoleSourceMetadata } from '../authority/sources';

// ── DTOs ───────────────────────────────────────────────────────────────────

/**
 * One developer request-log record (diagnostic only). The payload is ALWAYS
 * the scrubbed form — never the raw logged data.
 */
export interface ConsoleDeveloperRequestRecordDto {
  /** Wall-clock ms as recorded by the logging authority. */
  readonly wallMs: number;
  /** The log level, verbatim (debug | info | warn | error). */
  readonly level: string;
  /** The structured event name, verbatim. */
  readonly event: string;
  /** The SCRUBBED payload (scrubCredentialReferences applied). */
  readonly data: unknown;
  /** The trace id, when the record carried one. */
  readonly traceId?: string;
}

/** The developer-requests read value (empty until PC-005 wires a real source). */
export interface ConsoleDeveloperRequestsDto {
  readonly requests: readonly ConsoleDeveloperRequestRecordDto[];
  /** The redaction primitive every payload passed through (recorded provenance). */
  readonly redaction: string;
}

// ── The scaffold read ──────────────────────────────────────────────────────

/** The honest note carried by the unavailable read (the recorded gap). */
export const DEVELOPER_REQUESTS_GAP_NOTE =
  'No request-log authority is merged at this baseline: the console/API logging boundary is PENDING-PC-005 and no request-log persistence exists (recorded in spec/console/reconciliation-matrix.md, developer-request-log row). This read is a diagnostic UNKNOWN — not a business verdict — and no request-log data is fabricated. The redaction primitive (scrubCredentialReferences, src/lib/observability/logging.ts) is wired into the record normalizer so the PC-005 source ships redacted from its first record.';

/**
 * Read the developer request log. At this baseline the answer is ALWAYS the
 * UNAVAILABLE branch with the recorded owning-authority gap — PC-005 will
 * replace the body of this scaffold with the real request-boundary source
 * (the DTO contract and the redaction path stay).
 */
export async function readConsoleDeveloperRequests(): Promise<ConsoleReadResult<ConsoleDeveloperRequestsDto>> {
  return consoleUnavailable(consoleSourceMetadata('developer-requests'), DEVELOPER_REQUESTS_GAP_NOTE);
}

// ── The pure normalizer (PC-005's ingestion seam) ──────────────────────────

/**
 * Normalize ONE structured-log record into the console DTO, applying the
 * existing fail-closed credential-reference scrub to the payload FIRST.
 * Pure presentation composition: no source is read, no record is invented,
 * and unredacted payload material never crosses into the DTO.
 */
export function normalizeDeveloperRequestRecord(record: LogRecord): ConsoleDeveloperRequestRecordDto {
  return {
    wallMs: record.wallMs,
    level: record.level,
    event: record.event,
    data: scrubCredentialReferences(record.data),
    ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
  };
}
