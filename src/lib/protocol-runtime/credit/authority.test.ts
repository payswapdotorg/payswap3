/**
 * RTN-007 — Credit Authority: the authority's command surface over the
 * REAL ReservationLedger — the line machine, the CreditDecision machine
 * (INV-7-3 keying), the atomic INV-7-1 check-and-hold, the INV-7-2
 * per-line serialization (two concurrent approvals), the exposure
 * mutations, and closure gating.
 *
 * Tested contracts (spec-cited):
 *   spec/architecture/v0.1/liquidity-credit-queues.md §2 Area 7:
 *   lines 96-111 (the objects and machines); lines 116-127
 *   (INV-7-1/INV-7-2/INV-7-3, quoted in the enforcing modules).
 */
import { describe, expect, test } from 'bun:test';
import { createEvidenceLog } from '../evidence/log.ts';
import { deriveProtocolId } from '../kernel/identity.ts';
import { money } from '../kernel/money.ts';
import { ReservationLedger } from '../reservations/ledger.ts';
import { CreditAuthority, creditLineResourceId } from './authority.ts';
import { exposureInvariantHolds } from './exposure.ts';

function makeAuthority() {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 5_000;
  const ledger = new ReservationLedger({ evidence: log, wallClock: () => wall });
  const authority = new CreditAuthority({ evidence: log, ledger, wallClock: () => wall });
  return { log, ledger, authority, advance: (ms: number) => { wall += ms; } };
}

const LIMIT = money('EUR', 1_000_00, 2);
const AMOUNT = (minor: number) => money('EUR', minor, 2);

async function activeLine(limitMinor = 1_000_00) {
  const harness = makeAuthority();
  const { authority } = harness;
  await authority.offerLine({ lineId: 'line-a', limit: money('EUR', limitMinor, 2) });
  await authority.activateLine('line-a');
  return { ...harness, lineId: 'line-a', limitMinor };
}

