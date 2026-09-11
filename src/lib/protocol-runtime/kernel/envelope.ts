/**
 * RTN-001 — Protocol runtime kernel: the command envelope.
 *
 * The command envelope is the payload contract of the durable command path:
 * every protocol command admitted to the DEP-003 durable queue (spec/durable/
 * execution.md — "a deduplicated enqueue path") travels as exactly one
 * envelope, and the envelope's (kind, idempotency key) pair is the queue's
 * dedupe identity.
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   26-29 (the record field contract the envelope's identity fields mirror):
 *     "EvidenceRecord — one immutable record per consequential operation.
 *      Fields (mandatory, exactly these five semantic slots):
 *      - what: operation type and subject object ids.
 *      - when: protocol time (sequenced) and recorded wall time.
 *      - authority: which protocol authority performed the operation."
 *   spec/architecture/v0.1/core.md §1 Area 1, lines 57-62 (the idempotency
 *   collapse the envelope's key enables):
 *     "INV-1-2 (concurrency): state transitions are serialized per intent
 *      id. Concurrent submissions carrying the same idempotency key collapse
 *      to one intent and one receipt.
 *      INV-1-3 (idempotency): re-submission with a recorded idempotency key
 *      returns the recorded receipt; it never creates a second intent or a
 *      second financial effect."
 *
 * Supporting contracts:
 *   spec/durable/execution.md §6, lines 125-133:
 *     "enqueue(kind, payload, { idempotencyKey, maxAttempts, availableAt })
 *      inserts with ON CONFLICT (idempotency_key, kind) DO NOTHING.
 *      The schema enforces UNIQUE (idempotency_key, kind): enqueueing the
 *      same (kind, idempotencyKey) twice results in exactly ONE row ...
 *      omitting the idempotency key opts the enqueue out of dedupe (intent
 *      without identity). Financially meaningful work MUST always carry a
 *      key derived from domain identity."
 *   spec/deployment/topology.md line 180 (the durable command path node):
 *     "Authority hosted: none — durable, at-least-once transport for
 *      protocol commands (the execution topology's 'durable command path'
 *      node); ordering and durability only; no financial semantics."
 *   spec/protocol-runtime-work-orders/RTN-001.md line 10 ("the command
 *   envelope (the payload contract of the durable command path)") and line
 *   16 ("Command envelope validates (authority target, subject ids,
 *   idempotency key, protocol time) and maps 1:1 onto the DEP-003 enqueue
 *   idempotency contract (UNIQUE (idempotency_key, kind))").
 *
 * The envelope carries no financial decision semantics: `body` is
 * authority-owned opaque data, and the kernel validates only the envelope's
 * own contract fields (kind, authority, subject ids, idempotency key,
 * protocol time). Financial decisions live in the authorities (GC-4).
 */

import { isProtocolTime } from './time.ts';
import type { ProtocolTime } from './time.ts';

/**
 * The command kind: the typed discriminant naming WHICH operation this
 * command is. Maps 1:1 onto the DEP-003 enqueue `kind` column, which is half
 * of the UNIQUE (idempotency_key, kind) dedupe identity.
 *
 * Source: A15 'what' slot — "operation type and subject object ids"
 * (evidence-risk-compliance.md line 27); DEP-003 enqueue contract
 * (spec/durable/execution.md §6 lines 125-129).
 */
export type CommandKind = string;

/**
 * The authority target: the protocol authority this command is addressed to
 * (e.g. the registry's owning authorities). The kernel validates presence
 * and shape only — the authority-name enumeration belongs to the registry
 * projection (spec/registry/protocol-registry.json) and its consumers
 * (RTN-002 binds evidence authority names; RTN-010 validates per-command
 * per owning authority).
 *
 * Source: A15 'authority' slot — "authority: which protocol authority
 * performed the operation" (evidence-risk-compliance.md line 29).
 */
export type ProtocolAuthorityId = string;

/**
 * A subject object id: the id of the protocol object the command concerns.
 *
 * Source: A15 'what' slot — "operation type and subject object ids"
 * (evidence-risk-compliance.md line 27).
 */
export type SubjectId = string;

