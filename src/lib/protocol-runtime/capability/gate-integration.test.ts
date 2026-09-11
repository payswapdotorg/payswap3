/**
 * RTN-005 — Capability ACTIVATION gate integration tests: the Capability
 * Authority wired to the REAL RTN-003 gate interface with REAL compliance
 * checks (CAPABILITY_REGISTRATION subjects).
 *
 * Source of the tested contract:
 *   spec/architecture/v0.1/core.md §3 lines 207-208:
 *     "Depends on area 15 for evidence and area 16 for risk gating of
 *      capability registration."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §2 Area 16, lines
 *   129-131 (INV-16-3):
 *     "state transitions gated by compliance (intent AUTHORIZATION,
 *      capability ACTIVATION) cannot complete without a terminal APPROVED
 *      record for the subject."
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { money } from '../kernel/money.ts';
import { createEvidenceLog } from '../evidence/log.ts';
import { evaluateComplianceCheck } from '../risk/evaluation.ts';
import type { ComplianceCheckRecord } from '../risk/evaluation.ts';
import { decideComplianceCheck, routeComplianceCheckForReview } from '../risk/check.ts';
import { authorRiskRule, publishRiskRuleVersion } from '../risk/rule.ts';
import { createScreeningList } from '../risk/screening.ts';
import { deriveSubjectDataHash, subjectComplianceData } from '../risk/subject.ts';
import { evaluateComplianceGate } from '../risk/gate.ts';
import { CapabilityAuthority } from './authority.ts';
import type { CapabilityActivationGate } from './authority.ts';

const WHEN = protocolTime(10, 1_000);
const LATER = protocolTime(11, 2_000);

const DECLARATION = {
  railId: 'rail-a',
  corridor: {
    sourceCurrency: 'EUR',
    destinationCurrency: 'USD',
    sourceGeography: 'DE',
    destinationGeography: 'US',
  },
  costSchedule: money('USD', 50, 2),
  tier: 'standard',
};

function capabilitySubject(subjectId: string) {
  return subjectComplianceData({
    subjectId,
    subjectKind: 'CAPABILITY_REGISTRATION',
    countFacts: [{ name: 'rails', count: 3 }],
  });
}

function approvedCheck(subjectId: string): ComplianceCheckRecord {
  return decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [],
      screeningList: createScreeningList('sanctions', 1, []),
      subject: capabilitySubject(subjectId),
      evaluatedAt: WHEN,
    }) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function deniedCheck(subjectId: string): ComplianceCheckRecord {
  const drafted = authorRiskRule('rail-count', {
    kind: 'THRESHOLD',
    fact: { factClass: 'COUNT', name: 'rails' },
    operator: 'GT',
    bound: { boundClass: 'COUNT', count: 2 },
    onBreach: 'DENY',
  });
  const published = publishRiskRuleVersion(drafted, 1);
  return decideComplianceCheck(
    evaluateComplianceCheck({
      rules: [published.ok ? published.rule : drafted],
      screeningList: createScreeningList('sanctions', 1, []),
      subject: capabilitySubject(subjectId),
      evaluatedAt: WHEN,
    }) as Parameters<typeof decideComplianceCheck>[0],
    LATER,
  );
}

function undecidedCheck(subjectId: string): ComplianceCheckRecord {
  const subject = subjectComplianceData({
    subjectId,
    subjectKind: 'CAPABILITY_REGISTRATION',
    countFacts: [{ name: 'rails', count: 3 }],
  });
  return routeComplianceCheckForReview(
    evaluateComplianceCheck({
      rules: [],
      screeningList: createScreeningList('sanctions', 1, [deriveSubjectDataHash(subject)]),
      subject,
      evaluatedAt: WHEN,
    }) as Parameters<typeof routeComplianceCheckForReview>[0],
    LATER,
  );
}

function gateOver(checkFor: (subjectId: string) => ComplianceCheckRecord): CapabilityActivationGate {
  return (subjectId: string) => evaluateComplianceGate([checkFor(subjectId)], 'capability.ACTIVATION', subjectId);
}

function makeAuthority(gate: CapabilityActivationGate) {
  const log = createEvidenceLog({ wallMs: 1_000 });
  let wall = 1_000;
  const authority = new CapabilityAuthority({
    evidence: log,
    gate,
    wallClock: () => {
      wall += 1;
      return wall;
    },
  });
  return { log, authority };
}

describe('INV-16-3 (capability side) — no ACTIVE without a terminal APPROVED record', () => {
  test('an APPROVED CAPABILITY_REGISTRATION check allows ACTIVATION', async () => {
    const { log, authority } = makeAuthority(gateOver((subjectId) => approvedCheck(subjectId)));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const result = await authority.activateCapability('cap-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.state).toBe('ACTIVE');
    }
    expect(
      log.records().filter((entry) => entry.what.operationType === 'CAPABILITY_STATE_CHANGED').length,
    ).toBe(1);
  });

  test('no check at all blocks ACTIVATION; the capability stays REGISTERED with no evidence', async () => {
    const { log, authority } = makeAuthority((subjectId) =>
      evaluateComplianceGate([], 'capability.ACTIVATION', subjectId),
    );
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const before = log.height;
    const result = await authority.activateCapability('cap-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COMPLIANCE_BLOCKED');
      expect(result.problem).toContain('NO_APPROVED_CHECK');
    }
    expect(authority.getCapability('cap-1')?.state).toBe('REGISTERED');
    expect(log.height).toBe(before);
  });

  test('an undecided MANUAL_REVIEW check blocks until resolved', async () => {
    const { authority } = makeAuthority(gateOver((subjectId) => undecidedCheck(subjectId)));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const result = await authority.activateCapability('cap-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('COMPLIANCE_BLOCKED');
      expect(result.problem).toContain('CHECK_UNDECIDED');
    }
  });

  test('a DENIED check blocks (terminal negative)', async () => {
    const { authority } = makeAuthority(gateOver((subjectId) => deniedCheck(subjectId)));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const result = await authority.activateCapability('cap-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('CHECK_DENIED');
    }
  });

  test('an INTENT-kind check never authorizes the capability ACTIVATION gate (subject-kind matching)', async () => {
    const intentCheck = decideComplianceCheck(
      evaluateComplianceCheck({
        rules: [],
        screeningList: createScreeningList('sanctions', 1, []),
        subject: subjectComplianceData({
          subjectId: 'cap-1',
          subjectKind: 'INTENT',
          moneyFacts: [{ currency: 'EUR', amountMinor: 100 }],
        }),
        evaluatedAt: WHEN,
      }) as Parameters<typeof decideComplianceCheck>[0],
      LATER,
    );
    const { authority } = makeAuthority(() => evaluateComplianceGate([intentCheck], 'capability.ACTIVATION', 'cap-1'));
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    const result = await authority.activateCapability('cap-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toContain('NO_APPROVED_CHECK');
    }
  });

  test('a blocked activation can be resolved: gate approval later allows the retry', async () => {
    let approved = false;
    const { authority } = makeAuthority((subjectId) =>
      evaluateComplianceGate(
        [approved ? approvedCheck(subjectId) : undecidedCheck(subjectId)],
        'capability.ACTIVATION',
        subjectId,
      ),
    );
    await authority.registerCapability({
      capabilityId: 'cap-1',
      declaration: DECLARATION,
      declaredCapacity: money('EUR', 5_000, 2),
    });
    expect((await authority.activateCapability('cap-1')).ok).toBe(false);
    approved = true;
    expect((await authority.activateCapability('cap-1')).ok).toBe(true);
    expect(authority.getCapability('cap-1')?.state).toBe('ACTIVE');
  });
});
