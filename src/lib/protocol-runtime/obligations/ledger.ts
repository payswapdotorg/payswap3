/**
 * RTN-008 — Obligation Ledger Authority: the ObligationLedger — the
 * append-only, totally sequenced log of obligation records and
 * transitions (A10's core object; the protocol's single financial truth,
 * GC-4).
 *
 * Spec sources (binding) — spec/architecture/v0.1/
 * clearing-netting-settlement.md §2 Area 10:
 *   lines 104-106 (ObligationLedger, verbatim):
 *     "ObligationLedger — append-only, totally sequenced log of
 *      obligation records and transitions."
 *   lines 80-87 (Purpose — "This ledger is the protocol's financial
 *     truth (GC-4); every downstream netting or settlement fact is a
 *     projection of it.").
 *   lines 108-111 (Owning authority — "the single financial authority
 *     for debt state (GC-4). No product or deployment component writes
 *     or duplicates this ledger.").
 *   lines 113-118 (INV-10-1 / INV-10-2, verbatim):
 *     "INV-10-1 (financial correctness): obligations are integer Money
 *      per currency; the ledger never mutates an amount after creation —
 *      corrections are new linked obligations.
 *      INV-10-2 (concurrency): ledger transitions are serialized by
 *      sequence; each obligation transitions at most once per state."
 *   lines 119-123 (INV-10-4 — the authority gate this ledger's audit
 *     re-checks over the written content).
 *   spec/architecture/v0.1/README.md §3 GC-4 lines 57-61.
 *
 * Design (recorded in CONTRACT-REVIEW.md):
 *   - INV-10-1 at the value layer: entries are deep-frozen at append; the
 *     entries() snapshot is a frozen copy, so previously obtained
 *     snapshots never change under the caller; the ledger interface has
 *     NO update, delete, clear, or truncate member (the mutation paths
 *     are unrepresentable in the API surface itself — the RTN-002
 *     EvidenceLog precedent).
 *   - INV-10-2 at the order layer: the ledger mints ONE gapless total
 *     sequence (0, 1, 2, ...) shared by creation and transition entries.
 *     The write protocol: the authority PEEKS the next sequence (to mint
 *     the entry and its evidence record's protocol time), submits the
 *     A15 evidence, and only then APPENDS — appendEntry asserts the
 *     entry's sequence equals the next position, so a failed evidence
 *     write leaves the sequence gapless ("totally sequenced" holds even
 *     across failed operations). The projection (fold / foldOne) is the
 *     deterministic fold of the entry log; sequenceInvariant() and
 *     inv10_4Audit() are the machine checks over the actual log.
 *   - Single-writer discipline: appendEntry/peekNextSequence are the
 *     AUTHORITY's state-carrier arms (the merged RailsStore precedent:
 *     the store/ledger is exported for reads, composition, and
 *     persistence; the authority is the disciplined single writer — "No
 *     product or deployment component writes or duplicates this
 *     ledger").
 */

import type { ProtocolTime } from '../kernel/time.ts';
import { deepFreeze } from './freeze.ts';
import type {
  ObligationLedgerEntry,
  ObligationRecord,
} from './types.ts';
import {
  INV_10_4_AUTHORITY_GATE,
  OBLIGATION_INSTRUCTION_KINDS,
  OBLIGATION_TERMINAL_STATES,
} from './types.ts';

// The gate lookups (module-private: the gate table itself is the public
// machine check; these are the ledger's internal read arms).
const INV_10_4_CREATION_PATH_SET = new Set<string>(
  OBLIGATION_INSTRUCTION_KINDS.filter((kind) => INV_10_4_AUTHORITY_GATE[kind].creates),
);
const INV_10_4_TERMINAL_SET = new Set<string>(OBLIGATION_TERMINAL_STATES);

function inv10_4TerminalizerOf(terminal: string): string {
  for (const kind of OBLIGATION_INSTRUCTION_KINDS) {
    if (INV_10_4_AUTHORITY_GATE[kind].terminalizes === terminal) {
      return kind;
    }
  }
  return '<none>';
}

