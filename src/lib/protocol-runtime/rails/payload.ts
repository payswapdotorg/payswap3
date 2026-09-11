/**
 * RTN-004 — Rails: canonical operation-payload encoding and hashing.
 *
 * Spec source (binding) — spec/architecture/v0.1/
 * rails-adapters-reconciliation.md §1 Area 13:
 *   line 63-65 (INV-13-2, financial correctness):
 *     "operation payloads carry integer Money verbatim from the
 *      authorization; payload hash is recorded at submission and re-checked
 *      on every report."
 *   line 47-48 (RailResultReport): "payload proof (hash)".
 *   line 90-92 (Evidence, RAIL_OP_AUTHORIZED): "(instruction link, payload
 *    hash, idempotency key)".
 * spec/architecture/v0.1/README.md §3 GC-1 lines 39-43 (integer money, no
 * floating point; identical inputs yield identical outputs).
 * spec/architecture/v0.1/clearing-netting-settlement.md §4 Area 12, lines
 * 251-253 (INV-12-1): "the rail operation payload hash is recorded and
 * compared on result".
 *
 * Method: the SAME unambiguous length-prefixed canonical encoding the
 * RTN-001 kernel uses for identity derivation (identity.ts
 * canonicalDerivationInput), applied to the payload's semantic fields, then
 * sha256. Length prefixes make ('ab','c') and ('a','bc') encode differently,
 * so distinct payloads can never collide into one hash. The encoding is
 * versioned (`v1`) so a future format change is detectable in every stored
 * hash's input.
 */

import { createHash } from 'node:crypto';
import { money, isMoney } from '../kernel/money.ts';
import type { Money } from '../kernel/money.ts';
import type { RailOperationPayload } from './types.ts';

/**
 * Version of the payload canonical encoding. Part of the hashed input.
 *
 * Source: INV-13-2 requires the recorded hash to be re-checkable — a
 * versioned input keeps future format changes detectable.
 */
export const RAIL_PAYLOAD_ENCODING_VERSION = 1;

function fail(message: string): never {
  throw new TypeError(message);
}

function encodePart(part: string, index: number): string {
  if (typeof part !== 'string') {
    fail(`railPayload: part ${index} must be a string (got ${typeof part})`);
  }
  if (part.length === 0 && index > 0) {
    fail(`railPayload: part ${index} must be non-empty`);
  }
  return `s${part.length}:${part}`;
}

/**
 * Canonical, versioned encoding of an operation payload: the instruction
 * link, the Money (verbatim — currency, signed integer minor units, scale),
 * the beneficiary, and the optional memo (absent and empty-string memo are
 * distinct: the memo part is included iff present).
 *
 * Source: INV-13-2 (lines 63-65) — payload identity must be exact for the
 * recorded hash to be re-checkable on every report.
 */
export function canonicalRailPayload(payload: RailOperationPayload): string {
  if (payload === null || typeof payload !== 'object') {
    fail('railPayload: payload must be an object');
  }
  const { instructionId, money: moneyValue, beneficiary, memo } = payload;
  if (typeof instructionId !== 'string' || instructionId.length === 0) {
    fail('railPayload: instructionId must be a non-empty string');
  }
  if (!isMoney(moneyValue)) {
    fail('railPayload: money must be well-formed kernel Money (GC-1 integer Money verbatim)');
  }
  if (typeof beneficiary !== 'string' || beneficiary.length === 0) {
    fail('railPayload: beneficiary must be a non-empty string');
  }
  if (memo !== undefined && typeof memo !== 'string') {
    fail('railPayload: memo, when present, must be a string');
  }
  const parts: string[] = [
    encodePart(instructionId, 0),
    encodePart(moneyValue.currency, 1),
    `n:${moneyValue.amountMinor}`,
    `n:${moneyValue.scale}`,
    encodePart(beneficiary, 4),
    `m:${memo === undefined ? '0' : `1${memo.length}:${memo}`}`,
  ];
  return `v${RAIL_PAYLOAD_ENCODING_VERSION}|${parts.join('|')}`;
}

/**
 * The payload proof hash: sha256 (hex) over the canonical encoding. This is
 * the value recorded at authorization, recorded at submission, re-checked on
 * every report (INV-13-2) and carried on every RailResultReport as "payload
 * proof (hash)".
 *
 * Source: rails-adapters-reconciliation.md lines 47-48, 63-65.
 */
export function hashRailPayload(payload: RailOperationPayload): string {
  return createHash('sha256').update(canonicalRailPayload(payload), 'utf8').digest('hex');
}

/**
 * Validate and mint the payload for a new rail operation: the Money must be
 * exact kernel Money (GC-1), the instruction link and beneficiary non-empty
 * strings. Returns the validated payload (money re-minted through the
 * kernel's single public mint so ill-formed values are rejected here, at the
 * boundary, deterministically).
 *
 * Source: INV-13-2 (money verbatim from the authorization); GC-1 (README.md
 * §3 lines 39-43); GC-3 (instruction link — README.md §3 lines 51-55).
 */
export function validateRailOperationPayload(value: unknown): RailOperationPayload {
  if (value === null || typeof value !== 'object') {
    fail('validateRailOperationPayload: payload must be an object');
  }
  const candidate = value as Partial<RailOperationPayload> & { money?: unknown };
  if (typeof candidate.instructionId !== 'string' || candidate.instructionId.length === 0) {
    fail('validateRailOperationPayload: instructionId must be a non-empty string (the GC-3 authorization link)');
  }
  if (!isMoney(candidate.money)) {
    fail('validateRailOperationPayload: money must be well-formed kernel Money');
  }
  const minted: Money = money(
    candidate.money.currency,
    candidate.money.amountMinor,
    candidate.money.scale,
  );
  if (typeof candidate.beneficiary !== 'string' || candidate.beneficiary.length === 0) {
    fail('validateRailOperationPayload: beneficiary must be a non-empty string');
  }
  if (candidate.memo !== undefined && typeof candidate.memo !== 'string') {
    fail('validateRailOperationPayload: memo, when present, must be a string');
  }
  const payload: RailOperationPayload = candidate.memo === undefined
    ? {
        instructionId: candidate.instructionId,
        money: minted,
        beneficiary: candidate.beneficiary,
      }
    : {
        instructionId: candidate.instructionId,
        money: minted,
        beneficiary: candidate.beneficiary,
        memo: candidate.memo,
      };
  return payload;
}
