/**
 * RTN-004 — Rails: the OWNED IN-SURFACE TEST DOUBLE of the
 * EvidenceSubmission port.
 *
 * Wave evidence discipline (spec/protocol-runtime-work-orders/README.md,
 * "Evidence discipline"):
 *   "every consequential operation writes an A15 record through the
 *    kernel-declared EvidenceSubmission port; where the real evidence log
 *    is not yet a hard dependency (RTN-003, RTN-004), the item tests
 *    against an owned in-surface test double of the port and the real-log
 *    integration is proven in RTN-012."
 *
 * This module is TEST TOOLING ONLY — not a protocol type, not a second
 * evidence authority, and NOT exported from the public barrel
 * (index.ts). Like the kernel's bun-test.d.ts ("Not a protocol type: no
 * spec citation applies (test tooling only)"), it carries no spec
 * citation. The real Evidence Authority (RTN-002) owns the log; RTN-012
 * proves the composed integration.
 *
 * Capabilities beyond the bare port (all test-control only):
 *   - records: every submitted record, in submission order;
 *   - byOperationType(type): the sub-log for one operation type;
 *   - clear(): reset the double between scenarios;
 *   - failNext(): arm a one-shot synchronous write failure — used to
 *     prove the GC-5/A15 coupling ("an operation is not committed until
 *     its record is written. A failed write fails the operation"): the
 *     authority command must throw AND roll back its state transaction.
 */

import type {
  EvidenceSubmission,
  EvidenceSubmissionRecord,
} from '../kernel/ports.ts';

/** The owned test double (see module doc). */
export interface EvidenceTestDouble extends EvidenceSubmission {
  /** All submitted records, in submission order. */
  readonly records: readonly EvidenceSubmissionRecord[];
  /** The sub-log for one operation type (e.g. 'RAIL_OP_AUTHORIZED'). */
  byOperationType(operationType: string): readonly EvidenceSubmissionRecord[];
  /** Reset the recorded log (test isolation). */
  clear(): void;
  /** Arm a one-shot submit failure (GC-5 rollback-coupling proof). */
  failNext(): void;
}

/**
 * Build the owned in-surface test double of the EvidenceSubmission port.
 */
export function createEvidenceTestDouble(): EvidenceTestDouble {
  const records: EvidenceSubmissionRecord[] = [];
  let failArmed = false;
  return {
    submit(record: EvidenceSubmissionRecord): void {
      if (failArmed) {
        failArmed = false;
        throw new Error('evidence test double: armed write failure (A15: a failed write fails the operation)');
      }
      records.push(record);
    },
    get records(): readonly EvidenceSubmissionRecord[] {
      return records;
    },
    byOperationType(operationType: string): readonly EvidenceSubmissionRecord[] {
      return records.filter((record) => record.what.operationType === operationType);
    },
    clear(): void {
      records.length = 0;
    },
    failNext(): void {
      failArmed = true;
    },
  };
}
