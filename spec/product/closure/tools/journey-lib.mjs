/**
 * UI-010 evidence tooling — the shared composition library.
 *
 * Composes the REAL protocol runtime EXACTLY as the product's single
 * server-side composition root (src/lib/protocol/server-runtime.ts — the
 * UI-011 splice) does: the barrel's documented order
 *
 *     substrate → evidence → authorities → persist hooks → bindings →
 *     transition → gateway → scheduler
 *
 * — the same classes, the same D-1 intent.submit integration binding, the
 * same D-2 gateway-kind aliases, the same persist hooks, the same gateway
 * construction, and then THE PRODUCT SPLICE: the seven runtime adapters
 * (src/lib/protocol/runtime-*-adapter.ts) created over the handle and
 * registered into the product port modules (register*PortBacking).
 *
 * Two deliberate, recorded deviations from server-runtime.ts:
 *   1. the runtime directory is parameterized (the harness composes over
 *      its own fresh directory, never the app's var/web-runtime/ — one
 *      writer per store);
 *   2. `drain()` is the composed-journey harness's documented pattern
 *      (tick until quiescent — scripts/test_protocol_composed_journey.mjs)
 *      instead of server-runtime.ts's `worker.stop()`: the probe
 *      (probe-drain.mjs) evidences why — stop() halts the worker without
 *      executing queued jobs. With a tick-based drain the SAME composition
 *      executes admitted commands exactly once, which is what the journey
 *      evidence requires.
 *
 * The authorities not exposed on the frozen ProtocolRuntimeHandle (policy,
 * routing, reservations, settlement, clearing, netting, risk, rails) are
 * returned on the composition object for driving the authority-level steps
 * of the workflows exactly as the repo's own plain-Node harnesses drive
 * them (the composed-journey precedent: authority commands on the owning
 * authorities' command surfaces, every step still evidenced in the real
 * A15 log).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const U = (relative) => pathToFileURL(join(REPO, 'src', 'lib', relative)).href;

const {
  openTransitionSubstrate,
  asTransitionSubstrate,
  buildDurablePersistHooks,
  adaptRailEvidenceToRegistryNames,
} = await import(U('protocol-runtime/hosting/durable-binding.ts'));
const { createEvidenceLog } = await import(U('protocol-runtime/evidence/log.ts'));
const { openEvidenceStore, writeEvidenceRecord } = await import(U('protocol-runtime/evidence/persistence.ts'));
const { verifyEvidenceChain } = await import(U('protocol-runtime/evidence/chain.ts'));
const { createRiskComplianceAuthority } = await import(U('protocol-runtime/risk/authority.ts'));
const { IntentAuthority } = await import(U('protocol-runtime/intent/authority.ts'));
const { PolicyAuthority } = await import(U('protocol-runtime/policy/authority.ts'));
const { CapabilityAuthority } = await import(U('protocol-runtime/capability/authority.ts'));
const { openReservationLedger } = await import(U('protocol-runtime/reservations/ledger.ts'));
const { createReservationAcquisitionPort } = await import(U('protocol-runtime/reservations/acquisition.ts'));
const { LiquidityAuthority } = await import(U('protocol-runtime/liquidity/authority.ts'));
const { CreditAuthority } = await import(U('protocol-runtime/credit/authority.ts'));
const { RoutingAuthority } = await import(U('protocol-runtime/routing/authority.ts'));
const { ObligationLedgerAuthority } = await import(U('protocol-runtime/obligations/authority.ts'));
const { NettingAuthority } = await import(U('protocol-runtime/netting/authority.ts'));
const { SettlementAuthority } = await import(U('protocol-runtime/settlement/authority.ts'));
const { ClearingAuthority } = await import(U('protocol-runtime/clearing/authority.ts'));
const { QueueAuthority } = await import(U('protocol-runtime/queues/authority.ts'));
const { openRailsAuthorities } = await import(U('protocol-runtime/rails/runtime.ts'));
const {
  settlementPortFromAuthorities,
  obligationLedgerPortFromAuthority,
  nettingPortFromAuthority,
} = await import(U('protocol-runtime/settlement/ports.ts'));
const { SimulatedRail, createSimulatedRailAdapter } = await import(U('protocol-runtime/rails/adapters.ts'));
const { createAuthorityCommandBindings } = await import(U('protocol-runtime/hosting/bindings.ts'));
const { createTransitionRuntime } = await import(U('protocol-runtime/transition/execution.ts'));
const { wireRecurringCommandEmitters } = await import(U('protocol-runtime/hosting/scheduler-wiring.ts'));
const { ProtocolGateway, commandQueuePortFromDurableQueue } = await import(U('protocol-runtime/gateway/admission.ts'));
const { openIntentStore } = await import(U('protocol-runtime/intent/persistence.ts'));
const { openReservationsStore } = await import(U('protocol-runtime/reservations/persistence.ts'));
const { openObligationsStore } = await import(U('protocol-runtime/obligations/persistence.ts'));
const { openSettlementStore } = await import(U('protocol-runtime/settlement/persistence.ts'));
const { openClearingStore } = await import(U('protocol-runtime/clearing/persistence.ts'));
const { openNettingStore } = await import(U('protocol-runtime/netting/persistence.ts'));
const { openQueuesStore } = await import(U('protocol-runtime/queues/persistence.ts'));
const { protocolTime } = await import(U('protocol-runtime/kernel/time.ts'));
const { money } = await import(U('protocol-runtime/kernel/money.ts'));

// THE PRODUCT SPLICE — the seven runtime adapters and the port-module
// registration seams (the '@/' aliases resolve through alias-loader.mjs).
const { createRuntimeIntentAdapter } = await import(U('protocol/runtime-intent-adapter.ts'));
const { createRuntimeCheckoutAdapter } = await import(U('protocol/runtime-checkout-adapter.ts'));
const { createRuntimeCapabilityAdapter } = await import(U('protocol/runtime-capability-adapter.ts'));
const { createRuntimeTrackingAdapter } = await import(U('protocol/runtime-tracking-adapter.ts'));
const { createRuntimeWaitingAdapter } = await import(U('protocol/runtime-waiting-adapter.ts'));
const { createRuntimeLiquidityPortFactory } = await import(U('protocol/runtime-liquidity-adapter.ts'));
const { createRuntimeMediationAdapter } = await import(U('protocol/runtime-mediation-adapter.ts'));
const { registerIntentPortBacking } = await import(U('protocol/intent-port.ts'));
const { registerCheckoutPortBacking } = await import(U('protocol/checkout-port.ts'));
const { registerCapabilityPortBacking } = await import(U('protocol/capability-port.ts'));
const { registerTrackingPortBacking } = await import(U('protocol/tracking-port.ts'));
const { registerWaitingPortBacking } = await import(U('protocol/waiting-port.ts'));
const { registerLiquidityPortBacking } = await import(U('protocol/liquidity-port.ts'));
const { registerMediationPortBacking } = await import(U('protocol/mediation-port.ts'));
const { getIntentPort } = await import(U('protocol/intent-port.ts'));
const { getCheckoutPort } = await import(U('protocol/checkout-port.ts'));
const { getCapabilityPort } = await import(U('protocol/capability-port.ts'));
const { getTrackingPort } = await import(U('protocol/tracking-port.ts'));
const { getWaitingPort } = await import(U('protocol/waiting-port.ts'));
const { getLiquidityPort } = await import(U('protocol/liquidity-port.ts'));
const { getMediationPort } = await import(U('protocol/mediation-port.ts'));

export { verifyEvidenceChain };

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compose the runtime + the product port splice over `dir` (a fresh
 * directory — the caller creates/removes it). Returns the composition with
 * the full authority set, the gateway, the adapters, and a tick-based
 * drain that executes admitted commands until quiescent.
 */
