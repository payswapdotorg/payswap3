/**
 * RTN-001 — Protocol runtime kernel: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/kernel/ (work order RTN-001).
 * Every export cites its spec/architecture/v0.1/ source in its module's
 * doc-comments and in CONTRACT-REVIEW.md (this directory).
 *
 * The kernel is the area-agnostic foundation every protocol authority
 * builds on: Money and MoneyBag (core.md §0), protocol time (A15 'when'),
 * deterministic identity derivation (the INV idempotency contracts), the
 * command envelope (the payload contract of the durable command path), the
 * shared reason-code vocabulary (§0/GC-2), the EvidenceSubmission port
 * declaration (A15), and the per-domain persistence convention on the
 * DEP-003 database layer.
 *
 * The kernel hosts NO financial authority: it makes no financial decisions,
 * owns no protocol state objects, and adds no semantics beyond v0.1 §0
 * (GC-4 — "The protocol layer is the single financial authority", and the
 * substrate's rule — spec/durable/execution.md §1: "It is NOT, and must
 * never become: a financial authority").
 *
 * Runtime note: unlike the substrate barrel (src/lib/durable/index.ts),
 * which requires a module bundler, this barrel stays loadable in plain Node
 * with type stripping because every intra-kernel runtime import uses an
 * explicit `.ts` specifier and the only cross-layer import
 * (persistence.ts → src/lib/durable/db.ts) does the same. That loadability
 * is what lets the RTN evidence harness (scripts/test_protocol_kernel.mjs)
 * exercise the kernel — including the persistence convention against real
 * SQLite — without a bundler, mirroring how scripts/test_durable.mjs
 * exercises the substrate.
 */

export {
  money,
  isMoney,
  addMoney,
  subtractMoney,
  negateMoney,
  compareMoney,
  moneyEquals,
  isZeroMoney,
  moneyBag,
  emptyMoneyBag,
  moneyBagFromMoney,
  addMoneyBags,
  subtractMoneyBags,
  moneyBagEquals,
} from './money.ts';
export type {
  MinorUnits,
  CurrencyCode,
  DecimalScale,
  Money,
  MoneyBagEntry,
  MoneyBag,
} from './money.ts';

export { protocolTime, isProtocolTime } from './time.ts';
export type { SequencedPosition, WallEpochMs, ProtocolTime } from './time.ts';

export {
  DERIVATION_FORMAT_VERSION,
  canonicalDerivationInput,
  deriveProtocolId,
  deriveIdempotencyKey,
  isDerivedProtocolId,
  isDerivedIdempotencyKey,
} from './identity.ts';
export type { DerivationPart, DerivedProtocolId, DerivedIdempotencyKey } from './identity.ts';

export {
  validateCommandEnvelope,
  commandEnvelopeToEnqueueInput,
} from './envelope.ts';
export type {
  CommandKind,
  ProtocolAuthorityId,
  SubjectId,
  IdempotencyKey,
  CommandEnvelope,
  CommandEnvelopeField,
  CommandEnvelopeValidation,
  KernelEnqueueInput,
} from './envelope.ts';

export { SHARED_REASON_CODES, isSharedReasonCode } from './reason-codes.ts';
export type { SharedReasonCode } from './reason-codes.ts';

export type {
  EvidenceWhat,
  EvidenceOutcome,
  EvidenceProof,
  EvidenceSubmissionRecord,
  EvidenceSubmission,
} from './ports.ts';

export {
  DEFAULT_KERNEL_DB_PATH,
  KERNEL_MIGRATIONS_DIR_ENV_VAR,
  KERNEL_MIGRATIONS_RELATIVE_DIR,
  KERNEL_STORE_DOMAIN,
  resolveKernelMigrationsDir,
  openKernelStore,
} from './persistence.ts';
export type { KernelStoreOptions } from './persistence.ts';