describe('the line machine (OFFERED -> ACTIVE -> SUSPENDED -> CLOSED, exact)', () => {
  test('offer, activate, suspend, close walk the exact chain; replays are idempotent', async () => {
    const { authority } = await activeLine();
    expect(authority.line('line-a')?.state).toBe('ACTIVE');
    expect((await authority.suspendLine('line-a')).ok).toBe(true);
    expect(authority.line('line-a')?.state).toBe('SUSPENDED');
    expect((await authority.closeLine('line-a')).ok).toBe(true);
    expect(authority.line('line-a')?.state).toBe('CLOSED');
    // Replays.
    const suspendedAgain = await authority.suspendLine('line-a');
    expect(suspendedAgain.ok).toBe(false); // CLOSED has no successors
  });

  test('activation declares the line as an area-5 resource with declared total = limit', async () => {
    const { authority, ledger } = await activeLine(1_000_00);
    const accounting = ledger.resourceAccounting(creditLineResourceId('line-a'));
    expect(accounting?.declaredTotal.amountMinor).toBe(1_000_00);
    expect(accounting?.heldTotal.amountMinor).toBe(0);
    expect(ledger.availableOf(creditLineResourceId('line-a'))?.amountMinor).toBe(1_000_00);
  });

  test('suspend from OFFERED and close from ACTIVE are the typed ILLEGAL_TRANSITION rejections', async () => {
    const { authority } = makeAuthority();
    await authority.offerLine({ lineId: 'line-x', limit: LIMIT });
    const suspended = await authority.suspendLine('line-x');
    expect(suspended.ok).toBe(false);
    if (!suspended.ok) {
      expect(suspended.code).toBe('ILLEGAL_TRANSITION');
    }
    await authority.activateLine('line-x');
    const closed = await authority.closeLine('line-x');
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  test('closure requires exposure exactly zero (settled or written off)', async () => {
    const { authority } = await activeLine();
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    const decisionId = evaluation.ok ? evaluation.decision.decisionId : '';
    const applied = await authority.applyCreditDecision({
      decisionId,
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    expect(applied.ok).toBe(true);
    // Wind the line down with the hold still live.
    await authority.suspendLine('line-a');
    const blocked = await authority.closeLine('line-a');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('EXPOSURE_OUTSTANDING');
    }
    // Release the capacity (the repayment-tied release path): exposure 0.
    await authority.releaseCreditReservation(applied.ok ? applied.reservationId : '');
    expect((await authority.closeLine('line-a')).ok).toBe(true);
  });
});

describe('CreditDecision (EVALUATED -> APPLIED; INV-7-3 keying)', () => {
  test('an approval names the exact integer amount requested', async () => {
    const { authority } = await activeLine();
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(123_00),
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.decision.outcome.kind).toBe('APPROVED');
      if (evaluation.decision.outcome.kind === 'APPROVED') {
        expect(evaluation.decision.outcome.approvedAmount.amountMinor).toBe(123_00);
      }
      expect(evaluation.decision.state).toBe('EVALUATED');
    }
  });

  test('the decision id is derived from (intent id, line id) — the same key replays the same recorded decision', async () => {
    const { authority } = await activeLine();
    const first = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(123_00),
    });
    const replay = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      // Even a different requested amount replays the RECORDED decision
      // (INV-7-3: the same key always returns the same recorded decision).
      requestedAmount: AMOUNT(456_00),
    });
    expect(first.ok && replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.decision.decisionId).toBe(first.decision.decisionId);
      expect(first.decision.decisionId).toBe(
        deriveProtocolId('credit-decision', 'pid.v1.intent-1', 'line-a'),
      );
      if (replay.decision.outcome.kind === 'APPROVED' && first.decision.outcome.kind === 'APPROVED') {
        expect(replay.decision.outcome.approvedAmount.amountMinor).toBe(123_00);
      }
    }
  });

  test('requests beyond the remaining limit are DENIED with INSUFFICIENT_REMAINING_LIMIT', async () => {
    const { authority } = await activeLine(500_00);
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-big',
      lineId: 'line-a',
      requestedAmount: AMOUNT(600_00),
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.decision.outcome.kind).toBe('DENIED');
      if (evaluation.decision.outcome.kind === 'DENIED') {
        expect(evaluation.decision.outcome.reason).toBe('INSUFFICIENT_REMAINING_LIMIT');
      }
    }
  });

  test('suspension blocks new usage: evaluation DENIES with LINE_NOT_ACTIVE', async () => {
    const { authority } = await activeLine();
    await authority.suspendLine('line-a');
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(100_00),
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.decision.outcome.kind).toBe('DENIED');
      if (evaluation.decision.outcome.kind === 'DENIED') {
        expect(evaluation.decision.outcome.reason).toBe('LINE_NOT_ACTIVE');
      }
    }
  });

  test('apply moves the decision EVALUATED -> APPLIED and holds the capacity on the ledger', async () => {
    const { authority, ledger } = await activeLine(1_000_00);
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    const decisionId = evaluation.ok ? evaluation.decision.decisionId : '';
    const applied = await authority.applyCreditDecision({
      decisionId,
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.decision.state).toBe('APPLIED');
      expect(typeof applied.reservationId).toBe('string');
    }
    const accounting = ledger.resourceAccounting(creditLineResourceId('line-a'));
    expect(accounting?.heldTotal.amountMinor).toBe(400_00);
    // Exposure view: held + consumed, INV-7-1 holds.
    const exposure = authority.lineExposure('line-a');
    expect(exposure?.exposure.amountMinor).toBe(400_00);
    expect(exposure?.remaining.amountMinor).toBe(600_00);
    expect(exposureInvariantHolds(exposure as never)).toBe(true);
  });

  test('re-apply of an APPLIED decision returns the recorded state (replay)', async () => {
    const { authority } = await activeLine();
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    const decisionId = evaluation.ok ? evaluation.decision.decisionId : '';
    const first = await authority.applyCreditDecision({
      decisionId,
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    const second = await authority.applyCreditDecision({
      decisionId,
      hopId: 'pid.v1.hop-9', // a different hop is still the SAME decision
      deadlineEpochMs: 60_000,
    });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.replayed).toBe(true);
      expect(second.reservationId).toBe(first.reservationId);
    }
  });

  test('applying a DENIED decision is the typed DECISION_NOT_APPROVED rejection', async () => {
    const { authority } = await activeLine(100_00);
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-big',
      lineId: 'line-a',
      requestedAmount: AMOUNT(600_00),
    });
    const decisionId = evaluation.ok ? evaluation.decision.decisionId : '';
    const applied = await authority.applyCreditDecision({
      decisionId,
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.code).toBe('DECISION_NOT_APPROVED');
    }
  });
});