export async function composeRuntime(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wallClock = () => Date.now();

  // 1. SUBSTRATE — the real DEP-003 durable command path.
  const durableRuntime = openTransitionSubstrate({
    dbPath: join(dir, 'durable.sqlite'),
    workerId: 'ui010-journey-worker',
    concurrency: 1,
  });
  const substrate = asTransitionSubstrate(durableRuntime);

  // 2. EVIDENCE — the real A15 log, bridged to the per-domain store.
  const evidenceStore = openEvidenceStore({ dbPath: join(dir, 'evidence.sqlite') });
  const log = createEvidenceLog({ wallMs: Date.now() });
  const evidence = {
    submit(record) {
      const before = log.height;
      log.submit(record);
      for (const written of log.records().slice(before)) {
        writeEvidenceRecord(evidenceStore, written);
      }
    },
  };

  // 3. AUTHORITIES — every merged command authority over the one log.
  const risk = createRiskComplianceAuthority({ evidence, store: { dbPath: join(dir, 'risk.sqlite') } });
  const intent = new IntentAuthority({
    evidence,
    gate: (subjectId) => risk.checkGate('intent.AUTHORIZATION', subjectId),
    wallClock,
  });
  const policy = new PolicyAuthority({ evidence, wallClock });
  const capability = new CapabilityAuthority({
    evidence,
    gate: (subjectId) => risk.checkGate('capability.ACTIVATION', subjectId),
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
  let settlementHoldProbe = () => false;
  const obligations = new ObligationLedgerAuthority({
    evidence,
    wallClock,
    settlementHold: (obligationId) => settlementHoldProbe(obligationId),
  });
  const netting = new NettingAuthority({ evidence, obligations, wallClock });
  const railsAuthorities = openRailsAuthorities(
    { dbPath: join(dir, 'rails.sqlite') },
    { evidence: adaptRailEvidenceToRegistryNames(evidence), wallClock },
  );
  const railAuthority = railsAuthorities.railAuthority;
  const reconciliation = railsAuthorities.reconciliation;
  const rail = new SimulatedRail('ui010-journey-rail', {});
  const connection = createSimulatedRailAdapter(rail, { wallClock });
  const settlement = new SettlementAuthority({
    evidence,
    rails: settlementPortFromAuthorities(railAuthority, reconciliation),
    obligations: obligationLedgerPortFromAuthority(obligations),
    netting: nettingPortFromAuthority(netting),
    wallClock,
  });
  settlementHoldProbe = (obligationId) =>
    settlement.isUnknownHeld({ kind: 'OBLIGATION', obligationId });
  const clearing = new ClearingAuthority({ evidence, sink: obligations, wallClock });
  const queues = new QueueAuthority({ evidence, wallClock });

  // 4. PERSIST HOOKS — the idempotent per-domain write-through.
  const persist = buildDurablePersistHooks({
    intent: openIntentStore({ dbPath: join(dir, 'intent.sqlite') }),
    reservations: openReservationsStore({ dbPath: join(dir, 'reservations.sqlite') }),
    obligations: openObligationsStore({ dbPath: join(dir, 'obligations.sqlite') }),
    settlement: openSettlementStore({ dbPath: join(dir, 'settlement.sqlite') }),
    clearing: openClearingStore({ dbPath: join(dir, 'clearing.sqlite') }),
    netting: openNettingStore({ dbPath: join(dir, 'netting.sqlite') }),
    queues: openQueuesStore({ dbPath: join(dir, 'queues.sqlite') }),
  });

  // 5. BINDINGS — the hosted command kinds (D-1 nested-body intent.submit
  //    integration binding + the D-2 gateway-kind aliases), exactly as the
  //    server composition registers them.
  const mergedBindings = createAuthorityCommandBindings({
    intent,
    reservations,
    obligations,
    settlement,
    railsReport: railAuthority,
    railConnection: connection,
    rails: {
      registerAdapter: (input) => railAuthority.registerAdapter(input),
      activateAdapter: (adapterId) => railAuthority.activateAdapter(adapterId),
      authorizeOperation: (input) => railAuthority.authorizeOperation(input),
      submitRailOperation: (operationId, conn) => railAuthority.submitRailOperation(operationId, conn),
    },
    reconciliation: {
      registerSource: (input) => reconciliation.registerSource(input),
      openCycle: (input) => reconciliation.openCycle(input),
      collectStatements: (cycleId, statements) => reconciliation.collectStatements(cycleId, statements),
      runMatching: (cycleId) => reconciliation.runMatching(cycleId),
      closeCycle: (cycleId) => reconciliation.closeCycle(cycleId),
    },
    clearing,
    netting,
    queues,
    persist,
  });
  const gatewayKindAliasBindings = [
    {
      kind: 'obligations.dispute.open',
      authority: 'Obligation Authority',
      owner: 'Obligation Authority',
      async execute(envelope) {
        const body = envelope.body;
        const result = await obligations.openDispute({
          kind: 'DISPUTE_OPEN',
          obligationId: String(body?.obligationId ?? ''),
          disputeId: String(body?.disputeId ?? ''),
        });
        return result.ok
          ? { status: 'applied', summary: { obligationId: result.value.obligationId, state: result.value.state } }
          : { status: 'rejected', code: result.code };
      },
    },
    {
      kind: 'queues.item.cancel',
      authority: 'Queue Authority',
      owner: 'Queue Authority',
      async execute(envelope) {
        const body = envelope.body;
        const result = await queues.cancelItem({
          itemId: String(body?.itemId ?? ''),
          reasonCode: (body?.reasonCode === 'ROUTE_FAILED_DETERMINISTIC'
            ? 'ROUTE_FAILED_DETERMINISTIC'
            : 'INTENT_CANCELLED'),
        });
        return result.ok
          ? { status: 'applied', summary: { itemId: result.record.itemId, state: result.record.state } }
          : { status: 'rejected', code: result.code };
      },
    },
  ];
  const bindings = [
    ...mergedBindings.filter((binding) => binding.kind !== 'intent.submit'),
    ...gatewayKindAliasBindings,
    {
      kind: 'intent.submit',
      authority: 'Intent Authority',
      owner: 'Intent Authority',
      async execute(envelope) {
        const body = envelope.body;
        const descriptor = body?.descriptor;
        if (
          descriptor === null ||
          typeof descriptor !== 'object' ||
          typeof descriptor.idempotencyKey !== 'string'
        ) {
          throw new TypeError(
            'intent.submit (integration adapter): body.descriptor must be a DemandDescriptor',
          );
        }
        const priorIntentId = body?.priorIntentId;
        const result = await intent.submitIntent(
          descriptor,
          typeof priorIntentId === 'string' && priorIntentId.length > 0 ? { priorIntentId } : {},
        );
        if (!result.ok) {
          return { status: 'rejected', code: result.code };
        }
        persist.intent?.(result.intent, result.receipt);
        return {
          status: result.replayed ? 'replayed' : 'applied',
          summary: { intentId: result.intent.intentId, state: result.intent.state },
        };
      },
    },
  ];

  // 6. TRANSITION — the single authoritative-state writer.
  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();

  // 7. GATEWAY — the sole admission point onto the SAME durable path.
  const gateway = new ProtocolGateway({
    evidence,
    queue: commandQueuePortFromDurableQueue(durableRuntime.queue),
    wallClock,
  });

  // 8. SCHEDULER + the worker's auto-poll.
  wireRecurringCommandEmitters(durableRuntime);
  durableRuntime.worker.start();

  // The tick-based drain (composed-journey harness pattern): reserve and
  // execute until quiescent, bounded. Deviation from server-runtime.ts's
  // worker.stop() drain — RECORDED (see the module doc and probe-drain.mjs).
  let drainSequence = 0;
  async function drain() {
    for (let pass = 0; pass < 50; pass += 1) {
      const dispatched = await durableRuntime.worker.tick();
      if (dispatched === 0) {
        // Dispatches are async; give in-flight handlers a moment and re-tick.
        await sleep(20);
        const again = await durableRuntime.worker.tick();
        if (again === 0) break;
      }
      await sleep(20);
    }
  }

  const handle = {
    gateway,
    evidenceLog: log,
    authorities: { intent, capability, liquidity, credit, queues, obligations, reconciliation },
    drain,
  };

  // 9. THE PRODUCT SPLICE — the seven runtime adapters over the handle.
  registerIntentPortBacking(createRuntimeIntentAdapter(handle));
  registerCheckoutPortBacking(createRuntimeCheckoutAdapter(handle));
  registerCapabilityPortBacking(createRuntimeCapabilityAdapter(handle));
  registerTrackingPortBacking(createRuntimeTrackingAdapter(handle));
  registerWaitingPortBacking(createRuntimeWaitingAdapter(handle));
  registerLiquidityPortBacking(createRuntimeLiquidityPortFactory(handle));
  registerMediationPortBacking(createRuntimeMediationAdapter(handle));

  return {
    dir,
    gateway,
    durableRuntime,
    substrate,
    evidenceLog: log,
    authorities: {
      risk,
      intent,
      policy,
      capability,
      routing,
      reservations,
      liquidity,
      credit,
      obligations,
      netting,
      settlement,
      clearing,
      queues,
      railAuthority,
      reconciliation,
    },
    ports: {
      intent: getIntentPort(),
      checkout: getCheckoutPort(),
      capability: getCapabilityPort(),
      tracking: getTrackingPort(),
      waiting: getWaitingPort(),
      liquidity: getLiquidityPort(),
      mediation: getMediationPort(),
    },
    drain,
    wallClock,
    money,
    protocolTime,
    async submitViaGateway(kind, authority, body, idempotencyKey, subjectIds = []) {
      drainSequence += 1;
      const envelope = {
        kind,
        authority,
        subjectIds,
        idempotencyKey,
        protocolTime: protocolTime(drainSequence, Date.now()),
        body,
      };
      const admission = await gateway.submitCommand(envelope);
      if (!admission.ok) {
        console.log(
          `    [gateway] ${kind} REJECTED: ${admission.reasonCode}${admission.field ? ` (field ${admission.field})` : ''} — ${admission.problem}`,
        );
      }
      if (admission.ok) {
        await drain();
      }
      return admission;
    },
    async close() {
      await durableRuntime.worker.stop();
      durableRuntime.stop?.();
    },
  };
}

/**
 * Drive the REAL risk authority's approval for one gate subject (the
 * composed-journey harness's approveGateSubject, verbatim pattern).
 */
const { subjectComplianceData } = await import(U('protocol-runtime/risk/subject.ts'));
export async function approveGateSubject(composition, subjectId, subjectKind, when) {
  const { risk } = composition.authorities;
  if (!composition.screeningListRegistered) {
    risk.registerScreeningList({ listId: 'sanctions', version: 1, entries: [] }, when);
    composition.screeningListRegistered = true;
  }
  const subject = subjectComplianceData({
    subjectId,
    subjectKind,
    ...(subjectKind === 'INTENT'
      ? { moneyFacts: [{ currency: 'USD', amountMinor: 200_00 }] }
      : { countFacts: [{ name: 'rails', count: 1 }] }),
  });
  const check = await risk.evaluateAndRecordCheck(subject, 'sanctions', when);
  const decided = await risk.decideCheck(check.checkId, when);
  return decided;
}
