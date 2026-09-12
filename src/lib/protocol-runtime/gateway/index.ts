/**
 * RTN-010 — Protocol gateway: public barrel and the module boundary
 * contract.
 *
 * Owned surface: src/lib/protocol-runtime/gateway/ (work order RTN-010).
 * Every export cites its spec source in its module's doc-comments and in
 * CONTRACT-REVIEW.md (this directory); the command surface consumed by
 * future product-port re-anchoring is documented in COMMAND-SURFACE.md
 * (the UI-011 ledger item — rtn-plan-rulings.md Q5/delta 6).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE BOUNDARY CONTRACT — the sole admission point
 * ═══════════════════════════════════════════════════════════════════════
 *
 * "There is exactly one protocol-command admission point (protocol-
 * gateway)" (spec/deployment/topology.md line 231); deploy/contracts/
 * components.json protocol-gateway is "the sole admission point for
 * protocol commands". This module IS that point in its in-process form,
 * and the boundary is ENFORCED, not merely declared:
 *
 *   1. THE ONLY admission call: `ProtocolGateway.submitCommand` is the
 *      single function other code may call to submit a protocol command.
 *      Nothing else in src/lib/protocol-runtime/ — and nothing in
 *      src/lib/durable/ — accepts protocol commands for admission; the
 *      substrate's public enqueue API is a transport primitive, and the
 *      boundary review (boundary.test.ts) mechanically verifies that no
 *      module outside this prefix and the substrate's own tests/scripts
 *      calls enqueue or references DurableQueue.
 *   2. NO EXECUTION: the gateway validates and submits onto the durable
 *      command path; it executes no authority command method and mutates
 *      no authoritative state ("no financial effect occurs at admission —
 *      effects occur only via the transition path", RTN-010.md line 14;
 *      the transition path is RTN-011's owned surface; single-writer
 *      violation is RTN-010's stop condition).
 *   3. NO AUTHORITY: the gateway implements no identity or market
 *      authority — and no authority of any kind (rtn-plan-rulings.md Q4,
 *      delta 4: subject validation is per-command per owning authority);
 *      its registry routes validation to the OWNING authority's exported
 *      schemas, and its rejection evidence attributes to the owning (or
 *      addressed) authority, never to a gateway-invented name.
 *   4. PRODUCT SPLICE IS GOVERNED: nothing under src/app/ or
 *      src/lib/protocol/ imports this module (verified by the boundary
 *      review); wiring the web boundary to the gateway is the UI-011
 *      product-program work item (rtn-plan-rulings.md Q5/delta 6), a
 *      separate governed splice.
 *
 * Future consumers (RTN-011's transition runtime resolves handlers for
 * admitted kinds; RTN-012's composed golden path; UI-011's product-port
 * re-anchoring) consume the registry, the receipts, and the health
 * functions exported here — and submit exclusively through
 * ProtocolGateway.submitCommand.
 *
 * Runtime note: like every RTN barrel, this barrel stays loadable in plain
 * Node with type stripping (explicit .ts specifiers; the only cross-layer
 * import — persistence.ts → src/lib/durable/db.ts, and admission.ts's
 * type-only DurableQueue reference — follows the read-only integration
 * rule). The bun test suites import the leaf modules directly for the same
 * Bun/node:sqlite split the other domains observe.
 */

// --- reason-codes.ts — the admission reason-code vocabulary ----------------
export {
  GATEWAY_ADMISSION_REASON_CODES,
  isGatewayAdmissionReasonCode,
} from './reason-codes.ts';
export type { GatewayAdmissionReasonCode } from './reason-codes.ts';

// --- schema.ts — the command-body schema language --------------------------
export type {
  FieldProblem,
  FieldCheck,
  FieldSpec,
  OptionalField,
  BodyInvariant,
  BodyValidation,
} from './schema.ts';

// --- receipts.ts — the generalized IntentReceipt ---------------------------
export {
  GATEWAY_ADMISSION_STATES,
  GATEWAY_ADMISSION_OUTCOMES,
  commandReceiptId,
  commandReceipt,
  isCommandReceipt,
} from './receipts.ts';
export type {
  GatewayAdmissionState,
  GatewayAdmissionOutcome,
  CommandReceipt,
} from './receipts.ts';

// --- registry.ts — the per-authority command-kind registry -----------------
export {
  GATEWAY_COMMAND_AUTHORITIES,
  GATEWAY_ENVELOPE_AUTHORITIES,
  GATEWAY_EVIDENCE_AUTHORITY_BY_ENVELOPE,
  GATEWAY_COMMAND_KIND_COUNT,
  findAuthorityCommands,
  findCommandSpec,
  subjectFields,
  noSubjects,
} from './registry.ts';
export type { CommandSpec, AuthorityCommands, SubjectResolver, SubjectResolution } from './registry.ts';

// --- evidence.ts — rejection evidence through the A15 port -----------------
export {
  GATEWAY_EVIDENCE_VOCABULARY,
  GATEWAY_UNKNOWN_SUBJECT_TOKEN,
  resolveEvidenceAuthority,
  commandRejectedEvidence,
  submitGatewayEvidence,
} from './evidence.ts';

// --- admission.ts — the gateway itself --------------------------------------
export {
  ProtocolGateway,
  commandQueuePortFromDurableQueue,
} from './admission.ts';
export type {
  CommandQueuePort,
  CommandQueueEnqueueOutcome,
  CommandAdmissionResult,
  ProtocolGatewayDeps,
  GatewayHealthSnapshot,
} from './admission.ts';

// --- persistence.ts — the per-domain receipt store --------------------------
export {
  DEFAULT_GATEWAY_DB_PATH,
  GATEWAY_MIGRATIONS_DIR_ENV_VAR,
  GATEWAY_MIGRATIONS_RELATIVE_DIR,
  GATEWAY_STORE_DOMAIN,
  resolveGatewayMigrationsDir,
  openGatewayStore,
  writeCommandReceipt,
  readCommandReceipts,
} from './persistence.ts';
export type {
  GatewayStoreOptions,
  StoredCommandReceipt,
  GatewayReceiptWrite,
} from './persistence.ts';
