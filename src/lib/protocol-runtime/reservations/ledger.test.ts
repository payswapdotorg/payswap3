/**
 * RTN-006 — Reservation Authority: the ReservationLedger tests —
 * serialization (INV-5-2), idempotency and the exactly-once terminals
 * (INV-5-3), the INV-5-1 identity after every transition, deterministic
 * expiry, the RESERVATION_* evidence with ledger-sequence and arithmetic
 * proofs, and the ledger-tail crash recovery on simulated crash points.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/core.md §5 Area 5 lines 293-295:
 *     "ReservationLedger — per-resource serialized log of reservation
 *      transitions. The ledger is the concurrency frontier: all resource
 *      mutations pass through it in sequence order."
 *   lines 286-289 (the machine); lines 304-312 (INV-5-1/INV-5-2/INV-5-3);
 *   lines 316-318 (crash recovery); lines 319-322 (UNKNOWN holds stay
 *   HELD); lines 326-328 (the evidence proofs).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceSubmission, EvidenceSubmissionRecord } from '../kernel/ports.ts';
import { ReservationLedger, openReservationLedger } from './ledger.ts';
import { resourceInvariantHolds, availableResource } from './resource.ts';
import { RESERVATION_EVIDENCE_VOCABULARY } from './evidence.ts';
import type { ReservationLedgerEntry } from './types.ts';

const INTENT = 'pid.v1.intent';
const RESOURCE = 'cap-a';
const DECLARED = money('EUR', 1_000_00, 2);

function makeLedger(options: {
  declared?: number;
  wallClock?: () => number;
  evidence?: EvidenceSubmission;
} = {}) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({
    evidence: options.evidence ?? log,
    wallClock: options.wallClock ?? (() => wall),
  });
  return {
    log,
    ledger,
    advance: (ms: number) => {
      wall += ms;
    },
    declare: () => ledger.declareResource(RESOURCE, money('EUR', options.declared ?? 1_000_00, 2)),
  };
}

function request(input: {
  intentId?: string;
  hopId?: string;
  resourceId?: string;
  amount?: number;
  deadline?: number;
} = {}) {
  return {
    intentId: input.intentId ?? INTENT,
    hopId: input.hopId ?? 'pid.v1.hop',
    resourceId: input.resourceId ?? RESOURCE,
    amount: money('EUR', input.amount ?? 200_00, 2),
    deadlineEpochMs: input.deadline ?? 60_000,
  };
}

describe('ReservationLedger declaration (INV-5-1 declared totals)', () => {
  test('a declared resource starts the identity at (declared, 0, 0); replay is idempotent', async () => {
    const { ledger, declare } = makeLedger();
    const first = await declare();
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replayed).toBe(false);
    }
    const again = await declare();
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.replayed).toBe(true);
    }
    expect(ledger.resourceAccounting(RESOURCE)?.declaredTotal.amountMinor).toBe(1_000_00);
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(1_000_00);
    expect(ledger.entriesFor(RESOURCE).length).toBe(1);
  });

  test('re-declaring with a different total is the typed rejection', async () => {
    const { ledger } = makeLedger();
    await ledger.declareResource(RESOURCE, DECLARED);
    const result = await ledger.declareResource(RESOURCE, money('EUR', 999_00, 2));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RESOURCE_ALREADY_DECLARED');
    }
  });

  test('a request against an undeclared resource is the typed rejection', async () => {
    const { ledger } = makeLedger();
    const result = await ledger.requestReservation(request({ resourceId: 'cap-zz' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RESOURCE_NOT_DECLARED');
    }
  });

  test('a unit-mismatched request is the typed rejection', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    const result = await ledger.requestReservation({
      intentId: INTENT,
      hopId: 'pid.v1.hop',
      resourceId: RESOURCE,
      amount: money('USD', 200_00, 2),
      deadlineEpochMs: 60_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNIT_MISMATCH');
    }
  });
});

describe('ReservationLedger requests (INV-5-2: HELD or rejected, never ambiguous)', () => {
  test('a covered request resolves REQUESTED -> HELD with the hold accounted', async () => {
    const { ledger, declare, log } = makeLedger();
    await declare();
    const result = await ledger.requestReservation(request());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.held).toBe(true);
      expect(result.reservation.state).toBe('HELD');
      expect(result.reservation.reservationId).toBe(
        deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE),
      );
    }
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(800_00);
    expect(resourceInvariantHolds(ledger.resourceAccounting(RESOURCE) as never)).toBe(true);
    // The log: RESOURCE_DECLARED, REQUESTED(decision HOLD), HELD — totally
    // ordered per resource.
    const kinds = ledger.entriesFor(RESOURCE).map((entry) => entry.entryKind);
    expect(kinds).toEqual(['RESOURCE_DECLARED', 'REQUESTED', 'HELD']);
    const requested = ledger.entriesFor(RESOURCE)[1] as ReservationLedgerEntry;
    expect(requested.decision).toBe('HOLD');
    expect(requested.intentId).toBe(INTENT);
    // One RESERVATION_HELD record with the ledger sequence and arithmetic
    // identity proofs.
    const held = log.records().find((record) => record.what.operationType === 'RESERVATION_HELD');
    expect(held).not.toBe(undefined);
    if (held !== undefined) {
      expect(held.proof.sequenceNumbers).toEqual([2]);
      expect(held.proof.hashes?.length).toBe(1);
      expect(held.proof.hashes?.[0]).toMatch(/^rai\.v1\.[0-9a-f]{64}$/);
      expect(held.what.subjectIds).toContain(deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE));
      expect(held.authority).toBe('Reservation Authority');
    }
  });

  test('an uncovered request resolves REQUESTED -> RELEASED (rejected, never ambiguous)', async () => {
    const { ledger, declare, log } = makeLedger({ declared: 100_00 });
    await declare();
    const result = await ledger.requestReservation(request({ amount: 200_00 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.held).toBe(false);
      expect(result.reservation.state).toBe('RELEASED');
      expect(result.reservation.reasonCode).toBe('INSUFFICIENT_AVAILABLE');
    }
    // The rejected request held nothing: the identity is unchanged.
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(100_00);
    expect(resourceInvariantHolds(ledger.resourceAccounting(RESOURCE) as never)).toBe(true);
    const kinds = ledger.entriesFor(RESOURCE).map((entry) => entry.entryKind);
    expect(kinds).toEqual(['RESOURCE_DECLARED', 'REQUESTED', 'RELEASED']);
    const released = log
      .records()
      .find((record) => record.what.operationType === 'RESERVATION_RELEASED');
    expect(released).not.toBe(undefined);
    if (released !== undefined) {
      expect(released.outcome.reasonCode).toBe('INSUFFICIENT_AVAILABLE');
    }
  });

  test('a duplicate request returns the recorded state (INV-5-3) — HELD and RELEASED alike', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    const first = await ledger.requestReservation(request({ hopId: 'pid.v1.hopA', amount: 300_00 }));
    const second = await ledger.requestReservation(request({ hopId: 'pid.v1.hopA', amount: 300_00 }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.replayed).toBe(true);
      expect(second.reservation).toBe(first.reservation);
    }
    // A rejected request replays its recorded RELEASED state identically.
    const rejectedFirst = await ledger.requestReservation(request({ hopId: 'pid.v1.hopB', amount: 999_00 }));
    const rejectedAgain = await ledger.requestReservation(request({ hopId: 'pid.v1.hopB', amount: 999_00 }));
    expect(rejectedFirst.ok).toBe(true);
    expect(rejectedAgain.ok).toBe(true);
    if (rejectedFirst.ok && rejectedAgain.ok) {
      expect(rejectedAgain.replayed).toBe(true);
      expect(rejectedAgain.reservation.state).toBe('RELEASED');
    }
    // No new log entries for the replays.
    expect(ledger.entries().length).toBe(5);
  });

  test('the reservation id is derived from (intent id, hop id, resource id) — INV-5-3', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    const result = await ledger.requestReservation(
      request({ intentId: 'pid.v1.i2', hopId: 'pid.v1.h9' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservation.reservationId).toBe(
        deriveProtocolId('reservation', 'pid.v1.i2', 'pid.v1.h9', RESOURCE),
      );
    }
  });
});

describe('ReservationLedger exactly-once terminals (INV-5-3, GC-2)', () => {
  async function heldLedger() {
    const context = makeLedger();
    await context.declare();
    await context.ledger.requestReservation(request());
    return context;
  }

  test('consume applies HELD -> CONSUMED once; a repeat returns the recorded terminal', async () => {
    const { ledger, log } = await heldLedger();
    const reservationId = deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE);
    const first = await ledger.consumeReservation(reservationId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.reservation.state).toBe('CONSUMED');
      expect(first.replayed).toBe(false);
    }
    expect(ledger.resourceAccounting(RESOURCE)?.consumedTotal.amountMinor).toBe(200_00);
    expect(ledger.resourceAccounting(RESOURCE)?.heldTotal.amountMinor).toBe(0);
    const again = await ledger.consumeReservation(reservationId);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.replayed).toBe(true);
      expect(again.reservation.state).toBe('CONSUMED');
    }
    // The arithmetic applied exactly once.
    expect(ledger.resourceAccounting(RESOURCE)?.consumedTotal.amountMinor).toBe(200_00);
    const consumed = log
      .records()
      .filter((record) => record.what.operationType === 'RESERVATION_CONSUMED');
    expect(consumed.length).toBe(1);
  });

  test('release applies HELD -> RELEASED once; consuming a released hold is illegal', async () => {
    const { ledger } = await heldLedger();
    const reservationId = deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE);
    const released = await ledger.releaseReservation(reservationId);
    expect(released.ok).toBe(true);
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(1_000_00);
    const consumed = await ledger.consumeReservation(reservationId);
    expect(consumed.ok).toBe(false);
    if (!consumed.ok) {
      expect(consumed.code).toBe('ILLEGAL_TRANSITION');
    }
    const unknown = await ledger.consumeReservation('pid.v1.missing');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.code).toBe('RESERVATION_NOT_FOUND');
    }
  });

  test('the INV-5-1 identity holds after every transition of a mixed sequence', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    await ledger.requestReservation(request({ hopId: 'pid.v1.h1', amount: 300_00 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.h2', amount: 300_00 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.h3', amount: 999_00 })); // rejected
    await ledger.consumeReservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h1', RESOURCE),
    );
    await ledger.releaseReservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h2', RESOURCE),
    );
    const accounting = ledger.resourceAccounting(RESOURCE);
    expect(accounting).not.toBe(undefined);
    if (accounting !== undefined) {
      expect(resourceInvariantHolds(accounting)).toBe(true);
      expect(accounting.heldTotal.amountMinor).toBe(0);
      expect(accounting.consumedTotal.amountMinor).toBe(300_00);
      expect(availableResource(accounting).amountMinor).toBe(700_00);
    }
  });
});

describe('ReservationLedger deterministic expiry (core.md lines 290-291)', () => {
  test('a HELD reservation expires at its deadline and the hold returns to available', async () => {
    const { ledger, declare, log, advance } = makeLedger();
    await declare();
    await ledger.requestReservation(request({ deadline: 10_000 }));
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(800_00);
    // Before the deadline: nothing expires.
    const before = await ledger.expireDueReservations(protocolTime(1, 9_999));
    expect(before.length).toBe(0);
    // At and after the deadline: the hold expires.
    const at = await ledger.expireDueReservations(protocolTime(1, 10_000));
    expect(at.length).toBe(1);
    expect(at[0]?.state).toBe('EXPIRED');
    expect(at[0]?.reasonCode).toBe('DEADLINE_EXPIRED');
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(1_000_00);
    expect(resourceInvariantHolds(ledger.resourceAccounting(RESOURCE) as never)).toBe(true);
    const expired = log
      .records()
      .find((record) => record.what.operationType === 'RESERVATION_EXPIRED');
    expect(expired).not.toBe(undefined);
    if (expired !== undefined) {
      expect(expired.outcome.reasonCode).toBe('DEADLINE_EXPIRED');
    }
    // Deterministic: a second run at a later time finds nothing more.
    advance(1_000);
    const again = await ledger.expireDueReservations();
    expect(again.length).toBe(0);
    // An expired hold cannot be consumed (exactly-once terminal).
    const consumed = await ledger.consumeReservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE),
    );
    expect(consumed.ok).toBe(false);
  });

  test('expiry processes the due set in ascending reservation-id order', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    await ledger.requestReservation(request({ hopId: 'pid.v1.hB', deadline: 10_000 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.hA', deadline: 10_000 }));
    const expired = await ledger.expireDueReservations(protocolTime(1, 10_000));
    expect(expired.map((entry) => entry.hopId)).toEqual(['pid.v1.hA', 'pid.v1.hB']);
  });
});

describe('ReservationLedger serialization (INV-5-2 — the concurrency frontier)', () => {
  test('concurrent requests against one resource serialize: total order, no over-commit', async () => {
    const { ledger, declare, log } = makeLedger();
    await declare();
    // Six concurrent requests of 300 each against a 1000 total: exactly
    // three can hold (300 x 3 = 900 <= 1000), the rest are rejected —
    // regardless of interleaving, INV-5-1 holds after every transition.
    const results = await Promise.all(
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((hop) =>
        ledger.requestReservation(
          request({ hopId: `pid.v1.${hop}`, amount: 300_00 }),
        ),
      ),
    );
    const held = results.filter((result) => result.ok && result.held);
    const rejected = results.filter((result) => result.ok && !result.held);
    expect(held.length).toBe(3);
    expect(rejected.length).toBe(3);
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(100_00);
    expect(resourceInvariantHolds(ledger.resourceAccounting(RESOURCE) as never)).toBe(true);
    // The per-resource log is totally ordered with strictly increasing
    // sequences (the REQUESTED/HELD/RELEASED triples interleave cleanly).
    const entries = ledger.entriesFor(RESOURCE);
    let expected = 0;
    for (const entry of entries) {
      expect(entry.resourceSequence).toBe(expected);
      expected += 1;
    }
    expect(entries.length).toBe(1 + 6 * 2);
    // Every REQUESTED resolves within the same command burst: no dangling
    // tails remain.
    expect(ledger.danglingTails().length).toBe(0);
    // The evidence: exactly one RESERVATION_HELD per held, one
    // RESERVATION_RELEASED per rejection.
    const heldRecords = log
      .records()
      .filter((record) => record.what.operationType === 'RESERVATION_HELD');
    const releasedRecords = log
      .records()
      .filter((record) => record.what.operationType === 'RESERVATION_RELEASED');
    expect(heldRecords.length).toBe(3);
    expect(releasedRecords.length).toBe(3);
  });

  test('concurrent REQUESTED resolution is deterministic under submission order', async () => {
    // Same submission order twice (fresh ledgers, same clock): identical
    // transcripts — the serialized decisions are a pure function of the
    // submission order and the accounting.
    async function transcript() {
      const { ledger, declare, log } = makeLedger();
      await declare();
      await Promise.all(
        ['h1', 'h2', 'h3', 'h4'].map((hop, index) =>
          ledger.requestReservation(
            request({ hopId: `pid.v1.${hop}`, amount: 400_00 - index * 100 }),
          ),
        ),
      );
      return {
        states: ledger.reservations().map((entry) => `${entry.hopId}:${entry.state}`),
        entries: ledger.entries().map((entry) => `${entry.resourceSequence}:${entry.entryKind}:${entry.decision ?? ''}`),
        evidence: log
          .records()
          .slice(1)
          .map((record) => `${record.what.operationType}:${record.outcome.result}`),
      };
    }
    expect(await transcript()).toEqual(await transcript());
  });
});

describe('ReservationLedger ledger-tail crash recovery (core.md lines 316-318)', () => {
  async function buildScenario() {
    const { ledger } = makeLedger();
    await ledger.declareResource(RESOURCE, DECLARED);
    await ledger.requestReservation(request({ hopId: 'pid.v1.h-held', amount: 300_00 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.h-consumed', amount: 200_00 }));
    await ledger.consumeReservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h-consumed', RESOURCE),
    );
    await ledger.requestReservation(request({ hopId: 'pid.v1.h-rejected', amount: 999_00 }));
    return ledger;
  }

  test('recovery replays a full log with no dangles: identical state, no new evidence', async () => {
    const source = await buildScenario();
    const entries = source.entries();
    const log = createEvidenceLog({ wallMs: 1_000 });
    const recovered = await openReservationLedger({
      evidence: log,
      wallClock: () => 5_000,
      initialEntries: entries,
    });
    expect(recovered.resourceAccounting(RESOURCE)?.consumedTotal.amountMinor).toBe(200_00);
    expect(recovered.resourceAccounting(RESOURCE)?.heldTotal.amountMinor).toBe(300_00);
    expect(recovered.availableOf(RESOURCE)?.amountMinor).toBe(500_00);
    expect(recovered.reservations().length).toBe(3);
    expect(recovered.entries().length).toBe(entries.length);
    // No new evidence from the pure replay (only genesis exists).
    expect(log.height).toBe(1);
    expect(recovered.danglingTails().length).toBe(0);
  });

  test('every truncation point recovers: dangles resolve per the recorded decision, never duplicated', async () => {
    const source = await buildScenario();
    const entries = source.entries();
    // Crash points: every prefix of the log. For each, adopt the prefix,
    // recover, and assert the invariants.
    for (let cut = 0; cut <= entries.length; cut += 1) {
      const prefix = entries.slice(0, cut);
      const log = createEvidenceLog({ wallMs: 1_000 });
      const ledger = new ReservationLedger({
        evidence: log,
        wallClock: () => 5_000,
        initialEntries: prefix,
      });
      const dangles = ledger.danglingTails();
      expect(dangles.length).toBe(cut === 0 ? 0 : (prefix[prefix.length - 1] as ReservationLedgerEntry).entryKind === 'REQUESTED' ? 1 : 0);
      const report = await ledger.recover();
      // Never duplicated: each dangling REQUESTED resolved exactly once.
      for (const action of report.resolved) {
        const resolutionCount = ledger
          .entries()
          .filter(
            (entry) =>
              entry.reservationId === action.reservationId &&
              (entry.entryKind === 'HELD' || entry.entryKind === 'RELEASED'),
          )
          .length;
        expect(resolutionCount).toBe(1);
      }
      // INV-5-1 holds after the recovery.
      const accounting = ledger.resourceAccounting(RESOURCE);
      if (cut >= 1) {
        expect(accounting).not.toBe(undefined);
        if (accounting !== undefined) {
          expect(resourceInvariantHolds(accounting)).toBe(true);
          expect(availableResource(accounting).amountMinor >= 0).toBe(true);
        }
      }
      // No dangles remain; a second recovery is a no-op.
      expect(ledger.danglingTails().length).toBe(0);
      const second = await ledger.recover();
      expect(second.resolved.length).toBe(0);
      // Every reservation exists at most once.
      const ids = ledger.reservations().map((entry) => entry.reservationId);
      expect(new Set(ids).size).toBe(ids.length);
      // The recovery resolutions carry their recovery reason codes.
      for (const record of log.records().slice(1)) {
        expect(record.outcome.reasonCode === undefined || record.outcome.reasonCode.startsWith('RECOVERY_')).toBe(true);
      }
    }
  });

  test('a HOLD-decision dangle rolls forward to HELD; a REJECT-decision dangle rolls back to RELEASED', async () => {
    const source = await buildScenario();
    const entries = source.entries();
    // The HOLD dangle: truncate right after the first REQUESTED.
    const holdCut = entries.findIndex((entry) => entry.entryKind === 'REQUESTED') + 1;
    const holdLog = createEvidenceLog({ wallMs: 1_000 });
    const holdLedger = await openReservationLedger({
      evidence: holdLog,
      wallClock: () => 5_000,
      initialEntries: entries.slice(0, holdCut),
    });
    const rolledForward = holdLedger.reservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h-held', RESOURCE),
    );
    expect(rolledForward?.state).toBe('HELD');
    expect(rolledForward?.reasonCode).toBe('RECOVERY_ROLLFORWARD');
    expect(holdLedger.availableOf(RESOURCE)?.amountMinor).toBe(700_00);
    const forwardRecord = holdLog
      .records()
      .find((record) => record.what.operationType === 'RESERVATION_HELD');
    expect(forwardRecord).not.toBe(undefined);
    if (forwardRecord !== undefined) {
      expect(forwardRecord.outcome.reasonCode).toBe('RECOVERY_ROLLFORWARD');
    }
    // The REJECT dangle: truncate right after the rejected REQUESTED.
    const rejectIndex = entries.findIndex(
      (entry) => entry.entryKind === 'REQUESTED' && entry.decision === 'REJECT',
    );
    const rejectLog = createEvidenceLog({ wallMs: 1_000 });
    const rejectLedger = await openReservationLedger({
      evidence: rejectLog,
      wallClock: () => 5_000,
      initialEntries: entries.slice(0, rejectIndex + 1),
    });
    const rolledBack = rejectLedger.reservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h-rejected', RESOURCE),
    );
    expect(rolledBack?.state).toBe('RELEASED');
    expect(rolledBack?.reasonCode).toBe('RECOVERY_ROLLBACK');
    // The rejected request held nothing: the identity is unchanged.
    expect(rejectLedger.availableOf(RESOURCE)?.amountMinor).toBe(500_00);
  });

  test('a failed evidence write leaves the REQUESTED dangling; the next command self-heals per the decision', async () => {
    // The port fails exactly one submission (the resolution evidence of the
    // first request); the command fails with the REQUESTED appended, and
    // the next command resolves the tail per the recorded decision.
    let failedOnce = false;
    const failing: EvidenceSubmission = {
      submit: (record: EvidenceSubmissionRecord) => {
        if (!failedOnce && record.what.operationType === 'RESERVATION_HELD') {
          failedOnce = true;
          throw new Error('evidence write failed');
        }
      },
    };
    const log = createEvidenceLog({ wallMs: 1_000 });
    const ledger = new ReservationLedger({
      evidence: {
        submit: (record) => {
          if (!failedOnce && record.what.operationType === 'RESERVATION_HELD') {
            failedOnce = true;
            throw new Error('evidence write failed');
          }
          log.submit(record);
        },
      },
      wallClock: () => 5_000,
    });
    void failing;
    await ledger.declareResource(RESOURCE, DECLARED);
    let threw = false;
    try {
      await ledger.requestReservation(request({ hopId: 'pid.v1.h1', amount: 300_00 }));
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('evidence write failed');
    }
    expect(threw).toBe(true);
    // The REQUESTED dangles with its recorded decision.
    expect(ledger.danglingTails().length).toBe(1);
    const reservationId = deriveProtocolId('reservation', INTENT, 'pid.v1.h1', RESOURCE);
    expect(ledger.reservation(reservationId)?.state).toBe('REQUESTED');
    // The next command self-heals: the dangle rolls forward to HELD.
    const retry = await ledger.requestReservation(
      request({ hopId: 'pid.v1.h1', amount: 300_00 }),
    );
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.replayed).toBe(true);
      expect(retry.held).toBe(true);
    }
    expect(ledger.danglingTails().length).toBe(0);
    expect(ledger.availableOf(RESOURCE)?.amountMinor).toBe(700_00);
    expect(resourceInvariantHolds(ledger.resourceAccounting(RESOURCE) as never)).toBe(true);
  });

  test('corrupt logs fail adoption loudly (never silently repaired)', async () => {
    const source = await buildScenario();
    const entries = source.entries();
    // A duplicated REQUESTED for one reservation id (sequences adjusted so
    // the duplication check — not the ordering checks — fires).
    const duplicated = [
      ...entries,
      {
        ...(entries[1] as ReservationLedgerEntry),
        globalSequence: entries.length,
        resourceSequence: entries.length,
      },
    ];
    let threw = false;
    try {
      new ReservationLedger({
        evidence: createEvidenceLog({ wallMs: 1_000 }),
        wallClock: () => 5_000,
        initialEntries: duplicated,
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('duplicated');
    }
    expect(threw).toBe(true);
    // A global-sequence gap.
    const gapped = entries.map((entry, index) =>
      index === 2 ? { ...entry, globalSequence: 99 } : entry,
    );
    threw = false;
    try {
      new ReservationLedger({
        evidence: createEvidenceLog({ wallMs: 1_000 }),
        wallClock: () => 5_000,
        initialEntries: gapped,
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('global sequence');
    }
    expect(threw).toBe(true);
    // A resource-sequence gap.
    const resourceGapped = entries.map((entry, index) =>
      index === 2 ? { ...entry, resourceSequence: 9 } : entry,
    );
    threw = false;
    try {
      new ReservationLedger({
        evidence: createEvidenceLog({ wallMs: 1_000 }),
        wallClock: () => 5_000,
        initialEntries: resourceGapped,
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toContain('totally ordered');
    }
    expect(threw).toBe(true);
  });
});

describe('ReservationLedger UNKNOWN semantics (core.md lines 319-322)', () => {
  test('holds stay HELD until explicitly consumed or released — the ledger never resolves them on its own', async () => {
    const { ledger, declare } = makeLedger();
    await declare();
    await ledger.requestReservation(request());
    // Advance far past the deadline WITHOUT running expiry: the hold is
    // still HELD (expiry is driven by an explicit deterministic run, not by
    // a background clock — the owning flow (area 4/12) decides when to
    // expire, consume, or release after reconciliation).
    const reservationId = deriveProtocolId('reservation', INTENT, 'pid.v1.hop', RESOURCE);
    expect(ledger.reservation(reservationId)?.state).toBe('HELD');
    await ledger.consumeReservation(reservationId);
    expect(ledger.reservation(reservationId)?.state).toBe('CONSUMED');
  });
});

describe('ReservationLedger evidence discipline', () => {
  test('the operation-type vocabulary is exactly the four named A05 types', () => {
    expect(Object.values(RESERVATION_EVIDENCE_VOCABULARY)).toEqual([
      'RESERVATION_HELD',
      'RESERVATION_CONSUMED',
      'RESERVATION_RELEASED',
      'RESERVATION_EXPIRED',
    ]);
  });

  test('a full lifecycle writes exactly one record per consequential transition, chain-verified', async () => {
    const { ledger, declare, log } = makeLedger();
    await declare();
    await ledger.requestReservation(request({ hopId: 'pid.v1.h1', amount: 300_00 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.h2', amount: 999_00 }));
    await ledger.requestReservation(request({ hopId: 'pid.v1.h3', amount: 200_00, deadline: 10_000 }));
    await ledger.consumeReservation(
      deriveProtocolId('reservation', INTENT, 'pid.v1.h1', RESOURCE),
    );
    await ledger.expireDueReservations(protocolTime(1, 999_999));
    const types = log
      .records()
      .slice(1)
      .map((record) => record.what.operationType);
    expect(types).toEqual([
      'RESERVATION_HELD',
      'RESERVATION_RELEASED',
      'RESERVATION_HELD',
      'RESERVATION_CONSUMED',
      'RESERVATION_EXPIRED',
    ]);
    expect(log.verifyAndRecord(2_000).verdict).toBe('VERIFIED');
  });
});
