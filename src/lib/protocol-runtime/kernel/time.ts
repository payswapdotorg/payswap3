/**
 * RTN-001 — Protocol runtime kernel: protocol time.
 *
 * Spec source (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines 27-28
 *   (EvidenceRecord field contract):
 *     "what: operation type and subject object ids.
 *      when: protocol time (sequenced) and recorded wall time."
 *   spec/architecture/v0.1/core.md §2 Area 3, lines 165-166:
 *     "CapabilitySnapshot — immutable, sequenced view of all capabilities at
 *      a point in protocol time"
 *   spec/architecture/v0.1/core.md §5 Area 5, lines 290-291:
 *     "Each reservation carries a deadline; expiry is deterministic on
 *      protocol time."
 *
 * Shape: ProtocolTime pairs a totally-ordered SEQUENCE position (the
 * protocol's own ordering — the "sequenced" component) with the RECORDED
 * wall-clock instant (epoch milliseconds, integer). Both components are
 * integers by construction; the sequenced component is a non-negative
 * integer. The kernel does not own sequencing (that belongs to the
 * authorities' ledgers/logs, e.g. the A15 EvidenceLog and the area 5
 * ReservationLedger); it only fixes the shared TIME SHAPE every authority
 * records.
 *
 * Supporting contract (timestamp representation): deploy/migrations/
 * 0001_durable_execution.sql line 10 — "all timestamps are epoch
 * milliseconds (INTEGER)".
 */

/**
 * Position in the protocol's sequenced order. Non-negative integer, branded;
 * only `protocolTime()` mints it.
 *
 * Source: evidence-risk-compliance.md line 28 — "protocol time (sequenced)";
 * core.md lines 165-166 — "immutable, sequenced view ... at a point in
 * protocol time".
 */
export type SequencedPosition = number & { readonly __kernelSequence: 'non-negative-integer-sequence' };

/**
 * Recorded wall-clock instant in integer epoch milliseconds. Branded; only
 * `protocolTime()` mints it.
 *
 * Source: evidence-risk-compliance.md line 28 — "and recorded wall time".
 */
export type WallEpochMs = number & { readonly __kernelWallMs: 'integer-epoch-milliseconds' };

/**
 * Protocol time: the (sequenced position, recorded wall time) pair every
 * authority stamps onto its records.
 *
 * Source: evidence-risk-compliance.md line 28 — "when: protocol time
 * (sequenced) and recorded wall time."
 */
export interface ProtocolTime {
  readonly sequence: SequencedPosition;
  readonly wallMs: WallEpochMs;
}

function fail(message: string): never {
  throw new TypeError(message);
}

/**
 * Construct a ProtocolTime value. The single public mint.
 *
 * Rejects (deterministically, via TypeError): non-number or floating-point
 * sequence positions, negative sequences, non-integer wall timestamps, and
 * values outside the safe-integer range. Wall time may be negative (epochs
 * before 1970-01-01 UTC are representable); sequence positions may not.
 *
 * Source: evidence-risk-compliance.md line 28; integer discipline per README
 * §3 GC-1 lines 39-43 applied to the timestamp representation.
 */
export function protocolTime(sequence: number, wallMs: number): ProtocolTime {
  if (typeof sequence !== 'number') {
    fail(`protocolTime: sequence must be a number (got ${typeof sequence})`);
  }
  if (!Number.isInteger(sequence)) {
    fail(`protocolTime: sequence must be an integer (got ${sequence})`);
  }
  if (sequence < 0) {
    fail(`protocolTime: sequence must be non-negative (got ${sequence})`);
  }
  if (!Number.isSafeInteger(sequence)) {
    fail(`protocolTime: sequence must be a safe integer (got ${sequence})`);
  }
  if (typeof wallMs !== 'number') {
    fail(`protocolTime: wallMs must be a number (got ${typeof wallMs})`);
  }
  if (!Number.isInteger(wallMs)) {
    fail(`protocolTime: wallMs must be an integer number of epoch milliseconds (got ${wallMs})`);
  }
  if (!Number.isSafeInteger(wallMs)) {
    fail(`protocolTime: wallMs must be a safe integer (got ${wallMs})`);
  }
  return { sequence, wallMs } as ProtocolTime;
}

/**
 * Runtime type guard: true iff the value is a structurally complete,
 * well-formed ProtocolTime (non-negative integer sequence, integer epoch-ms
 * wall time, both within the safe-integer range).
 *
 * Source: evidence-risk-compliance.md line 28 (the 'when' slot shape).
 */
export function isProtocolTime(value: unknown): value is ProtocolTime {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ProtocolTime>;
  return (
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence >= 0 &&
    Number.isSafeInteger(candidate.sequence) &&
    typeof candidate.wallMs === 'number' &&
    Number.isInteger(candidate.wallMs) &&
    Number.isSafeInteger(candidate.wallMs)
  );
}