/**
 * The ObligationLedger: append-only, totally sequenced. The authority
 * (authority.ts) is the ONLY writer — it peeks, submits the A15 record,
 * and appends inside its serializer.
 *
 * There is deliberately NO update, delete, clear, or truncate member
 * (INV-10-1 — the mutation paths are unrepresentable in the surface).
 *
 * Source: clearing-netting-settlement.md lines 104-106, 113-118.
 */
export class ObligationLedger {
  private readonly entries: ObligationLedgerEntry[] = [];
  private readonly byId = new Map<string, ObligationLedgerEntry[]>();
  private nextSequence = 0;

  /** Total number of entries written (the log height). */
  get height(): number {
    return this.entries.length;
  }

  /**
   * Peek the next total sequence position WITHOUT consuming it. The
   * authority peeks to mint the entry and its evidence record's protocol
   * time, submits the A15 record, and only then appends — so a failed
   * evidence write leaves the sequence gapless.
   *
   * Source: clearing-netting-settlement.md lines 104-106, 117-118; A15
   * lines 62-64 (the write-first-then-commit discipline).
   */
  peekNextSequence(): number {
    return this.nextSequence;
  }

  /**
   * Append one pre-minted entry (the authority's write arm). Asserts the
   * entry's sequence equals the next position (gapless total order);
   * deep-freezes the entry; indexes it. Returns the frozen entry.
   *
   * Source: clearing-netting-settlement.md lines 104-106, 117-118
   * (INV-10-2 — "serialized by sequence").
   */
  appendEntry(entry: ObligationLedgerEntry): ObligationLedgerEntry {
    if (entry.sequence !== this.nextSequence) {
      throw new TypeError(
        `obligation ledger: entry sequence ${entry.sequence} violates the gapless total order (next position is ${this.nextSequence})`,
      );
    }
    const frozen = deepFreeze({ ...entry });
    this.nextSequence += 1;
    this.entries.push(frozen);
    const existing = this.byId.get(frozen.obligationId);
    if (existing === undefined) {
      this.byId.set(frozen.obligationId, [frozen]);
    } else {
      existing.push(frozen);
    }
    return frozen;
  }

  /** Immutable snapshot of all entries in total sequence order. */
  entriesSnapshot(): readonly ObligationLedgerEntry[] {
    return deepFreeze([...this.entries]) as readonly ObligationLedgerEntry[];
  }

  /** The entry at a sequence position, if written. */
  entryAt(sequence: number): ObligationLedgerEntry | undefined {
    return sequence >= 0 && sequence < this.entries.length ? this.entries[sequence] : undefined;
  }

  /** All entries touching one obligation id, in sequence order (frozen). */
  entriesFor(obligationId: string): readonly ObligationLedgerEntry[] {
    return Object.freeze([...(this.byId.get(obligationId) ?? [])]);
  }

  /**
   * The projection: the fold of the entire entry log in sequence order —
   * the current obligation records. Deterministic from the entries
   * (GC-1): identical entry logs fold to identical projections.
   *
   * Source: clearing-netting-settlement.md lines 80-87 ("every
   * downstream netting or settlement fact is a projection of it").
   */
  fold(): readonly ObligationRecord[] {
    const records = new Map<string, ObligationRecord>();
    for (const entry of this.entries) {
      this.foldEntryInto(records, entry);
    }
    return Object.freeze([...records.values()]);
  }

  /**
   * The projection for ONE obligation: the fold of its entries in
   * sequence order. Deterministic (GC-1).
   *
   * Source: clearing-netting-settlement.md lines 80-87, 104-106.
   */
  foldOne(obligationId: string): ObligationRecord | undefined {
    const entries = this.byId.get(obligationId);
    if (entries === undefined || entries.length === 0) {
      return undefined;
    }
    const records = new Map<string, ObligationRecord>();
    for (const entry of entries) {
      this.foldEntryInto(records, entry);
    }
    return records.get(obligationId);
  }

