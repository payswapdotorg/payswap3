/**
 * DEP-007 — Observability: structured logging (JSON lines, leveled,
 * fail-closed scrub) over in-process sinks.
 *
 * Owned surface: src/lib/observability/logging.ts (work order DEP-007 —
 * health/metrics/logging/tracing surfaces).
 *
 * THE CONTRACT:
 *   - STRUCTURED: every emit is one JSON line — {ts, level, event, data,
 *     traceId?} — written to the bound sinks (default: process stdout) and
 *     to a bounded, queryable in-process ring buffer. There is NO external
 *     telemetry backend in this work item: external binding is recorded
 *     FUTURE-WORK (the DEP-002+ binding precedent).
 *   - LEVELED: debug | info | warn | error.
 *   - NO SECRETS, FAIL-CLOSED: every payload passes scrubCredentialReferences
 *     BEFORE emission. The scrubber treats credential-reference NAMES as
 *     sensitive (the rail configuration naming — PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF
 *     — plus the generic secret-shaped patterns) and redacts them; a
 *     non-serializable or circular payload fails closed: the record is
 *     emitted with the payload REPLACED by a named scrub error, never with
 *     the raw object (a scrub failure is never a silent pass).
 *   - OBSERVATION ONLY: the logger emits to in-process sinks; it writes no
 *     durable state, no authoritative state, and never financial evidence.
 */

// ---------------------------------------------------------------------------
// The level vocabulary
// ---------------------------------------------------------------------------

/** The log levels (debug is emitted only when enabled). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: readonly LogLevel[] = Object.freeze(['debug', 'info', 'warn', 'error']);

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The fail-closed credential-reference scrubber
// ---------------------------------------------------------------------------

/**
 * Field-NAME patterns whose values are treated as credential references
 * (fail-closed: the NAME itself is sensitive per the DEP-007 dispatch —
 * the rail configuration naming carries credential REFERENCE names, and a
 * log must never become the place references accumulate).
 */
const SENSITIVE_KEY_PATTERN =
  /(?:credential(?:ref)?|secret|token|password|passwd|api[-_]?key|private[-_]?key)/i;

/**
 * VALUE patterns that look like credential references or secret material
 * (the rail harness's S1-style set, extended with the rail variable-name
 * pattern and reference-shaped values).
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = Object.freeze([
  /PAYSWAP_RAIL_[A-Z]+_[A-Z0-9_]+_CREDENTIAL_REF/i,
  /^secret-ref:/i,
  /ghp_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
]);

const REDACTED_KEY = '[REDACTED:sensitive-key]';
const REDACTED_VALUE = '[REDACTED:credential-reference]';
const SCRUB_FAILURE = '[REDACTED:scrub-failed]';

function redactString(value: string): string {
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return REDACTED_VALUE;
    }
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scrubValue(value: unknown, depth: number, seen: ReadonlySet<unknown>): unknown {
  if (depth > 8) {
    return SCRUB_FAILURE;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return SCRUB_FAILURE;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(value);
    return value.map((entry) => scrubValue(entry, depth + 1, nextSeen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return SCRUB_FAILURE;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(value);
    const scrubbed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        scrubbed[key] = REDACTED_KEY;
        continue;
      }
      const scrubbedKey = redactString(key);
      scrubbed[scrubbedKey] = scrubValue(entry, depth + 1, nextSeen);
    }
    return scrubbed;
  }
  return value;
}

/**
 * Deep, fail-closed credential-reference scrub of one log payload:
 *   - object keys matching the credential-reference naming are redacted
 *     entirely (names are sensitive);
 *   - string values matching secret-shaped patterns are redacted;
 *   - circular or over-deep structures fail closed (the offending branch
 *     is replaced by a named marker — never the raw value).
 */
export function scrubCredentialReferences(value: unknown): unknown {
  return scrubValue(value, 0, new Set());
}

// ---------------------------------------------------------------------------
// The log record and the ring buffer
// ---------------------------------------------------------------------------

/** One structured log record (the scrubbed, immutable emit unit). */
export interface LogRecord {
  readonly wallMs: number;
  readonly level: LogLevel;
  readonly event: string;
  readonly data: unknown;
  readonly traceId?: string;
}