/**
 * The idempotency key: REQUIRED and never null on a protocol command, so a
 * command can never opt out of the DEP-003 dedupe ("intent without
 * identity" is forbidden for protocol work — spec/durable/execution.md §6
 * lines 130-133). Derive it with the kernel's `deriveIdempotencyKey`.
 *
 * Source: INV-1-2/INV-1-3 (core.md lines 57-62) + DEP-003 §6.
 */
export type IdempotencyKey = string;

/**
 * The command envelope: the payload contract of the durable command path.
 *
 *   - kind           — typed discriminant; maps onto durable_jobs.kind.
 *   - authority      — the target protocol authority (admission routing).
 *   - subjectIds     — the subject object ids this command addresses (may be
 *                      empty: e.g. scheduler tick commands address no prior
 *                      subject object; every element must be a non-empty
 *                      string).
 *   - idempotencyKey — never null; maps onto durable_jobs.idempotency_key.
 *   - protocolTime   — the (sequenced, wall) protocol time of the command.
 *   - body           — authority-owned opaque payload (JSON-representable;
 *                      must not be `undefined` so the enqueue round-trip is
 *                      shape-stable).
 *
 * Sources: A15 slots (evidence-risk-compliance.md lines 26-29), INV-1-2/
 * INV-1-3 (core.md lines 57-62), DEP-003 §6 (spec/durable/execution.md
 * lines 125-133).
 */
export interface CommandEnvelope<TBody = unknown> {
  readonly kind: CommandKind;
  readonly authority: ProtocolAuthorityId;
  readonly subjectIds: readonly SubjectId[];
  readonly idempotencyKey: IdempotencyKey;
  readonly protocolTime: ProtocolTime;
  readonly body: TBody;
}

/**
 * Which envelope contract field failed validation. These are the fields the
 * envelope's own contract names (RTN-001 acceptance: "validates (authority
 * target, subject ids, idempotency key, protocol time)") — not protocol
 * reason codes (those live in reason-codes.ts and the areas).
 *
 * Source: RTN-001.md line 16; the A15 slot lines each field mirrors
 * (evidence-risk-compliance.md lines 27-29); DEP-003 §6 (idempotency key).
 */
export type CommandEnvelopeField =
  | 'kind'
  | 'authority'
  | 'subjectIds'
  | 'idempotencyKey'
  | 'protocolTime'
  | 'body';

/**
 * Validation outcome for a command envelope: either the validated envelope,
 * or the named field that failed with a deterministic problem description.
 *
 * Source: RTN-001.md line 16 ("Command envelope validates ...").
 */
export type CommandEnvelopeValidation =
  | { readonly ok: true; readonly envelope: CommandEnvelope }
  | { readonly ok: false; readonly field: CommandEnvelopeField; readonly problem: string };

/**
 * The exact input triple the DEP-003 queue consumes:
 * `enqueue(kind, payload, { idempotencyKey })`.
 *
 * Source: spec/durable/execution.md §6 lines 125-129 ("enqueue(kind,
 * payload, { idempotencyKey, maxAttempts, availableAt })").
 */
export interface KernelEnqueueInput {
  readonly kind: CommandKind;
  readonly payload: unknown;
  readonly idempotencyKey: IdempotencyKey;
}

const KIND_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a command envelope (any unknown value — e.g. a parsed queue
 * payload). Checks every contract field deterministically:
 *
 *   - kind: non-empty string, dot-separated lowercase segments
 *     (`area.verb` shape, e.g. `intent.create`) — the DEP-003 kind column is
 *     a TEXT key and this shape keeps kinds stable, sortable, and
 *     collision-free across authorities;
 *   - authority: non-empty string (and a member of `allowedAuthorities`
 *     when the option is provided);
 *   - subjectIds: an array of non-empty strings (empty allowed — see the
 *     interface doc);
 *   - idempotencyKey: a non-empty string (never null/undefined — a protocol
 *     command cannot opt out of dedupe);
 *   - protocolTime: a well-formed ProtocolTime (see time.ts);
 *   - body: present and not `undefined` (JSON round-trip stability).
 *
 * Source: RTN-001.md line 16; A15 slot contract (evidence-risk-compliance.md
 * lines 26-29); spec/durable/execution.md §6 lines 125-133.
 */
