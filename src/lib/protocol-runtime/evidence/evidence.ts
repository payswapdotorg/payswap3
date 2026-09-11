/**
 * RTN-002 — Evidence Authority: public barrel.
 *
 * Owned surface: src/lib/protocol-runtime/evidence/ (work order RTN-002).
 * Every export cites its spec source in its module's doc-comments and in
 * CONTRACT-REVIEW.md (this directory).
 *
 * This barrel materializes the A15 Evidence Authority: the EvidenceRecord
 * (exactly the five mandatory semantic slots), the append-only, totally
 * sequenced, hash-chained EvidenceLog with deterministic verification, the
 * synchronous write discipline ("an operation is not committed until its
 * record is written. A failed write fails the operation"), the
 * EvidenceSubmission port IMPLEMENTATION (the kernel declared the type;
 * an EvidenceLog structurally satisfies it), and the evidence domain's
 * per-domain persistence on the DEP-003 database layer.
 *
 * Runtime note: like the kernel barrel, this barrel stays loadable in plain
 * Node with type stripping because every intra-domain runtime import uses
 * an explicit `.ts` specifier and the only cross-layer import
 * (persistence.ts → src/lib/durable/db.ts) does the same. That loadability
 * is what lets the RTN-002 evidence harness (scripts/test_protocol_
 * evidence.mjs) exercise the durable store against real SQLite without a
 * bundler — the same convention as scripts/test_protocol_kernel.mjs. The
 * bun test suites import the leaf modules directly (record/chain/log), not
 * this barrel, because Bun 1.3.14 does not implement node:sqlite (the
 * kernel's tests observe the same split for the same reason).
 */

export { canonicalJson } from './canonical.ts';

export {
  EVIDENCE_AUTHORITIES,
  EVIDENCE_AUTHORITY_NAME,
  EVIDENCE_LIFECYCLE_VOCABULARY,
  isEvidenceRecord,
  validateEvidenceSubmission,
  canonicalSubmissionEncoding,
  evidenceWriteKey,
  evidenceRecordId,
} from './record.ts';
export type { EvidenceRecord, EvidenceRecordProof } from './record.ts';

export {
  EVIDENCE_CHAIN_FORMAT_VERSION,
  EVIDENCE_VERIFICATION_REASON_CODES,
  GENESIS_PREDECESSOR_HASH,
  computeRecordHash,
  verifyEvidenceChain,
} from './chain.ts';
export type {
  ChainDivergence,
  ChainDivergenceProblem,
  ChainVerification,
} from './chain.ts';

export {
  createEvidenceLog,
  commitWithEvidence,
  verificationLifecycleSubmission,
} from './log.ts';
export type { EvidenceLog, EvidenceLogOptions } from './log.ts';

export {
  DEFAULT_EVIDENCE_DB_PATH,
  EVIDENCE_MIGRATIONS_DIR_ENV_VAR,
  EVIDENCE_MIGRATIONS_RELATIVE_DIR,
  EVIDENCE_STORE_DOMAIN,
  resolveEvidenceMigrationsDir,
  openEvidenceStore,
  writeEvidenceRecord,
  readEvidenceRecords,
} from './persistence.ts';
export type { EvidenceStoreOptions, EvidenceStoreWrite } from './persistence.ts';