/** A log sink: one line of JSON per record. */
export interface LogSink {
  write(line: string): void;
}

/** The console sink (JSON lines to stdout — the default). */
export function consoleLogSink(): LogSink {
  return {
    write(line: string) {
      process.stdout.write(`${line}\n`);
    },
  };
}

/** The default ring-buffer capacity (bounded — the queryable surface). */
export const DEFAULT_RING_CAPACITY = 1_000;

/** The ring-buffer query filters (AND-combined). */
export interface LogQuery {
  readonly level?: LogLevel;
  readonly event?: string;
  readonly sinceWallMs?: number;
  readonly traceId?: string;
}

export interface ObservabilityLoggerOptions {
  /** Sinks (default: the console sink). */
  readonly sinks?: readonly LogSink[];
  /** Ring-buffer capacity (default 1000; must be >= 1). */
  readonly ringCapacity?: number;
  /** Whether debug records emit to sinks (they are always ring-recorded). */
  readonly emitDebug?: boolean;
  /** The clock (default Date.now — injectable for deterministic drills). */
  readonly now?: () => number;
}

export interface ObservabilityLogger {
  log(level: LogLevel, event: string, data?: unknown, context?: { readonly traceId?: string }): void;
  /** Query the ring buffer (oldest first, AND-combined filters). */
  query(query?: LogQuery): readonly LogRecord[];
  /** All buffered records (oldest first). */
  all(): readonly LogRecord[];
  /** The number of records currently buffered. */
  size(): number;
}

/**
 * Build the observability logger. Every emit: scrub (fail-closed) →
 * serialize → JSON line to each sink → append to the bounded ring buffer.
 * A serialization failure after scrubbing is itself logged as an error
 * event with the payload replaced — never a silent drop.
 */
export function createObservabilityLogger(
  options: ObservabilityLoggerOptions = {},
): ObservabilityLogger {
  const sinks =
    options.sinks === undefined || options.sinks.length === 0
      ? [consoleLogSink()]
      : [...options.sinks];
  const capacity =
    options.ringCapacity !== undefined && Number.isInteger(options.ringCapacity) && options.ringCapacity >= 1
      ? options.ringCapacity
      : DEFAULT_RING_CAPACITY;
  const emitDebug = options.emitDebug === true;
  const now = options.now ?? Date.now;
  const ring: LogRecord[] = [];

  const emit = (record: LogRecord): void => {
    ring.push(record);
    if (ring.length > capacity) {
      ring.splice(0, ring.length - capacity);
    }
    if (record.level === 'debug' && !emitDebug) {
      return;
    }
    let line: string;
    try {
      line = JSON.stringify({
        ts: record.wallMs,
        level: record.level,
        event: record.event,
        ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
        data: record.data,
      });
    } catch (error) {
      // Fail-closed: the scrubbed payload failed to serialize (non-
      // serializable leaf). Emit the named failure, never the raw object.
      line = JSON.stringify({
        ts: record.wallMs,
        level: 'error',
        event: 'observability.log.serialization-failed',
        data: {
          originalEvent: record.event,
          reason: error instanceof Error ? error.message : String(error),
          payload: SCRUB_FAILURE,
        },
      });
    }
    for (const sink of sinks) {
      sink.write(line);
    }
  };

  return {
    log(level, event, data, context) {
      if (!isLogLevel(level)) {
        throw new TypeError(`log: invalid level ${JSON.stringify(level)}`);
      }
      if (typeof event !== 'string' || event.length === 0) {
        throw new TypeError('log: event must be a non-empty string');
      }
      emit({
        wallMs: now(),
        level,
        event,
        data: scrubCredentialReferences(data === undefined ? null : data),
        ...(context?.traceId === undefined ? {} : { traceId: context.traceId }),
      });
    },
    query(query = {}) {
      return Object.freeze(
        ring.filter(
          (record) =>
            (query.level === undefined || record.level === query.level) &&
            (query.event === undefined || record.event === query.event) &&
            (query.sinceWallMs === undefined || record.wallMs >= query.sinceWallMs) &&
            (query.traceId === undefined || record.traceId === query.traceId),
        ),
      );
    },
    all() {
      return Object.freeze([...ring]);
    },
    size() {
      return ring.length;
    },
  };
}