export function validateCommandEnvelope(
  value: unknown,
  options: { readonly allowedAuthorities?: readonly string[] } = {},
): CommandEnvelopeValidation {
  if (!isPlainObject(value)) {
    return { ok: false, field: 'kind', problem: 'envelope must be a plain object' };
  }
  const { kind, authority, subjectIds, idempotencyKey, protocolTime, body } = value;

  if (typeof kind !== 'string' || kind.length === 0) {
    return { ok: false, field: 'kind', problem: 'kind must be a non-empty string' };
  }
  if (!KIND_PATTERN.test(kind)) {
    return {
      ok: false,
      field: 'kind',
      problem: `kind must be dot-separated lowercase segments (got ${JSON.stringify(kind)})`,
    };
  }

  if (typeof authority !== 'string' || authority.length === 0) {
    return { ok: false, field: 'authority', problem: 'authority must be a non-empty string' };
  }
  if (
    options.allowedAuthorities !== undefined &&
    !options.allowedAuthorities.includes(authority)
  ) {
    return {
      ok: false,
      field: 'authority',
      problem: `authority ${JSON.stringify(authority)} is not an allowed authority target`,
    };
  }

  if (!Array.isArray(subjectIds)) {
    return { ok: false, field: 'subjectIds', problem: 'subjectIds must be an array' };
  }
  for (const subjectId of subjectIds) {
    if (typeof subjectId !== 'string' || subjectId.length === 0) {
      return {
        ok: false,
        field: 'subjectIds',
        problem: 'every subject id must be a non-empty string',
      };
    }
  }

  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    return {
      ok: false,
      field: 'idempotencyKey',
      problem: 'idempotencyKey must be a non-empty string (protocol commands never opt out of dedupe)',
    };
  }

  if (!isProtocolTime(protocolTime)) {
    return {
      ok: false,
      field: 'protocolTime',
      problem: 'protocolTime must be a well-formed ProtocolTime (non-negative integer sequence, integer wallMs)',
    };
  }

  if (body === undefined) {
    return {
      ok: false,
      field: 'body',
      problem: 'body must be present and JSON-representable (undefined is not a stable payload)',
    };
  }

  return {
    ok: true,
    envelope: {
      kind,
      authority,
      subjectIds: [...subjectIds] as readonly SubjectId[],
      idempotencyKey,
      protocolTime,
      body,
    },
  };
}

/**
 * Map a validated command envelope 1:1 onto the DEP-003 enqueue contract.
 *
 *   envelope.kind            ↔ enqueue kind           ↔ durable_jobs.kind
 *   envelope (full envelope) ↔ enqueue payload        ↔ durable_jobs.payload
 *   envelope.idempotencyKey  ↔ enqueue idempotencyKey ↔ durable_jobs.idempotency_key
 *
 * The dedupe identity is exactly the schema's UNIQUE (idempotency_key, kind):
 * enqueueing the same envelope twice results in exactly ONE durable_jobs row
 * (ON CONFLICT (idempotency_key, kind) DO NOTHING); because the envelope
 * REQUIRES a non-empty idempotency key, a protocol command can never take
 * the NULL-key dedupe opt-out.
 *
 * Source: spec/durable/execution.md §6 lines 125-133; RTN-001.md line 16
 * ("maps 1:1 onto the DEP-003 enqueue idempotency contract (UNIQUE
 * (idempotency_key, kind))").
 */
export function commandEnvelopeToEnqueueInput<TBody>(
  envelope: CommandEnvelope<TBody>,
): KernelEnqueueInput {
  const payload: CommandEnvelope<TBody> = {
    kind: envelope.kind,
    authority: envelope.authority,
    subjectIds: [...envelope.subjectIds],
    idempotencyKey: envelope.idempotencyKey,
    protocolTime: envelope.protocolTime,
    body: envelope.body,
  };
  return { kind: envelope.kind, payload, idempotencyKey: envelope.idempotencyKey };
}