describe('INV-7-1/INV-7-2 (atomic check-and-hold; serialized per line)', () => {
  test('two concurrent approvals cannot both count the same remaining limit', async () => {
    const { authority } = await activeLine(500_00);
    const first = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-a',
      lineId: 'line-a',
      requestedAmount: AMOUNT(500_00),
    });
    const second = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-b',
      lineId: 'line-a',
      requestedAmount: AMOUNT(500_00),
    });
    expect(first.ok && second.ok).toBe(true);
    const firstDecision = first.ok ? first.decision.decisionId : '';
    const secondDecision = second.ok ? second.decision.decisionId : '';
    // Apply both CONCURRENTLY: exactly one holds the capacity.
    const [firstApply, secondApply] = await Promise.all([
      authority.applyCreditDecision({ decisionId: firstDecision, hopId: 'pid.v1.hop-a', deadlineEpochMs: 60_000 }),
      authority.applyCreditDecision({ decisionId: secondDecision, hopId: 'pid.v1.hop-b', deadlineEpochMs: 60_000 }),
    ]);
    const outcomes = [firstApply, secondApply];
    const applied = outcomes.filter((outcome) => outcome.ok);
    const rejected = outcomes.filter((outcome) => !outcome.ok);
    expect(applied.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0] && !rejected[0].ok) {
      expect(rejected[0].code).toBe('INSUFFICIENT_REMAINING_LIMIT');
    }
    // INV-7-1: exposure never exceeds the limit.
    const exposure = authority.lineExposure('line-a');
    expect(exposure?.exposure.amountMinor).toBe(500_00);
    expect((exposure?.exposure.amountMinor ?? -1) <= (exposure?.limit.amountMinor ?? 0)).toBe(true);
    // The losing decision stays EVALUATED, retryable, recorded outcome unchanged (INV-7-3).
    const losingDecisionId = applied[0]?.ok && firstApply.ok && firstApply.reservationId !== undefined && applied[0] === firstApply ? secondDecision : firstDecision;
    const losing = authority.decision(losingDecisionId);
    expect(losing?.state).toBe('EVALUATED');
    expect(losing?.outcome.kind).toBe('APPROVED');
  });

  test('exposure mutations ride the ledger terminals: consume keeps exposure, release reduces it', async () => {
    const { authority } = await activeLine(1_000_00);
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    const applied = await authority.applyCreditDecision({
      decisionId: evaluation.ok ? evaluation.decision.decisionId : '',
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 60_000,
    });
    const reservationId = applied.ok ? applied.reservationId : '';
    // Consume: the capacity settles into obligations — exposure STAYS.
    const consumed = await authority.consumeCreditReservation(reservationId);
    expect(consumed.ok).toBe(true);
    if (consumed.ok) {
      expect(consumed.record.exposure.amountMinor).toBe(400_00);
      expect(consumed.record.consumed.amountMinor).toBe(400_00);
      expect(consumed.record.reserved.amountMinor).toBe(0);
    }
    // Release of a consumed hold is the ledger's ILLEGAL_TRANSITION.
    const releasedAfter = await authority.releaseCreditReservation(reservationId);
    expect(releasedAfter.ok).toBe(false);
    // A fresh hold + release: exposure decreases (the release path).
    const second = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-2',
      lineId: 'line-a',
      requestedAmount: AMOUNT(300_00),
    });
    const secondApplied = await authority.applyCreditDecision({
      decisionId: second.ok ? second.decision.decisionId : '',
      hopId: 'pid.v1.hop-2',
      deadlineEpochMs: 60_000,
    });
    const released = await authority.releaseCreditReservation(
      secondApplied.ok ? secondApplied.reservationId : '',
    );
    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.record.exposure.amountMinor).toBe(400_00);
      expect(released.record.reserved.amountMinor).toBe(0);
    }
    expect(authority.lineExposure('line-a')?.remaining.amountMinor).toBe(600_00);
  });

  test('deadline expiry releases capacity deterministically (the area-5 deadline rule)', async () => {
    const harness = await activeLine(1_000_00);
    const { authority, advance } = harness;
    const evaluation = await authority.evaluateCreditUsage({
      intentId: 'pid.v1.intent-1',
      lineId: 'line-a',
      requestedAmount: AMOUNT(400_00),
    });
    await authority.applyCreditDecision({
      decisionId: evaluation.ok ? evaluation.decision.decisionId : '',
      hopId: 'pid.v1.hop-1',
      deadlineEpochMs: 10_000,
    });
    advance(20_000);
    const expired = await authority.expireDueCreditReservations();
    expect(expired.length).toBe(1);
    expect(expired[0]?.exposure.amountMinor).toBe(0);
    expect(authority.lineExposure('line-a')?.remaining.amountMinor).toBe(1_000_00);
  });

  test('a reservation of another domain is not ownable (typed RESERVATION_NOT_OWNED)', async () => {
    const { authority, ledger } = makeAuthority();
    await authority.offerLine({ lineId: 'line-a', limit: LIMIT });
    await authority.activateLine('line-a');
    await ledger.declareResource('foreign-resource', AMOUNT(100_00));
    await ledger.requestReservation({
      intentId: 'pid.v1.intent-foreign',
      hopId: 'pid.v1.hop-foreign',
      resourceId: 'foreign-resource',
      amount: AMOUNT(50_00),
      deadlineEpochMs: 60_000,
    });
    const foreign = ledger.reservations().find((r) => r.resourceId === 'foreign-resource');
    const result = await authority.consumeCreditReservation(foreign?.reservationId ?? 'none');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RESERVATION_NOT_OWNED');
    }
  });
});
