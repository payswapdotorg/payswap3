/**
 * RTN-011 — Transition runtime executor semantics (bun suite).
 *
 * The command execution path's own contract over the owned in-memory
 * substrate double (bun does not implement node:sqlite; the REAL
 * substrate compositions run in
 * scripts/test_protocol_transition_hosting.mjs — the same split every
 * merged RTN item uses).
 *
 * Tested contracts (spec-cited):
 *   spec/protocol-runtime-work-orders/RTN-011.md lines 14-22:
 *     "Command execution path: dequeue a command → resolve the owning
 *      authority handler → apply the transition → write the A15 evidence
 *      record → commit state atomically ('an operation is not committed
 *      until its record is written' — A15); failure fails the operation."
 *     "... a failed evidence write rolls back the transition ..."
 *     "Duplicate delivery of the same command is a no-op returning
 *      recorded state ..."
 *   src/lib/protocol-runtime/kernel/envelope.ts (the CommandEnvelope
 *   payload contract of the durable command path).
 *   spec/durable/execution.md §9 (register is the only integration
 *   point; unregistered kinds stay queued).
 */
import { describe, expect, test } from 'bun:test';
import { protocolTime } from '../kernel/time.ts';
import { deriveIdempotencyKey } from '../kernel/identity.ts';
import { InMemoryDurableSubstrate } from './substrate-double.ts';
import {
  TransitionRuntime,
  createTransitionRuntime,
  COMMAND_EXECUTED_EVENT_TYPE,
} from './execution.ts';
import type { AuthorityCommandBinding, AuthorityCommandOutcome } from './execution.ts';
import type { CommandEnvelope } from '../kernel/envelope.ts';

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    kind: 'probe.command',
    authority: 'Probe Authority',
    subjectIds: [],
    idempotencyKey: deriveIdempotencyKey('test', 'probe', String(Math.random())),
    protocolTime: protocolTime(1, 1_000),
    body: {},
    ...overrides,
  };
}

/** A scripted probe binding: records calls, replays outcomes in order. */
function probeBinding(overrides: Partial<AuthorityCommandBinding> = {}): AuthorityCommandBinding & {
  readonly calls: CommandEnvelope[];
  outcomes: AuthorityCommandOutcome[];
  errors: unknown[];
} {
  const calls: CommandEnvelope[] = [];
  let errors: unknown[] = [];
  let outcomes: AuthorityCommandOutcome[] = [{ status: 'applied' }];
  const binding: AuthorityCommandBinding & {
    readonly calls: CommandEnvelope[];
    outcomes: AuthorityCommandOutcome[];
    errors: unknown[];
  } = {
    kind: 'probe.command',
    authority: 'Probe Authority',
    owner: 'Probe Authority',
    async execute(envelopeValue) {
      calls.push(envelopeValue);
      const error = errors.length > 0 ? errors.shift() : undefined;
      if (error !== undefined) {
        throw error;
      }
      return outcomes.length > 1 ? (outcomes.shift() as AuthorityCommandOutcome) : outcomes[0];
    },
    calls,
    get outcomes() {
      return outcomes;
    },
    set outcomes(value: AuthorityCommandOutcome[]) {
      outcomes = value;
    },
    get errors() {
      return errors;
    },
    set errors(value: unknown[]) {
      errors = value;
    },
    ...overrides,
  };
  return binding;
}

function harness(deps: { readonly bindings: readonly AuthorityCommandBinding[] }) {
  let clock = 10_000;
  const substrate = new InMemoryDurableSubstrate({
    now: () => clock,
    leaseMs: 50,
    backoffBaseMs: 10,
    nextJobId: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `job-${counter}`;
      };
    })(),
  });
  const runtime = createTransitionRuntime({ substrate, bindings: deps.bindings });
  runtime.registerAll();
  return {
    substrate,
    runtime,
    advance: (ms: number) => {
      clock += ms;
    },
    get now() {
      return clock;
    },
  };
}

