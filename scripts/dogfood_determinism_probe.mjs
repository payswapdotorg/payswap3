#!/usr/bin/env node
/**
 * SYS-002 — the determinism probe (the tiny harness-support file for
 * scripts/test_full_system_dogfood.mjs's [dogfood:determinism] group).
 *
 * NOT a test harness (the scripts/test_*.mjs glob does not match it; the
 * ci-cd.md harnesses gate enumerates only test_* files) — the dogfood
 * harness spawns this probe TWICE, each run over a FRESH composition (a
 * fresh var/web-runtime/), and compares the receipt projections: the
 * protocol-deterministic paths must produce IDENTICAL receipts across the
 * seeded double-run (the SYS-002 acceptance's determinism arm; idempotent
 * replay per INV-1-3 is proven separately inside each run).
 *
 * Stdout carries EXACTLY ONE JSON object: { receipts, derived } — the
 * normalized receipt projection (kind, idempotencyKey, commandId,
 * outcome, replayed, created) plus the deterministic derived ids. All
 * diagnostics go to stderr. The projection EXCLUDES wall-clock time, job
 * ids and sequence numbers (environment, not content).
 */
import { register } from 'node:module';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WEB_RUNTIME_DIR = join(ROOT, 'var', 'web-runtime');

register(new URL('./ts_resolver.mjs', import.meta.url));

const URL_OF = (rel) => new URL(`file://${join(ROOT, rel)}`).href;

// Fresh runtime state for the deterministic run (gitignored runtime
// artifact; the parent harness ordered the composed-leg reads before the
// determinism leg for exactly this reason).
rmSync(WEB_RUNTIME_DIR, { recursive: true, force: true });

const serverRuntime = await import(URL_OF('src/lib/protocol/server-runtime.ts'));
const { deriveProtocolId } = await import(URL_OF('src/lib/protocol-runtime/kernel/identity.ts'));
const { demandDescriptor } = await import(URL_OF('src/lib/protocol-runtime/intent/descriptor.ts'));
const { obligationIdForOriginRecord } = await import(
  URL_OF('src/lib/protocol-runtime/obligations/state-machine.ts')
);
const { settlementInstructionIdFor } = await import(
  URL_OF('src/lib/protocol-runtime/settlement/state-machine.ts')
);

await serverRuntime.wireProductPortsToProtocolRuntime();
const handle = await serverRuntime.getProtocolRuntimeHandle();

let sequence = 1;
const receipts = [];
async function seededCommand(kind, authority, idempotencyKey, body, subjectIds = []) {
  const admission = await handle.gateway.submitCommand({
    kind,
    authority,
    subjectIds,
    idempotencyKey,
    protocolTime: { sequence: (sequence += 1), wallMs: Date.now() },
    body,
  });
  if (admission.ok) {
    await handle.drain();
  } else {
    // Fail-closed: the seeded journey's commands must be ADMITTED (a
    // refusal here is a probe bug, never a silent pass).
    process.stderr.write(
      `determinism probe: ${kind} refused at admission: ${admission.reasonCode}: ${admission.problem}\n`,
    );
    process.exit(1);
  }
  receipts.push({
    kind,
    idempotency_key: idempotencyKey,
    command_id: admission.receipt?.commandId ?? null,
    outcome: admission.receipt?.outcome ?? null,
    replayed: admission.replayed ?? null,
    created: admission.created ?? null,
  });
  return admission;
}

// THE seeded journey (fixed inputs; deterministic derivations throughout).
const INTENT_KEY = 'sys002.dogfood.probe.intent.001';
const intentId = deriveProtocolId('intent', INTENT_KEY);
const descriptor = demandDescriptor({
  amount: { amountMinor: 2500, currency: 'USD', scale: 2 },
  source: { currency: 'USD', geography: 'US', account: 'sys002-probe-src' },
  destination: { currency: 'USD', geography: 'US', account: 'sys002-probe-dst' },
  constraints: {
    deadlineEpochMs: 1_789_384_278_922,
    allowedRails: ['sim-bank'],
    costCeiling: { amountMinor: 500, currency: 'USD', scale: 2 },
  },
  idempotencyKey: INTENT_KEY,
});
await seededCommand('intent.submit', 'Intent Authority', INTENT_KEY, { descriptor });

await seededCommand('capability.register', 'Capability Authority', 'sys002.dogfood.probe.capability', {
  capabilityId: 'sys002-dogfood-probe-cap',
  declaration: {
    railId: 'sim-bank',
    corridor: { sourceCurrency: 'USD', sourceGeography: 'US', destinationCurrency: 'USD', destinationGeography: 'US' },
    costSchedule: { amountMinor: 50, currency: 'USD', scale: 2 },
    tier: 'standard',
  },
  declaredCapacity: { amountMinor: 500_00, currency: 'USD', scale: 2 },
});

const OBLIGATION_RECORD = 'sys002-dogfood-probe-record-1';
const obligationId = obligationIdForOriginRecord(OBLIGATION_RECORD);
await seededCommand('obligations.clearing.commit', 'Obligation Authority', `sys002.dogfood.probe.obligation`, {
  batchId: 'sys002-dogfood-probe-batch',
  recordId: OBLIGATION_RECORD,
  originActivityId: 'sys002-dogfood-probe-activity',
  originKind: 'INTENT',
  debtorParticipantId: 'probe-debtor',
  creditorParticipantId: 'probe-creditor',
  amount: { amountMinor: 2500, currency: 'USD', scale: 2 },
  reason: 'sys002 determinism probe fixture',
});

await seededCommand('queues.queue.create', 'Queue Authority', 'sys002.dogfood.probe.queue', {
  queueId: 'sys002-dogfood-probe-queue',
  policy: {
    orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
    maxWaitEpochMs: 86_400_000,
    releaseConditions: { requiredCapabilityTier: 'standard' },
  },
});
await seededCommand('queues.item.enqueue', 'Queue Authority', 'sys002.dogfood.probe.item', {
  queueId: 'sys002-dogfood-probe-queue',
  intentId,
  priorityClass: 1,
  terms: { intentId, terms: { amountMinor: 2500, currency: 'USD', scale: 2 } },
}, ['sys002-dogfood-probe-queue', intentId]);

const instructionId = settlementInstructionIdFor({ kind: 'OBLIGATION', obligationId }, 1);
await seededCommand('settlement.instruction.create', 'Settlement and Finality Authority', 'sys002.dogfood.probe.instruction', {
  subject: { kind: 'OBLIGATION', obligationId },
  beneficiary: 'probe-creditor',
}, [obligationId]);

// The idempotent replay (INV-1-3) inside one run: the same key returns the
// RECORDED receipt verbatim — the receipt identity the double-run asserts.
await seededCommand('intent.submit', 'Intent Authority', INTENT_KEY, { descriptor });

const projection = {
  receipts,
  derived: { intent_id: intentId, obligation_id: obligationId, instruction_id: instructionId },
};
process.stdout.write(`${JSON.stringify(projection)}\n`);
process.exit(0);
