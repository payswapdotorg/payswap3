/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-011 — PRODUCT ADAPTER TEST COMPOSITION (bun-safe)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The bun-test composition the product adapter suites
 * (src/lib/protocol/runtime-*-adapter.test.ts) share: the REAL gateway
 * admission class over the runtime's own in-memory substrate double (the
 * repository's documented bun/Node split — bun suites import the leaf
 * modules directly; the real node:sqlite compositions run in the
 * plain-Node harnesses), the real A15 evidence log, the real leaf
 * authorities, the hosted command bindings, and the transition runtime —
 * so every adapter test proves the ACTUAL command round-trip:
 *
 *   adapter call → ProtocolGateway.submitCommand (the sole admission
 *   point) → durable command path → transition runtime → owning authority
 *   (A15 record first, state after) — then reads back through the
 *   authority's public query API.
 *
 * The composition mirrors src/lib/protocol/server-runtime.ts (the Node
 * composition root) exactly where it matters: the same evidence log, the
 * same authorities, the same bindings (including the D-1 intent.submit
 * integration adapter binding accepting the gateway's documented nested
 * body), the same transition runtime, the same gateway construction. The
 * reconciliation authority (A14, rails-bound over node:sqlite) is not
 * loadable under bun; the adapters under test do not read it, so the
 * handle carries a typed placeholder for that slot only.
 */

import { InMemoryDurableSubstrate } from '../protocol-runtime/transition/substrate-double.ts';
import { createTransitionRuntime } from '../protocol-runtime/transition/execution.ts';
import { createAuthorityCommandBindings } from '../protocol-runtime/hosting/bindings.ts';
import { createEvidenceLog } from '../protocol-runtime/evidence/log.ts';
import { ProtocolGateway } from '../protocol-runtime/gateway/admission.ts';
import { IntentAuthority } from '../protocol-runtime/intent/authority.ts';
import { CapabilityAuthority } from '../protocol-runtime/capability/authority.ts';
import { openReservationLedger } from '../protocol-runtime/reservations/ledger.ts';
import { LiquidityAuthority } from '../protocol-runtime/liquidity/authority.ts';
import { CreditAuthority } from '../protocol-runtime/credit/authority.ts';
import { QueueAuthority } from '../protocol-runtime/queues/authority.ts';
import { ObligationLedgerAuthority } from '../protocol-runtime/obligations/authority.ts';
import { ClearingAuthority } from '../protocol-runtime/clearing/authority.ts';
import { NettingAuthority } from '../protocol-runtime/netting/authority.ts';
import type { CommandEnvelope } from '../protocol-runtime/kernel/envelope.ts';
import { protocolTime } from '../protocol-runtime/kernel/time.ts';
import type { ProtocolRuntimeHandle } from './runtime-handle';
import type { CommandAdmissionResult, ReconciliationAuthority } from '../protocol-runtime/index.ts';

/** The permissive compliance-gate double (A16 is rails-store bound; the
 * adapter tests under bun exercise gates only structurally). */
const permissiveGate = () => ({ allowed: true }) as ReturnType<IntentAuthority['submitIntent']> extends never ? never : { allowed: true };

export interface ProductTestComposition {
  readonly handle: ProtocolRuntimeHandle;
  readonly gateway: ProtocolRuntimeHandle['gateway'];
  readonly substrate: InMemoryDurableSubstrate;
  /**
   * The owning authorities, for driving kinds that are admitted by the
   * gateway but UN-HOSTED on the durable path (the D-2 vocabulary gap,
   * INTEGRATION-EVIDENCE.md) — exactly the composed-journey precedent:
   * "the composed journey drives those steps on the OWNING AUTHORITIES'
   * command surfaces, with every step still evidenced in the real A15
   * log". Every adapter-level command still flows through the gateway.
   */
  readonly authorities: ProtocolRuntimeHandle['authorities'];
  /** The A09 clearing authority (test-driving obligations into existence). */
  readonly clearing: ClearingAuthority;
  /** Submit a command through the gateway and drain the durable path. */
  submit(
    kind: string,
    authority: string,
    body: unknown,
    idempotencyKey: string,
    subjectIds?: string[],
  ): Promise<CommandAdmissionResult>;
}