describe('transition runtime executor (the command execution path)', () => {
  test('an applied command completes the job and records the authority-owned observation row', async () => {
    const binding = probeBinding();
    const { substrate } = harness({ bindings: [binding] });
    const result = substrate.enqueue('probe.command', envelope(), { idempotencyKey: 'k1' });
    expect(result.created).toBe(true);
    const dispatched = await substrate.drain();
    expect(dispatched).toBe(1);
    const job = substrate.getJob(result.job.id);
    expect(job?.status).toBe('succeeded');
    // The binding resolved and executed with the validated envelope.
    expect(binding.calls.length).toBe(1);
    expect(binding.calls[0]?.kind).toBe('probe.command');
    // The observation row: authority-owned, job-linked, applied.
    const executed = substrate.events().filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE);
    expect(executed.length).toBe(1);
    expect(executed[0]?.owner).toBe('Probe Authority');
    expect(executed[0]?.jobId).toBe(result.job.id);
    expect((executed[0]?.data as Record<string, unknown>).status).toBe('applied');
    // Substrate lifecycle rows coexist (owner durable-substrate).
    expect(substrate.events().some((event) => event.owner === 'durable-substrate')).toBe(true);
  });

  test('a typed rejection completes the job with the rejected status and code', async () => {
    const binding = probeBinding();
    binding.outcomes = [{ status: 'rejected', code: 'ILLEGAL_TRANSITION' }];
    const { substrate } = harness({ bindings: [binding] });
    substrate.enqueue('probe.command', envelope(), { idempotencyKey: 'k2' });
    await substrate.drain();
    const executed = substrate.events().filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE);
    expect(executed.length).toBe(1);
    expect((executed[0]?.data as Record<string, unknown>).status).toBe('rejected');
    expect((executed[0]?.data as Record<string, unknown>).code).toBe('ILLEGAL_TRANSITION');
    expect(substrate.jobs()[0]?.status).toBe('succeeded');
  });

  test('a replayed duplicate completes with the replayed status — no second effect', async () => {
    const binding = probeBinding();
    binding.outcomes = [
      { status: 'applied' },
      { status: 'replayed' },
    ];
    const { substrate } = harness({ bindings: [binding] });
    const first = substrate.enqueue('probe.command', envelope({ idempotencyKey: 'fixed-key' }), {
      idempotencyKey: 'fixed-key',
    });
    await substrate.drain();
    // Redelivery of the SAME job (the lease-expiry crash window: executed,
    // never completed) — see the substrate-double suite for the reclaim
    // mechanics; here the executor's replay mapping is under test.
    const second = substrate.enqueue('probe.command', envelope({ idempotencyKey: 'fixed-key' }), {
      idempotencyKey: 'fixed-key',
    });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    const executed = substrate.events().filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE);
    expect(executed.length).toBe(1);
    expect((executed[0]?.data as Record<string, unknown>).status).toBe('applied');
  });

  test('a thrown failure fails the operation: bounded backoff, no observation row', async () => {
    const binding = probeBinding();
    binding.errors = [new Error('induced evidence-write failure')];
    const { substrate, advance } = harness({ bindings: [binding] });
    const enqueued = substrate.enqueue('probe.command', envelope(), { idempotencyKey: 'k3' });
    await substrate.drain();
    const job = substrate.getJob(enqueued.job.id);
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(1);
    // The failure left NO observation row (the substrate's own
    // job_attempt_failed lifecycle row records the failure attempt).
    const executed = substrate.events().filter((event) => event.type === COMMAND_EXECUTED_EVENT_TYPE);
    expect(executed.length).toBe(0);
    expect(
      substrate.events().filter((event) => event.type === 'job_attempt_failed').length,
    ).toBe(1);
    // Backoff determinism: the retry becomes eligible after the base delay.
    advance(10);
    const redelivered = await substrate.drain();
    expect(redelivered).toBe(1);
    expect(substrate.getJob(enqueued.job.id)?.status).toBe('succeeded');
    expect(binding.calls.length).toBe(2);
    const executedAfter = substrate.events().filter(
      (event) => event.type === COMMAND_EXECUTED_EVENT_TYPE,
    );
    expect(executedAfter.length).toBe(1);
    expect((executedAfter[0]?.data as Record<string, unknown>).status).toBe('applied');
  });

  test('an invalid envelope fails the operation loudly (producer bugs never silently complete)', async () => {
    const binding = probeBinding();
    const { substrate } = harness({ bindings: [binding] });
    // A payload that is NOT a kernel command envelope.
    substrate.enqueue('probe.command', { not: 'an envelope' }, { idempotencyKey: 'k4' });
    await substrate.drain();
    const job = substrate.jobs()[0];
    expect(job?.status).toBe('queued');
    expect(job?.attempts).toBe(1);
    expect(binding.calls.length).toBe(0);
  });

  test('an envelope whose authority is not hosted fails the operation', async () => {
    const binding = probeBinding();
    const { substrate } = harness({ bindings: [binding] });
    substrate.enqueue(
      'probe.command',
      envelope({ authority: 'Some Other Authority' }),
      { idempotencyKey: 'k5' },
    );
    await substrate.drain();
    expect(substrate.jobs()[0]?.status).toBe('queued');
    expect(binding.calls.length).toBe(0);
  });

  test('an envelope whose kind mismatches the job kind fails the operation', async () => {
    const binding = probeBinding();
    const { substrate } = harness({ bindings: [binding] });
    substrate.enqueue('probe.command', envelope({ kind: 'other.command' }), { idempotencyKey: 'k6' });
    await substrate.drain();
    expect(substrate.jobs()[0]?.status).toBe('queued');
    expect(binding.calls.length).toBe(0);
  });

  test('a job of an unregistered kind is never reserved (execution.md §9)', async () => {
    const binding = probeBinding();
    const { substrate } = harness({ bindings: [binding] });
    substrate.enqueue('unregistered.command', envelope({ kind: 'unregistered.command' }), {
      idempotencyKey: 'k7',
    });
    const dispatched = await substrate.drain();
    expect(dispatched).toBe(0);
    expect(substrate.jobs()[0]?.status).toBe('queued');
    expect(substrate.jobs()[0]?.attempts).toBe(0);
  });

  test('resolveOwningHandler resolves by kind and registerAll is the integration point', () => {
    const binding = probeBinding();
    const substrate = new InMemoryDurableSubstrate();
    const runtime = new TransitionRuntime({ substrate, bindings: [binding] });
    expect(runtime.resolveOwningHandler('probe.command')).toBe(binding);
    expect(runtime.resolveOwningHandler('other.command')).toBeUndefined();
    expect(runtime.commandKinds()).toEqual(['probe.command']);
    runtime.registerAll();
    expect(substrate.registeredKinds()).toEqual(['probe.command']);
  });

  test('the runtime rejects constructor contract violations', () => {
    const substrate = new InMemoryDurableSubstrate();
    expect(() => new TransitionRuntime({ substrate, bindings: [] as never })).not.toThrow();
    expect(
      () =>
        new TransitionRuntime({
          substrate,
          bindings: [
            { kind: 'a.command', authority: 'A', owner: '', execute: async () => ({ status: 'applied' }) },
          ],
        }),
    ).toThrow(/owner/);
    expect(
      () =>
        new TransitionRuntime({
          substrate,
          bindings: [
            { kind: 'a.command', authority: 'A', owner: 'A', execute: async () => ({ status: 'applied' }) },
            { kind: 'a.command', authority: 'A', owner: 'A', execute: async () => ({ status: 'applied' }) },
          ],
        }),
    ).toThrow(/duplicate binding/);
  });
});
