/**
 * RTN-005 — Intent Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/intent/ (work order RTN-005,
 * area 1). Every export cites its spec/architecture/v0.1/ source in its
 * module's doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A01 Intent Authority: the PaymentIntent
 * state machine (DRAFT -> AUTHORIZED -> ROUTED -> FULFILLING ->
 * terminal(FULFILLED | FAILED | CANCELLED), one-way, retry-as-new-intent),
 * the immutable DemandDescriptor attached at DRAFT, the idempotent
 * IntentReceipt, INV-1-1/INV-1-2/INV-1-3 (terms fixed at authorization,
 * per-intent-id serialization with idempotency-key collapse, recorded-key
 * receipt replay), compliance gating before AUTHORIZED through the RTN-003
 * gate interface, and A01's evidence records submitted to the REAL RTN-002
 * A15 log through the kernel-declared EvidenceSubmission port.
 *
 * Runtime note: like the kernel and evidence barrels, this barrel stays
 * loadable in plain Node with type stripping because every intra-domain
 * runtime import uses an explicit `.ts` specifier and the only cross-layer
 * runtime import (persistence.ts -> src/lib/durable/db.ts) does the same.
 * The bun test suites import the leaf modules directly (not this barrel)
 * because Bun 1.3.14 does not implement node:sqlite — the same split the
 * kernel, evidence, risk, and rails domains observe.
 */

// --- types.ts — the A01 vocabulary and state machine tables -----------------
export {
  INTENT_STATES,
  INTENT_TRANSITIONS,
  INTENT_REASON_CODES,
  INTENT_REJECTION_CODES,
  isIntentState,
  canTransitionIntent,
  isIntentReasonCode,
} from './types.ts';
export type {
  IntentState,
  IntentReasonCode,
  IntentRejectionCode,
  EndpointDescriptor,
  DemandConstraints,
  DemandDescriptor,
  PaymentIntent,
  IntentReceipt,
  IntentSubmissionResult,
  IntentTransitionResult,
} from './types.ts';

// --- descriptor.ts — the immutable demand attachment ------------------------
export {
  DEMAND_DESCRIPTOR_HASH_FORMAT_VERSION,
  endpointDescriptor,
  demandConstraints,
  demandDescriptor,
  canonicalDemandDescriptor,
  demandDescriptorHash,
  demandDescriptorEquals,
} from './descriptor.ts';

// --- state-machine.ts — pure transition application -------------------------
export {
  transitionPaymentIntent,
  requiresReasonCode,
  checkIntentReasonCode,
  draftPaymentIntent,
  protocolTime,
} from './state-machine.ts';

// --- serializer.ts — INV-1-2 keyed serialization ----------------------------
export { KeyedSerializer } from './serializer.ts';

// --- evidence.ts — A01 records through the port to the real log -------------
export {
  INTENT_AUTHORITY_ID,
  INTENT_EVIDENCE_VOCABULARY,
  intentCreatedEvidence,
  intentAuthorizedEvidence,
  intentStateChangedEvidence,
  submitIntentEvidence,
} from './evidence.ts';

// --- authority.ts — the composed single-writer command surface --------------
export { IntentAuthority } from './authority.ts';
export type {
  IntentAuthorizationGate,
  IntentAuthorityDeps,
} from './authority.ts';

// --- persistence.ts — the intent-domain store (DEP-003, read-only) ----------
export {
  DEFAULT_INTENT_DB_PATH,
  INTENT_MIGRATIONS_DIR_ENV_VAR,
  INTENT_MIGRATIONS_RELATIVE_DIR,
  INTENT_STORE_DOMAIN,
  resolveIntentMigrationsDir,
  openIntentStore,
  writePaymentIntent,
  writeIntentState,
  writeIntentReceipt,
  readPaymentIntents,
  readIntentReceipts,
} from './persistence.ts';
export type { IntentStoreOptions, IntentStoreWrite } from './persistence.ts';
