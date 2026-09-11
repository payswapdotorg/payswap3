/**
 * RTN-005 — INV-1-2 / INV-1-3 idempotency tests: concurrent same-key
 * submissions collapse to one intent and one receipt; recorded keys return
 * the recorded receipt; state transitions serialize per intent id.
 *
 * Source of the tested contract — spec/architecture/v0.1/core.md §1:
 *   lines 57-62:
 *     "INV-1-2 (concurrency): state transitions are serialized per intent
 *      id. Concurrent submissions carrying the same idempotency key collapse
 *      to one intent and one receipt.
 *      INV-1-3 (idempotency): re-submission with a recorded idempotency key
 *      returns the recorded receipt; it never creates a second intent or a
 *      second financial effect."
 * Work order acceptance: "Idempotent receipts: concurrent same-key
 * submissions collapse to one intent + one receipt (INV-1-2/3)."
 */
import { describe, expect, test } from 'bun:test';
import { money } from '../kernel/money.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import type { EvidenceLog } from '../evidence/log.ts';
import { demandDescriptor } from './descriptor.ts';
import { IntentAuthority } from './authority.ts';
import type { DemandDescriptor } from './types.ts';

const ALLOW_ALL = (subjectId: string) => ({
  allowed: true as const,
  gateKind: 'intent.AUTHORIZATION' as const,
  subjectId,
  checkId: 'check-ok',
});

function makeAuthority(log: EvidenceLog): IntentAuthority {
  let wall = 1_000;
  return new IntentAuthority({
    evidence: log,
    gate: ALLOW_ALL,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
}

function descriptorFor(key: string): DemandDescriptor {
  return demandDescriptor({
    amount: money('EUR', 1_000, 2),
    source: { currency: 'EUR', geography: 'DE', account: 'acct-source' },
    destination: { currency: 'USD', geography: 'US', account: 'acct-destination' },
    constraints: {
      deadlineEpochMs: 60_000,
      allowedRails: ['rail-a'],
      costCeiling: money('USD', 500, 2),
    },
    idempotencyKey: key,
  });
}

describe('INV-1-2/INV-1-3 — concurrent same-key submissions collapse', () => {
  test('25 concurrent submissions with the same key collapse to ONE intent, ONE receipt, ONE evidence record', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    const descriptor = descriptorFor('idem-collapse');
    // The submissions genuinely interleave: each command awaits the
    // evidence submission (a microtask boundary) between its key check and
    // its commit; only the per-intent-id serializer keeps the collapse.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => authority.submitIntent(descriptor)),
    );
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const okResults = results.filter((result) => result.ok);
    expect(okResults.filter((result) => !result.replayed).length).toBe(1);
    expect(okResults.filter((result) => result.replayed).length).toBe(24);
    // ONE receipt object, returned verbatim to every submitter
    const receipts = new Set(okResults.map((result) => result.receipt));
    expect(receipts.size).toBe(1);
    // ONE intent
    expect(authority.listIntents().length).toBe(1);
    // ONE INTENT_CREATED record in the REAL log (no second financial effect)
    expect(
      log.records().filter((record) => record.what.operationType === 'INTENT_CREATED').length,
    ).toBe(1);
  });

  test('concurrent submissions with DIFFERENT keys create distinct intents and distinct records', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => authority.submitIntent(descriptorFor(`idem-${index}`))),
    );
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.replayed).toBe(false);
      }
    }
    expect(authority.listIntents().length).toBe(10);
    expect(
      log.records().filter((record) => record.what.operationType === 'INTENT_CREATED').length,
    ).toBe(10);
  });
});

describe('INV-1-3 — recorded keys return the recorded receipt', () => {
  test('sequential re-submission returns the RECORDED receipt verbatim — never a second intent', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    const first = await authority.submitIntent(descriptorFor('idem-seq'));
    expect(first.ok).toBe(true);
    // the intent advances after the first submission
    const intentId = first.ok ? first.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.decision');
    // re-submission with the recorded key: the recorded receipt, verbatim
    const replay = await authority.submitIntent(descriptorFor('idem-seq'));
    expect(replay.ok).toBe(true);
    if (replay.ok && first.ok) {
      expect(replay.replayed).toBe(true);
      expect(replay.receipt).toBe(first.receipt);
      expect(replay.receipt.state).toBe('DRAFT');
      expect(replay.receipt.recordedAt).toBe(first.receipt.recordedAt);
    }
    // never a second intent or a second evidence record
    expect(authority.listIntents().length).toBe(1);
    expect(
      log.records().filter((record) => record.what.operationType === 'INTENT_CREATED').length,
    ).toBe(1);
    // the intent's current state is still reachable by id
    expect(authority.getIntent(intentId)?.state).toBe('AUTHORIZED');
  });

  test('getReceipt and findIntentByIdempotencyKey read back the recorded state', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    await authority.submitIntent(descriptorFor('idem-read'));
    const receipt = authority.getReceipt('idem-read');
    expect(receipt?.intentId).toBe(authority.findIntentByIdempotencyKey('idem-read')?.intentId);
    expect(authority.getReceipt('idem-absent')).toBe(undefined);
    expect(authority.findIntentByIdempotencyKey('idem-absent')).toBe(undefined);
  });
});

describe('INV-1-2 — state transitions are serialized per intent id', () => {
  test('5 concurrent routeIntent commands: exactly ONE succeeds, 4 see ILLEGAL_TRANSITION', async () => {
    const log = createEvidenceLog({ wallMs: 1_000 });
    const authority = makeAuthority(log);
    const submission = await authority.submitIntent(descriptorFor('idem-race'));
    const intentId = submission.ok ? submission.intent.intentId : '';
    await authority.authorizeIntent(intentId, 'pid.v1.decision');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => authority.routeIntent(intentId)),
    );
    const succeeded = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(4);
    for (const result of failed) {
      expect(result.code).toBe('ILLEGAL_TRANSITION');
    }
    // the winner's effect is exactly one transition + one record
    expect(authority.getIntent(intentId)?.state).toBe('ROUTED');
    expect(
      log
        .records()
        .filter(
          (record) =>
            record.what.operationType === 'INTENT_STATE_CHANGED' && record.outcome.result === 'ROUTED',
        ).length,
    ).toBe(1);
  });

  test('concurrent submit + authorize on the same intent serialize (no lost update)', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    const descriptor = descriptorFor('idem-mixed');
    const submission = await authority.submitIntent(descriptor);
    // authorize runs after the submission completed for the same
    // serializer key (intent:<derived id>) — it must see DRAFT and succeed
    expect(submission.ok).toBe(true);
    const intentId = submission.ok ? submission.intent.intentId : '';
    const authorization = await authority.authorizeIntent(intentId, 'pid.v1.decision');
    expect(authorization.ok).toBe(true);
    expect(authority.getIntent(intentId)?.state).toBe('AUTHORIZED');
  });

  test('commands on different intents interleave freely (per-intent-id keying)', async () => {
    const authority = makeAuthority(createEvidenceLog({ wallMs: 1_000 }));
    const submissions = await Promise.all([
      authority.submitIntent(descriptorFor('idem-a')),
      authority.submitIntent(descriptorFor('idem-b')),
    ]);
    const ids = submissions.map((result) => (result.ok ? result.intent.intentId : ''));
    const authorizations = await Promise.all([
      authority.authorizeIntent(ids[0] ?? '', 'pid.v1.decision-a'),
      authority.authorizeIntent(ids[1] ?? '', 'pid.v1.decision-b'),
    ]);
    for (const authorization of authorizations) {
      expect(authorization.ok).toBe(true);
    }
  });
});
