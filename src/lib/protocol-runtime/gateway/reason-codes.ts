/**
 * RTN-010 — Protocol gateway: the admission reason-code vocabulary.
 *
 * The gateway is the in-process, sole admission point for protocol commands
 * (spec/deployment/topology.md line 231: "There is exactly one
 * protocol-command admission point (protocol-gateway)"; deploy/contracts/
 * components.json protocol-gateway: "the sole admission point for protocol
 * commands"). Every refusal at admission carries a reason code from THIS
 * frozen vocabulary — deterministic, closed, and machine-readable, following
 * the kernel's reason-code convention (kernel/reason-codes.ts: a frozen
 * Object.freeze tuple, a closed union type, a runtime guard; "no
 * inventions").
 *
 * Spec sources (binding):
 *   spec/protocol-runtime-work-orders/RTN-010.md line 10 (the objective):
 *     "rejection reason codes for invalid/unauthorized commands"
 *   spec/protocol-runtime-work-orders/RTN-010.md line 14 (acceptance):
 *     "Every authority command kind is admitted or rejected with a
 *      deterministic reason code"
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 67-69 (the
 *     machine-readable-reason discipline this vocabulary extends to
 *     admission):
 *     "the intent moves to FAILED with a machine readable reason code"
 *   kernel reason-codes.ts (the frozen-vocabulary convention: "Frozen so
 *     the set cannot be extended at runtime — no inventions").
 *
 * Vocabulary semantics (each member's scope):
 *   - ENVELOPE_INVALID       — the submission failed the kernel command
 *                              envelope contract (kernel/envelope.ts
 *                              validateCommandEnvelope: kind, authority,
 *                              subjectIds, idempotencyKey, protocolTime,
 *                              body). The envelope is "the payload contract
 *                              of the durable command path" — a submission
 *                              that fails it never becomes a protocol
 *                              command.
 *   - AUTHORITY_UNKNOWN      — the envelope names a real registry authority
 *                              (the evidence authority slot resolved) but
 *                              that authority hosts no gateway command
 *                              surface in this runtime (e.g. area 17-24
 *                              follow-on wave authorities, or the Evidence
 *                              Authority, whose log is written
 *                              synchronously through the port by every
 *                              writer — never commanded through the queue).
 *   - COMMAND_KIND_UNKNOWN   — the authority is a gateway command authority
 *                              but the kind is not one of its registered
 *                              command kinds.
 *   - COMMAND_BODY_INVALID   — the body failed the owning authority's
 *                              command schema (per-command per owning
 *                              authority — rtn-plan-rulings.md Q4, delta 4:
 *                              "its admission surface validates command
 *                              schemas (including subject ids) per owning
 *                              authority").
 *   - COMMAND_SUBJECT_INVALID — the envelope's subjectIds do not match the
 *                              command's declared subject binding (the
 *                              subject object ids the command addresses).
 *
 * What is deliberately NOT in this vocabulary:
 *   - No queue-submit failure code. The durable enqueue is the admission's
 *     COMMIT step, not an admission decision: a failed enqueue fails the
 *     whole submitCommand operation (thrown, A15 discipline — "an operation
 *     is not committed until its record is written. A failed write fails
 *     the operation", evidence-risk-compliance.md lines 62-64), no receipt
 *     is recorded, and re-submission under the same key is safe (the queue
 *     dedupes on UNIQUE (idempotency_key, kind)). Queue submit health is
 *     reported by the health functions ("durable-queue submit success" —
 *     deploy/contracts/components.json), not by an admission reason code.
 *   - No domain reason codes (ILLEGAL_TRANSITION, POOL_NOT_FOUND, ...).
 *     Those belong to the owning authorities and are decided on the
 *     transition path, never at admission — "no financial effect occurs at
 *     admission (effects occur only via the transition path)" (RTN-010.md
 *     line 14). The gateway never preempts a typed domain rejection.
 *   - No UNKNOWN member. UNKNOWN is the shared vocabulary's external-result
 *     state (GC-2); admission decisions are internal and deterministic
 *     ("Intent creation and transition are internal operations with
 *     deterministic outcomes" — core.md lines 66-67, the same discipline).
 */

/**
 * The frozen admission reason-code vocabulary — the complete, closed set the
 * gateway may return on a typed refusal.
 *
 * Source: RTN-010.md lines 10, 14 ("rejection reason codes for
 * invalid/unauthorized commands"; "admitted or rejected with a deterministic
 * reason code"); kernel reason-codes.ts (the frozen-vocabulary convention).
 */
export const GATEWAY_ADMISSION_REASON_CODES: readonly [
  'ENVELOPE_INVALID',
  'AUTHORITY_UNKNOWN',
  'COMMAND_KIND_UNKNOWN',
  'COMMAND_BODY_INVALID',
  'COMMAND_SUBJECT_INVALID',
] = Object.freeze([
  'ENVELOPE_INVALID',
  'AUTHORITY_UNKNOWN',
  'COMMAND_KIND_UNKNOWN',
  'COMMAND_BODY_INVALID',
  'COMMAND_SUBJECT_INVALID',
] as const);

/**
 * A gateway admission reason code.
 *
 * Source: RTN-010.md lines 10, 14.
 */
export type GatewayAdmissionReasonCode = (typeof GATEWAY_ADMISSION_REASON_CODES)[number];

/**
 * Runtime type guard: true iff the value is a member of the admission
 * reason-code vocabulary.
 *
 * Source: RTN-010.md line 14 (deterministic reason codes); kernel
 * reason-codes.ts isSharedReasonCode (the guard convention).
 */
export function isGatewayAdmissionReasonCode(value: unknown): value is GatewayAdmissionReasonCode {
  return (
    typeof value === 'string' &&
    (GATEWAY_ADMISSION_REASON_CODES as readonly string[]).includes(value)
  );
}
