/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — THE SERVER-SIDE RUNTIME COMPOSITION (the one composition root)
 * ════════════════════════════════════════════════════════════════════════
 *
 * THE web-boundary wiring of the sanctioned product splice
 * (rtn-plan-rulings.md Q5/delta 6): this module composes the protocol
 * runtime EXACTLY ONCE per server process, per the composed barrel's
 * documented composition order (src/lib/protocol-runtime/index.ts):
 *
 *     substrate → evidence → authorities → persist hooks → bindings →
 *     transition → gateway → scheduler
 *
 * — the same composition scripts/test_protocol_composed_journey.mjs
 * realizes end-to-end (RTN-012's evidence), extended with the A06/A07
 * authorities the liquidity port reads (composed exactly as the RTN-007
 * journey harness composes them: over the one evidence log and the area-5
 * ledger). It then builds the seven runtime adapters
 * (src/lib/protocol/runtime-*-adapter.ts) and registers them into the
 * port modules' backing slots (register*PortBacking — the UI-011 seams).
 * NOTHING else composes the runtime: the adapters receive the handle;
 * there is no second composition root.
 *
 * Node-only (the gateway/rails persistence modules import the DEP-003 db
 * layer over node:sqlite) — this module is imported ONLY by
 * src/instrumentation.ts (the Next.js server bootstrap hook, guarded to
 * the nodejs runtime) and never from any client-reachable module graph.
 *
 * Durable state: the per-domain SQLite stores live under
 * var/web-runtime/ (the repo's runtime-artifact directory, gitignored),
 * mirroring the composed journey harness's per-domain stores. The worker
 * auto-polls the durable command path (gateway → queue → worker →
 * transition runtime → owning authority — the single-writer discipline).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { ProtocolGateway, commandQueuePortFromDurableQueue } from '../protocol-runtime/gateway/admission.ts';
import { createEvidenceLog } from '../protocol-runtime/evidence/log.ts';
import {
  openEvidenceStore,
  writeEvidenceRecord,
} from '../protocol-runtime/evidence/persistence.ts';
import { openIntentStore } from '../protocol-runtime/intent/persistence.ts';
import { openReservationsStore } from '../protocol-runtime/reservations/persistence.ts';
import { openObligationsStore } from '../protocol-runtime/obligations/persistence.ts';
import { openSettlementStore } from '../protocol-runtime/settlement/persistence.ts';
import { openClearingStore } from '../protocol-runtime/clearing/persistence.ts';
import { openNettingStore } from '../protocol-runtime/netting/persistence.ts';
import { openQueuesStore } from '../protocol-runtime/queues/persistence.ts';
import { createRiskComplianceAuthority } from '../protocol-runtime/risk/authority.ts';
import { IntentAuthority } from '../protocol-runtime/intent/authority.ts';
import { PolicyAuthority } from '../protocol-runtime/policy/authority.ts';
import { CapabilityAuthority } from '../protocol-runtime/capability/authority.ts';
import { RoutingAuthority } from '../protocol-runtime/routing/authority.ts';
import { openReservationLedger } from '../protocol-runtime/reservations/ledger.ts';
import { createReservationAcquisitionPort } from '../protocol-runtime/reservations/acquisition.ts';
import { ObligationLedgerAuthority } from '../protocol-runtime/obligations/authority.ts';
import { NettingAuthority } from '../protocol-runtime/netting/authority.ts';
import { SettlementAuthority } from '../protocol-runtime/settlement/authority.ts';
import { ClearingAuthority } from '../protocol-runtime/clearing/authority.ts';
import { QueueAuthority } from '../protocol-runtime/queues/authority.ts';
import { LiquidityAuthority } from '../protocol-runtime/liquidity/authority.ts';
import { CreditAuthority } from '../protocol-runtime/credit/authority.ts';
import { openRailsAuthorities } from '../protocol-runtime/rails/runtime.ts';
import {
  settlementPortFromAuthorities,
  obligationLedgerPortFromAuthority,
  nettingPortFromAuthority,
} from '../protocol-runtime/settlement/ports.ts';
import { SimulatedRail, createSimulatedRailAdapter } from '../protocol-runtime/rails/adapters.ts';
import {
  openTransitionSubstrate,
  asTransitionSubstrate,
  buildDurablePersistHooks,
  adaptRailEvidenceToRegistryNames,
} from '../protocol-runtime/hosting/durable-binding.ts';
import { createAuthorityCommandBindings } from '../protocol-runtime/hosting/bindings.ts';
import { createTransitionRuntime } from '../protocol-runtime/transition/execution.ts';
import { wireRecurringCommandEmitters } from '../protocol-runtime/hosting/scheduler-wiring.ts';

import type { ProtocolRuntimeHandle } from './runtime-handle';
import { registerIntentPortBacking } from './intent-port';
import { registerCheckoutPortBacking } from './checkout-port';
import { registerCapabilityPortBacking } from './capability-port';
import { registerTrackingPortBacking } from './tracking-port';
import { registerWaitingPortBacking } from './waiting-port';
import { registerLiquidityPortBacking } from './liquidity-port';
import { registerMediationPortBacking } from './mediation-port';
import { createRuntimeIntentAdapter } from './runtime-intent-adapter';
import { createRuntimeCheckoutAdapter } from './runtime-checkout-adapter';
import { createRuntimeCapabilityAdapter } from './runtime-capability-adapter';
import { createRuntimeTrackingAdapter } from './runtime-tracking-adapter';
import { createRuntimeWaitingAdapter } from './runtime-waiting-adapter';
import { createRuntimeLiquidityPortFactory } from './runtime-liquidity-adapter';
import { createRuntimeMediationAdapter } from './runtime-mediation-adapter';

/** The runtime-artifact directory for the web app's composed runtime. */
const RUNTIME_DIR = join(process.cwd(), 'var', 'web-runtime');

let wired = false;

/**
 * Compose the runtime per the barrel's documented order and register the
 * seven runtime adapters as the product ports' backings. Idempotent per
 * process; called once from src/instrumentation.ts (nodejs runtime only).
 */
export async function wireProductPortsToProtocolRuntime(): Promise<void> {
  if (wired) {
    return;
  }
  wired = true;

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const wallClock = () => Date.now();

  // 1. SUBSTRATE — the real DEP-003 durable command path (queue + worker
  //    + scheduler + durable_events over node:sqlite).
  const durableRuntime = openTransitionSubstrate({
    dbPath: join(RUNTIME_DIR, 'durable.sqlite'),
    workerId: 'web-boundary-worker',
    concurrency: 1,
  });
  const substrate = asTransitionSubstrate(durableRuntime);

  // 2. EVIDENCE — the REAL A15 log, bridged to the evidence-object-store's
  //    per-domain persistence (one chain over every authority's records).
  const evidenceStore = openEvidenceStore({ dbPath: join(RUNTIME_DIR, 'evidence.sqlite') });
  const log = createEvidenceLog({ wallMs: Date.now() });
  const evidence = {
    submit(record: Parameters<typeof log.submit>[0]) {
      const before = log.height;
      log.submit(record);
      for (const written of log.records().slice(before)) {
        writeEvidenceRecord(evidenceStore, written);
      }
    },
  };

  // 3. AUTHORITIES — every merged command authority over the one log.
  const risk = createRiskComplianceAuthority({
    evidence,
    store: { dbPath: join(RUNTIME_DIR, 'risk.sqlite') },
  });
  const intent = new IntentAuthority({
    evidence,
    gate: (subjectId: string) => risk.checkGate('intent.AUTHORIZATION', subjectId),
    wallClock,
  });
  const policy = new PolicyAuthority({ evidence, wallClock });
  const capability = new CapabilityAuthority({
    evidence,
    gate: (subjectId: string) => risk.checkGate('capability.ACTIVATION', subjectId),
    wallClock,
  });
  const reservations = await openReservationLedger({ evidence, wallClock });
  const liquidity = new LiquidityAuthority({ evidence, ledger: reservations, wallClock });
  const credit = new CreditAuthority({ evidence, ledger: reservations, wallClock });
  const routing = new RoutingAuthority({
    evidence,
    reservations: createReservationAcquisitionPort(reservations),
    wallClock,
  });
  // The settlement-hold probe is late-bound (settlement is constructed
  // after obligations — the same cycle the composed-journey harness breaks
  // with its post-construction assignment; here it is injected through the
  // constructor's own deps seam).
  let settlementHoldProbe: (obligationId: string) => boolean = () => false;
  const obligations = new ObligationLedgerAuthority({
    evidence,
    wallClock,
    settlementHold: (obligationId: string) => settlementHoldProbe(obligationId),
  });
  const netting = new NettingAuthority({ evidence, obligations, wallClock });
  const railsAuthorities = openRailsAuthorities(
    { dbPath: join(RUNTIME_DIR, 'rails.sqlite') },
    { evidence: adaptRailEvidenceToRegistryNames(evidence), wallClock },
  );
  const railAuthority = railsAuthorities.railAuthority;
  const reconciliation = railsAuthorities.reconciliation;
  const rail = new SimulatedRail('web-boundary-rail', {});
  const connection = createSimulatedRailAdapter(rail, { wallClock });
  const settlement = new SettlementAuthority({
    evidence,
    rails: settlementPortFromAuthorities(railAuthority, reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock,
  });
  settlementHoldProbe = (obligationId: string) =>
    settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  const clearing = new ClearingAuthority({ evidence, sink: obligations, wallClock });
  const queues = new QueueAuthority({ evidence, wallClock });

  // 4. PERSIST HOOKS — the idempotent per-domain durable write-through.
  const persist = buildDurablePersistHooks({
    intent: openIntentStore({ dbPath: join(RUNTIME_DIR, 'intent.sqlite') }),
    reservations: openReservationsStore({ dbPath: join(RUNTIME_DIR, 'reservations.sqlite') }),
    obligations: openObligationsStore({ dbPath: join(RUNTIME_DIR, 'obligations.sqlite') }),
    settlement: openSettlementStore({ dbPath: join(RUNTIME_DIR, 'settlement.sqlite') }),
    clearing: openClearingStore({ dbPath: join(RUNTIME_DIR, 'clearing.sqlite') }),
    netting: openNettingStore({ dbPath: join(RUNTIME_DIR, 'netting.sqlite') }),
    queues: openQueuesStore({ dbPath: join(RUNTIME_DIR, 'queues.sqlite') }),
  });

  // 5. BINDINGS — the hosted command kinds on the substrate. The
  //    intent.submit binding accepts the GATEWAY's DOCUMENTED nested body
  //    (the D-1 integration adapter pattern RTN-012 evidenced inside its
  //    harness; identical here: compose the SAME owning command and the
  //    SAME persist hook, keeping the gateway the sole admission point).
  const mergedBindings = createAuthorityCommandBindings({
    intent,
    reservations,
    obligations,
    settlement,
    railsReport: railAuthority,
    railConnection: connection,
    rails: {
      registerAdapter: (input: Parameters<typeof railAuthority.registerAdapter>[0]) =>
        railAuthority.registerAdapter(input),
      activateAdapter: (adapterId: string) => railAuthority.activateAdapter(adapterId),
      authorizeOperation: (input: Parameters<typeof railAuthority.authorizeOperation>[0]) =>
        railAuthority.authorizeOperation(input),
      submitRailOperation: (operationId: string, conn: unknown) =>
        railAuthority.submitRailOperation(operationId, conn as never),
    },
    reconciliation: {
      registerSource: (input: Parameters<typeof reconciliation.registerSource>[0]) =>
        reconciliation.registerSource(input),
      openCycle: (input: Parameters<typeof reconciliation.openCycle>[0]) =>
        reconciliation.openCycle(input),
      collectStatements: (cycleId: string, statements: unknown) =>
        reconciliation.collectStatements(cycleId, statements as never),
      runMatching: (cycleId: string) => reconciliation.runMatching(cycleId),
      closeCycle: (cycleId: string) => reconciliation.closeCycle(cycleId),
    },
    clearing,
    netting,
    queues,
    persist,
  });
  // D-2 GATEWAY-KIND ALIAS BINDINGS (the RTN-012 integration-adapter
  // pattern, applied on THIS composition for the kinds the product
  // adapters submit): the merged RTN-011 hosted bindings use the flat
  // harness vocabulary (obligation.*; no queue-item ops) while the
  // gateway admits the DOCUMENTED registry vocabulary (obligations.*;
  // queues.item.*) — INTEGRATION-EVIDENCE.md defect D-2. Each alias
  // accepts the GATEWAY's documented contract and drives the SAME owning
  // authority command through the SAME single-writer path: the gateway
  // remains the sole admission point and the transition runtime remains
  // the single writer.
  const gatewayKindAliasBindings = ([
    {
      kind: 'obligations.dispute.open',
      authority: 'Obligation Authority',
      owner: 'Obligation Authority',
      async execute(envelope: { body: { obligationId?: unknown; disputeId?: unknown } }) {
        const body = envelope.body;
        const result = await obligations.openDispute({
          kind: 'DISPUTE_OPEN',
          obligationId: String(body?.obligationId ?? ''),
          disputeId: String(body?.disputeId ?? ''),
        });
        return result.ok
          ? { status: 'applied' as const, summary: { obligationId: result.value.obligationId, state: result.value.state } }
          : { status: 'rejected' as const, code: result.code };
      },
    },
    {
      kind: 'queues.item.cancel',
      authority: 'Queue Authority',
      owner: 'Queue Authority',
      async execute(envelope: { body: { itemId?: unknown; reasonCode?: unknown } }) {
        const body = envelope.body;
        const result = await queues.cancelItem({
          itemId: String(body?.itemId ?? ''),
          reasonCode: (body?.reasonCode === 'ROUTE_FAILED_DETERMINISTIC'
            ? 'ROUTE_FAILED_DETERMINISTIC'
            : 'INTENT_CANCELLED') as 'INTENT_CANCELLED' | 'ROUTE_FAILED_DETERMINISTIC',
        });
        return result.ok
          ? { status: 'applied' as const, summary: { itemId: result.record.itemId, state: result.record.state } }
          : { status: 'rejected' as const, code: result.code };
      },
    },
  ] as unknown as (typeof mergedBindings)[number][]) as (typeof mergedBindings)[number][];

  const bindings = [
    ...mergedBindings.filter((binding) => binding.kind !== 'intent.submit'),
    ...gatewayKindAliasBindings,
    ({
      kind: 'intent.submit',
      authority: 'Intent Authority',
      owner: 'Intent Authority',
      async execute(envelope: { body: { descriptor?: unknown; priorIntentId?: unknown } }) {
        const body = envelope.body;
        const descriptor = body?.descriptor;
        if (
          descriptor === null ||
          typeof descriptor !== 'object' ||
          typeof (descriptor as { idempotencyKey?: unknown }).idempotencyKey !== 'string'
        ) {
          throw new TypeError(
            'intent.submit (integration adapter): body.descriptor must be a DemandDescriptor (validated at admission by the gateway\u2019s demandDescriptor minter)',
          );
        }
        const priorIntentId = body?.priorIntentId;
        const result = await intent.submitIntent(
          descriptor as Parameters<typeof intent.submitIntent>[0],
          typeof priorIntentId === 'string' && priorIntentId.length > 0 ? { priorIntentId } : {},
        );
        if (!result.ok) {
          return { status: 'rejected' as const, code: result.code };
        }
        persist.intent?.(result.intent, result.receipt);
        return {
          status: result.replayed ? ('replayed' as const) : ('applied' as const),
          summary: { intentId: result.intent.intentId, state: result.intent.state },
        };
      },
    }) as (typeof mergedBindings)[number],
  ];

  // 6. TRANSITION — the single authoritative-state writer, registered.
  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();

  // 7. GATEWAY — the sole admission point onto the SAME durable path.
  const gateway = new ProtocolGateway({
    evidence,
    queue: commandQueuePortFromDurableQueue(durableRuntime.queue),
    wallClock,
  });

  // 8. SCHEDULER — the timing-driven command emitters (the documented
  //    composition step; the recurring ticks submit through the gateway).
  wireRecurringCommandEmitters(durableRuntime);

  // The worker auto-polls the durable command path (the single-writer
  // execution loop: admitted commands execute exactly once).
  durableRuntime.worker.start();

  const handle: ProtocolRuntimeHandle = {
    gateway,
    evidenceLog: log,
    authorities: {
      intent,
      capability,
      liquidity,
      credit,
      queues,
      obligations,
      reconciliation,
    },
    async drain() {
      // One bounded pass: stop() awaits in-flight executions (the worker
      // auto-polls regardless; this makes reads-after-submit settle fast).
      await durableRuntime.worker.stop();
    },
  };

  // 9. THE PRODUCT SPLICE — register the seven runtime adapters.
  registerIntentPortBacking(createRuntimeIntentAdapter(handle));
  registerCheckoutPortBacking(createRuntimeCheckoutAdapter(handle));
  registerCapabilityPortBacking(createRuntimeCapabilityAdapter(handle));
  registerTrackingPortBacking(createRuntimeTrackingAdapter(handle));
  registerWaitingPortBacking(createRuntimeWaitingAdapter(handle));
  registerLiquidityPortBacking(createRuntimeLiquidityPortFactory(handle));
  registerMediationPortBacking(createRuntimeMediationAdapter(handle));
}