export async function composeProductTestRuntime(): Promise<ProductTestComposition> {
  const substrate = new InMemoryDurableSubstrate({ now: () => 5_000 });
  const log = createEvidenceLog({ wallMs: 1_000 });
  const evidence = {
    submit(record: Parameters<typeof log.submit>[0]) {
      log.submit(record);
    },
  };

  const intent = new IntentAuthority({
    evidence,
    gate: permissiveGate as never,
    wallClock: () => 5_000,
  });
  const capability = new CapabilityAuthority({
    evidence,
    gate: permissiveGate as never,
    wallClock: () => 5_000,
  });
  const reservations = await openReservationLedger({ evidence, wallClock: () => 5_000 });
  const liquidity = new LiquidityAuthority({ evidence, ledger: reservations, wallClock: () => 5_000 });
  const credit = new CreditAuthority({ evidence, ledger: reservations, wallClock: () => 5_000 });
  const obligations = new ObligationLedgerAuthority({ evidence, wallClock: () => 5_000 });
  const netting = new NettingAuthority({ evidence, obligations, wallClock: () => 5_000 });
  const clearing = new ClearingAuthority({ evidence, sink: obligations, wallClock: () => 5_000 });
  const queues = new QueueAuthority({ evidence, wallClock: () => 5_000 });

  // The D-1 intent.submit integration binding (the gateway's documented
  // nested body → the owning submitIntent command) — mirroring the
  // server-side composition and the composed-journey harness.
  const intentSubmitGatewayBodyBinding = {
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
        throw new TypeError('intent.submit (integration adapter): body.descriptor must be a DemandDescriptor');
      }
      const priorIntentId = body?.priorIntentId;
      const result = await intent.submitIntent(
        descriptor as Parameters<typeof intent.submitIntent>[0],
        typeof priorIntentId === 'string' && priorIntentId.length > 0 ? { priorIntentId } : {},
      );
      if (!result.ok) {
        return { status: 'rejected' as const, code: result.code };
      }
      return {
        status: result.replayed ? ('replayed' as const) : ('applied' as const),
        summary: { intentId: result.intent.intentId, state: result.intent.state },
      };
    },
  };

  const mergedBindings = createAuthorityCommandBindings({
    intent,
    reservations,
    obligations,
    clearing,
    netting,
    queues,
  } as Parameters<typeof createAuthorityCommandBindings>[0]);
  // D-2 gateway-kind alias bindings (the RTN-012 integration-adapter
  // pattern — same as the server composition): the gateway's documented
  // kind names drive the SAME owning commands through the single-writer
  // path.
  const gatewayKindAliasBindings = [
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
  ];
  const bindings = [
    ...mergedBindings.filter((binding) => binding.kind !== 'intent.submit'),
    ...gatewayKindAliasBindings,
    intentSubmitGatewayBodyBinding,
  ] as unknown as Parameters<typeof createTransitionRuntime>[0]['bindings'];

  const runtime = createTransitionRuntime({ substrate, bindings });
  runtime.registerAll();

  // The gateway's command-queue port over the substrate's PUBLIC API (the
  // gateway's own construction seam — commandQueuePortFromDurableQueue's
  // in-memory analogue; NOT a second admission path: the ONLY caller of
  // this port is the gateway itself).
  const substrateEnqueue = substrate.enqueue.bind(substrate);
  const commandQueuePort = {
    enqueue(kind: string, payload: unknown, options: { idempotencyKey: string }) {
      const result = substrateEnqueue(kind, payload, { idempotencyKey: options.idempotencyKey });
      return { created: result.created, reason: result.reason, jobId: result.job.id };
    },
  };
  const gateway = new ProtocolGateway({
    evidence,
    queue: commandQueuePort,
    wallClock: () => 5_000,
  });

  let sequence = 0;
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
      // A14 is rails-store bound (node:sqlite — not bun-loadable); the
      // adapters under test never read it.
      reconciliation: {} as ReconciliationAuthority,
    },
    async drain() {
      await substrate.tick();
    },
  };

  async function submit(
    kind: string,
    authority: string,
    body: unknown,
    idempotencyKey: string,
    subjectIds: string[] = [],
  ) {
    sequence += 1;
    const envelope: CommandEnvelope = {
      kind,
      authority,
      subjectIds,
      idempotencyKey,
      protocolTime: protocolTime(sequence, 5_000),
      body: body as object,
    };
    const admission = await gateway.submitCommand(envelope);
    if (admission.ok) {
      await substrate.tick();
    }
    return admission as CommandAdmissionResult;
  }

  return { handle, gateway, substrate, authorities: handle.authorities, clearing, submit };
}