  /**
   * INV-10-2's machine check: the written entry log is totally sequenced
   * (every entry's sequence equals its position, 0..n-1) and each
   * obligation transitions at most once per state (no from-state repeats
   * per obligation — structural under the one-way DAG, re-checked here
   * against the actual log).
   *
   * Source: clearing-netting-settlement.md lines 117-118.
   */
  sequenceInvariant(): boolean {
    for (let position = 0; position < this.entries.length; position += 1) {
      const entry = this.entries[position] as ObligationLedgerEntry;
      if (entry.sequence !== position) {
        return false;
      }
    }
    const transitionsByObligation = new Map<string, Set<string>>();
    for (const entry of this.entries) {
      if (entry.kind !== 'OBLIGATION_TRANSITIONED') {
        continue;
      }
      let perObligation = transitionsByObligation.get(entry.obligationId);
      if (perObligation === undefined) {
        perObligation = new Set<string>();
        transitionsByObligation.set(entry.obligationId, perObligation);
      }
      if (perObligation.has(entry.from)) {
        return false; // a second transition out of the same state
      }
      perObligation.add(entry.from);
    }
    return true;
  }

  /**
   * INV-10-4's content-level machine check over the WRITTEN log: every
   * creation entry's path is a gate creation kind, and every transition
   * entry's kind is exactly the gate's terminalizer for its terminal
   * target (or a lifecycle kind targeting a non-terminal state).
   *
   * Source: clearing-netting-settlement.md lines 119-123.
   */
  inv10_4Audit(): {
    readonly holds: boolean;
    readonly violations: readonly string[];
  } {
    const violations: string[] = [];
    for (const entry of this.entries) {
      if (entry.kind === 'OBLIGATION_CREATED') {
        if (!INV_10_4_CREATION_PATH_SET.has(entry.createdBy)) {
          violations.push(
            `creation entry ${entry.sequence} path ${entry.createdBy} is not an INV-10-4 creation path`,
          );
        }
        continue;
      }
      const gateRow = INV_10_4_AUTHORITY_GATE[entry.instructionKind];
      if (gateRow === undefined) {
        violations.push(
          `transition entry ${entry.sequence} kind ${entry.instructionKind} is outside the closed instruction set`,
        );
        continue;
      }
      const isTerminalTarget = INV_10_4_TERMINAL_SET.has(entry.to);
      if (isTerminalTarget && gateRow.terminalizes !== entry.to) {
        violations.push(
          `transition entry ${entry.sequence} terminalized ${entry.to} via ${entry.instructionKind} — the gate's terminalizer for ${entry.to} is ${inv10_4TerminalizerOf(entry.to)}`,
        );
      }
      if (!isTerminalTarget && gateRow.terminalizes !== null) {
        violations.push(
          `transition entry ${entry.sequence} via ${entry.instructionKind} terminalizes ${gateRow.terminalizes} but targeted non-terminal ${entry.to}`,
        );
      }
    }
    return Object.freeze({
      holds: violations.length === 0,
      violations: Object.freeze([...violations]),
    });
  }

  private foldEntryInto(
    records: Map<string, ObligationRecord>,
    entry: ObligationLedgerEntry,
  ): void {
    if (entry.kind === 'OBLIGATION_CREATED') {
      records.set(
        entry.obligationId,
        Object.freeze({
          obligationId: entry.obligationId,
          terms: entry.terms,
          origin: entry.origin,
          ...(entry.linkedPriorObligationId !== undefined
            ? { linkedPriorObligationId: entry.linkedPriorObligationId }
            : {}),
          state: 'CREATED',
          createdAt: entry.when,
          stateChangedAt: entry.when,
        }),
      );
      return;
    }
    const prior = records.get(entry.obligationId);
    if (prior === undefined) {
      // A transition for an obligation the log never created is a
      // corrupt log — the fold fails loudly (the same corrupt-log
      // convention the RTN-007 position fold applies).
      throw new TypeError(
        `obligation ledger: corrupt log — transition for unknown obligation ${entry.obligationId}`,
      );
    }
    records.set(
      entry.obligationId,
      Object.freeze({
        ...prior,
        state: entry.to,
        stateChangedAt: entry.when,
      }),
    );
  }
}

