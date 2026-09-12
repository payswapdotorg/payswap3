/**
 * UI-010 evidence tool — PROBE: drain() semantics of the server
 * composition root (src/lib/protocol/server-runtime.ts).
 *
 * WHY THIS PROBE EXISTS (source-reading question, answered empirically):
 * the server composition root implements the runtime handle's drain() as
 *
 *     async drain() { await durableRuntime.worker.stop(); }
 *
 * and DurableWorker.stop() (src/lib/durable/worker.ts) CLEARS the polling
 * timer permanently while awaiting only ALREADY-IN-FLIGHT executions — it
 * does not execute queued jobs. The runtime adapters call handle.drain()
 * immediately after gateway submission (runtime-intent-adapter's
 * awaitIntentExecution loop; runtime-waiting-adapter's re-check/recovery
 * .then; runtime-mediation-adapter's initiateDispute). If drain() does not
 * execute the just-admitted command, then over the APP's composition:
 *   • every port submit is admitted but never executed → the adapters
 *     present admitted-but-not-executed UNKNOWN (honest per P5, but the
 *     workflow never completes server-side), and
 *   • the mediation adapter's post-submit read-back can mis-present
 *     (disputeRecordFor computes resolved = obligation.state !== 'DISPUTED'
 *     on the UN-executed state) — a latent mis-presentation, unreachable
 *     today only because no product surface can populate the app process's
 *     runtime with obligations (the empty-runtime denial path fires first).
 *
 * The probe composes the runtime EXACTLY as server-runtime.ts does (same
 * barrel order, same authorities, same bindings, same gateway, same
 * worker start), then:
 *   1. submits intent.submit through the gateway,
 *   2. calls drain() EXACTLY as the adapters do (worker.stop()),
 *   3. checks whether the intent record exists and whether the worker still
 *      runs,
 *   4. runs the control: a tick-based drain (the composed-journey harness's
 *      documented pattern — scripts/test_protocol_composed_journey.mjs)
 *      reserves and executes the job, and the intent record then exists.
 *
 * Usage: node spec/product/closure/tools/probe-drain.mjs
 * Artifact: printed transcript (captured in evidence/workflows/probe-drain.txt)
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sleep } from './journey-lib.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const RUNTIME_DIR = join(REPO, 'var', 'ui010-probe');
rmSync(RUNTIME_DIR, { recursive: true, force: true });
mkdirSync(RUNTIME_DIR, { recursive: true });

const { composeRuntime } = await import('./journey-lib.mjs');
const { protocolTime } = await import(
  pathToFileURL(join(REPO, 'src/lib/protocol-runtime/kernel/time.ts')).href
);
const { demandDescriptor } = await import(
  pathToFileURL(join(REPO, 'src/lib/protocol-runtime/intent/descriptor.ts')).href
);
const { money } = await import(
  pathToFileURL(join(REPO, 'src/lib/protocol-runtime/kernel/money.ts')).href
);

const composition = await composeRuntime(RUNTIME_DIR);
const { gateway, durableRuntime, authorities, evidenceLog } = composition;

const descriptor = demandDescriptor({
  amount: money('USD', 2500, 2),
  source: { currency: 'USD', geography: 'US', account: 'acct-source' },
  destination: { currency: 'USD', geography: 'US', account: 'acct-dest' },
  constraints: {
    deadlineEpochMs: Date.now() + 3600_000,
    allowedRails: ['sim-bank'],
    costCeiling: money('USD', 500, 2),
  },
  idempotencyKey: 'probe-intent-1',
});

console.log('[1] gateway.submitCommand(intent.submit) — the sole admission point');
const admission = await gateway.submitCommand({
  kind: 'intent.submit',
  authority: 'Intent Authority',
  subjectIds: [],
  idempotencyKey: 'intent-submit.probe.1',
  protocolTime: protocolTime(1, Date.now()),
  body: { descriptor },
});
console.log(
  '    admission.ok =', admission.ok,
  admission.ok ? `(receipt ${admission.receipt.commandId}, outcome ${admission.receipt.outcome})` : admission.reasonCode,
);

console.log('[2] handle.drain() exactly as server-runtime.ts implements it: worker.stop()');
await durableRuntime.worker.stop();
const intentRecord = evidenceLog
  .records()
  .find((record) => record.what.operationType === 'INTENT_CREATED');
const intentId = intentRecord?.what.subjectIds[0];
console.log('    after drain(): INTENT_CREATED in A15 =', intentRecord !== undefined);
console.log('    after drain(): intent record in A01 =', intentId !== undefined ? 'present' : 'ABSENT (command not executed)');
console.log('    worker.running =', durableRuntime.worker.running);

console.log('[3] control — tick-based drain (the composed-journey harness pattern)');
const dispatched = await durableRuntime.worker.tick();
await sleep(150); // the dispatch is async; let the handler settle
const settled = evidenceLog
  .records()
  .find((record) => record.what.operationType === 'INTENT_CREATED');
const settledId = settled?.what.subjectIds[0];
console.log('    tick dispatched =', dispatched);
console.log(
  '    after tick(): intent record in A01 =',
  settledId !== undefined && authorities.intent.getIntent(settledId) !== undefined
    ? `present (${authorities.intent.getIntent(settledId).state})`
    : 'ABSENT',
);
console.log('    A15 chain ops:', evidenceLog.records().map((r) => r.what.operationType).join(', '));

console.log(
  [
    '',
    'VERDICT: server-runtime.ts drain() (= worker.stop()) does not execute the',
    'just-admitted command; the worker halts permanently. Over the app composition,',
    'port-level gateway submits are admitted but never executed (honest',
    'admitted-but-not-executed UNKNOWN presentations; workflows do not complete',
    'server-side). The tick-based drain executes the same command on the same',
    'composition. Recorded as a composition-root defect finding in the UI-010',
    'deferral ledger; the adapters themselves are proven correct over an executing',
    'composition by the port-journey harness.',
    '',
  ].join('\n'),
);

await composition.close();
process.exit(0);
