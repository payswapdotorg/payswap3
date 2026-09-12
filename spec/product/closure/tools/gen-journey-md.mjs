/**
 * UI-010 evidence tooling — renders the port-journey JSON artifact into the
 * dogfooding-protocol journey-record markdown (spec/governance/
 * dogfooding-protocol.md "Journey record format"): per workflow — the
 * environment, the ordered steps with state before/after and outcomes, the
 * assertions, and the nine reconciliation questions (answered here from the
 * recorded artifacts; each answer cites where the evidence lives).
 *
 * Usage: node gen-journey-md.mjs   (reads ../evidence/workflows/port-journeys.json)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const EVIDENCE = join(HERE, '..', 'evidence', 'workflows');
const data = JSON.parse(readFileSync(join(EVIDENCE, 'port-journeys.json'), 'utf8'));
const { summary, journeys } = data;

// The nine reconciliation questions per workflow, answered from the recorded
// artifacts (evidence pointers included in each answer).
const NINE = {
  'WF-1': {
    protocolObject: 'PaymentIntent (A01) — DRAFT → AUTHORIZED over the frozen one-way table; the A15 INTENT_CREATED / INTENT_AUTHORIZED records; the gateway admission receipt for intent.submit (steps: EXPLICIT SUBMIT, AUTHORIZE).',
    owningAuthority: 'Intent Authority (A01) owns every intent state; the Evidence Authority (A15) owns the proof trail; the Capability Authority (A03) owns the quoted cost schedule; the protocol gateway owns admission.',
    runtimeBoundary: 'Product port call (server-side composition) → protocol gateway (the sole admission point) → durable command path → transition runtime → Intent Authority. The harness crosses the product/protocol boundary exactly as src/lib/protocol/runtime-intent-adapter.ts does.',
    deployedComponent: 'The composed protocol runtime in-process (node:sqlite substrate) + the seven runtime adapters — the same composition src/lib/protocol/server-runtime.ts wires for the app; here under the UI-010 journey harness (var/ui010-journeys/).',
    persistentState: 'Per-domain SQLite stores under var/ui010-journeys/ (intent.sqlite, evidence.sqlite, durable.sqlite, …) — the write-through persist hooks; the A15 chain is append-only.',
    unknownHandling: 'A never-submitted reference queries as no-answer → UNKNOWN with the reconciliation path (step: UNKNOWN READ); the tracking surface renders not-found with UNKNOWN-honest wording (step: UNKNOWN TRACKING). Both recorded verbatim in the JSON.',
    reconciliation: 'Re-check re-queries the A01 record; replayed submissions dedupe to the same intent (the deterministic submission identity); the A15 chain verification over the full journey log passes (VERIFIED, height recorded in the summary).',
    evidence: 'The A15 record chain (record ids, sequence numbers, hashes) surfaced through the tracking port evidenceTrail; the gateway admission receipt; this artifact: evidence/workflows/port-journeys.json + port-journeys-transcript.txt.',
    userVisible: 'The customer intent surface renders WAITING (DRAFT) then IN_PROGRESS (AUTHORIZED) with the evidence trail reachable; the tracking surface renders the same truth per its own view (steps: STATE READ, TRACKING READ).',
    userVisibleVerifiedBy: 'Port-level: recorded snapshots and views (the exact data the server components render). Surface-level rendering over HTTP is evidenced by Leg B (app-e2e) for the server-rendered paths.',
  },
  'WF-2': {
    protocolObject: 'PaymentIntent (A01) presented as the merchant checkout offer (offered → failed through CANCELLED with reason code PAYER_CANCELLED).',
    owningAuthority: 'Intent Authority (A01) — the checkout adapter reads it honestly (the area-20 Merchant Authority is RTN wave 2 and owns no merged object yet; recorded in the checkout mapping records).',
    runtimeBoundary: 'Checkout port reads (server composition) → A01 query API; the terminal cancel crosses the product/protocol boundary through the gateway (intent.cancel).',
    deployedComponent: 'The runtime checkout adapter over the composed runtime; the intent authority; the gateway.',
    persistentState: 'intent.sqlite + the A15 chain (INTENT_STATE_CHANGED with the reason code) + durable.sqlite (the executed job).',
    unknownHandling: 'The offer read never fabricates: no intent → checkout-not-found → the availability-unknown presentation (see WF-3 for the mapped UNKNOWN read); the list presents only real DRAFT intents.',
    reconciliation: 'Re-check re-reads the A01 record; the cancelled intent leaves the open-offer list on the next read (asserted).',
    evidence: 'A15 INTENT_* records; the checkout status record evidence link to the intent A15 chain; the JSON artifact steps (CHECKOUT LIST/OFFER/STATUS, TERMINAL CANCEL, TRACKING READ).',
    userVisible: 'The merchant checkout list renders the open offer (ACTION_REQUIRED, cko-map-01); after the cancel, the state page renders failed with the authority reason and next actions (cko-map-07); the tracking surface renders the terminal failure with the reason code (TRK-FAILED).',
    userVisibleVerifiedBy: 'Port-level recorded records (the exact data the merchant surfaces render).',
  },
  'WF-3': {
    protocolObject: 'The checkout presentation of a post-DRAFT intent (cko-map-08: the area-20 checkout-session object does not exist in the composed runtime — UNKNOWN, with reconciliation).',
    owningAuthority: 'The (wave-2) Checkout/Intent Authority surface; today the A01 Intent Authority is the live owner named in every reportedBy.',
    runtimeBoundary: 'Checkout port read + the decision submit crossing to the (absent) merchant-decision command surface — refused fail-closed at the adapter boundary.',
    deployedComponent: 'The runtime checkout adapter over the composed runtime.',
    persistentState: 'Nothing is written by the refused decision (asserted: nothing committed); reads leave no state.',
    unknownHandling: 'THE checkout UNKNOWN path: post-DRAFT intents present state "unknown" with who-resolves + re-check trigger (asserted); unknown references map to the availability-unknown presentation (asserted).',
    reconciliation: 'The recorded reconciliation path: re-check re-reads the Intent Authority and reports whatever returns, including another unknown.',
    evidence: 'The status record reconciliation fields; the refusal detail; the JSON artifact steps (CHECKOUT STATUS over AUTHORIZED, DECISION SUBMIT, UNKNOWN-REFERENCE STATUS).',
    userVisible: 'The merchant decision page renders UNKNOWN (never success/failure) for the post-DRAFT offer, and the accept control submission surfaces the explicit refusal wording — nothing is committed.',
    userVisibleVerifiedBy: 'Port-level recorded records + the display resolution through the product own resolveCheckoutDisplay/resolveCheckoutAdapterErrorPresentation (recorded in the steps).',
  },
  'WF-4': {
    protocolObject: 'The A08 queued fulfillment item (QUEUED → CANCELLED) behind the intent; the queues.eligibility.evaluate and queues.item.cancel commands.',
    owningAuthority: 'Fulfillment/Queue Authority (A08), with A06 Liquidity / A07 Credit conditions behind the release policy.',
    runtimeBoundary: 'Waiting port lookup (read) and the re-check/recovery requests (commands) crossing to the gateway; the item terms are the A08 record own.',
    deployedComponent: 'The runtime waiting adapter over the composed runtime.',
    persistentState: 'queues.sqlite (the queue + item records), the A15 ITEM_* records, durable.sqlite (the executed commands).',
    unknownHandling: 'The not-found lookup vocabulary is documented as UNKNOWN-honest (WQ records); retry/escalate recovery are denied with the protocol-structural reasons (never offered, never fabricated).',
    reconciliation: 'The re-check submits queues.eligibility.evaluate and the snapshot re-read reports the authority answer (asserted: still QUEUED — an honest no-progression); the cancel recovery submits queues.item.cancel and the terminal re-read reports CANCELLED with the recorded reason (asserted).',
    evidence: 'A15 ITEM_QUEUED / ITEM_CANCELLED records; the snapshot evidence links to /track/<intentId>; the JSON artifact steps.',
    userVisible: 'The waiting surface renders WAITING with what/why/next and explicit recovery authorizations; after the cancel it renders the terminal failed resolution with the reason code; the retry control renders the protocol denial.',
    userVisibleVerifiedBy: 'Port-level recorded snapshots (the exact data the waiting surface renders).',
  },
  'WF-5': {
    protocolObject: 'The A10 obligation (CREATED → DISPUTED) and its dispute record (the obligations.dispute.open primitive); the A15 DISPUTE_OPEN transition; the clearing batch that created the obligation.',
    owningAuthority: 'Obligation Authority (A10) owns the obligation state and the dispute primitive; Clearing Authority (A09) created the obligation; the Evidence Authority (A15) owns the chain.',
    runtimeBoundary: 'Clearing commands through the gateway; mediation port reads (docket, matrix, dispute) and the dispute-initiation command through the gateway.',
    deployedComponent: 'The runtime mediation adapter over the composed runtime.',
    persistentState: 'obligations.sqlite, clearing.sqlite, the A15 chain, durable.sqlite.',
    unknownHandling: 'Area-19 surfaces (proposals, mediation cases) present unavailable with the recorded gap — never fabricated (asserted); the re-dispute is denied with the frozen one-way table reason (asserted).',
    reconciliation: 'The dispute is readable by its id; the docket re-read lists it; resolution arrives only as the authority recorded dispute resolution (never from the surface).',
    evidence: 'The A15 DISPUTE_OPEN record (asserted present); the dispute record recourse trail citing the A15 chain (asserted); the JSON artifact steps.',
    userVisible: 'The mediation hub renders the disputable obligation and then the open dispute with its recourse trail; the initiation matrix renders per-role authorization (customer/merchant authorized; provider/operator/administrator not — asserted).',
    userVisibleVerifiedBy: 'Port-level recorded records (the exact data the mediation surfaces render).',
  },
  'WF-6': {
    protocolObject: 'The oversight aggregate reads the runtime cannot answer (cross-provider/cross-queue sums) — authoritative UNKNOWN values; the provider position reads A06 CAN answer.',
    owningAuthority: 'Liquidity Authority (A06), Credit Authority (A07), Queue Authority (A08) — the aggregates are theirs and are indeterminate on their current read surfaces.',
    runtimeBoundary: 'Liquidity port reads (server composition) → the A06/A07/A08 query APIs.',
    deployedComponent: 'The runtime liquidity adapter over the composed runtime.',
    persistentState: 'The A06 pool/funding records (liquidity.sqlite is not among the per-domain stores — A06 positions live in the reservations-area stores; the A15 POOL_OPENED / FUNDING_CONFIRMED records are the durable proof — asserted present).',
    unknownHandling: 'THE authoritative-UNKNOWN: the three oversight aggregates present authority-unknown with who-resolves and recheck-trigger (asserted) — never a UI-side sum, never zero standing in for an answer.',
    reconciliation: 'Each unknown aggregate records its resolution: a governed read-surface extension by the owning authority (per-position reads remain available on the provider surface — evidenced by the provider read in the same workflow).',
    evidence: 'The aggregate values with their explanations and reconciliation paths; the provider position with the real quoted figure (1000.00 USD) as the contrast; the JSON artifact steps.',
    userVisible: 'The oversight surface renders UNKNOWN for the aggregates with the plain-language explanations and reconciliation; the provider liquidity surface renders the authority-quoted figures.',
    userVisibleVerifiedBy: 'Port-level recorded values (the exact data the oversight/liquidity surfaces render) + Leg B renders the oversight surface over HTTP.',
  },
};

const lines = [];
lines.push('# UI-010 Leg A — port-level end-to-end workflow journey records');
lines.push('');
lines.push(`Base: ${summary.base}`);
lines.push(`Harness: \`${summary.harness}\``);
lines.push(`Composition: ${summary.composition}`);
lines.push(`Runtime directory: ${summary.runtimeDir}`);
lines.push(`A15 evidence chain: **${summary.evidenceChain.verdict}** (verified height ${summary.evidenceChain.verifiedHeight}, final hash ${String(summary.evidenceChain.finalHash).slice(0, 32)}…)`);
lines.push(`Assertions: **${summary.totalAssertions} total, ${summary.failedAssertions} failed.**`);
lines.push('');
lines.push('Machine record: `port-journeys.json`; console transcript: `port-journeys-transcript.txt` (the command that produced both: `node --import ./alias-loader.mjs product-port-journeys.mjs`, run from `spec/product/closure/tools/`).');
lines.push('');
lines.push('---');
lines.push('');

for (const j of journeys) {
  lines.push(`## Journey ${j.workflow} — ${j.title}`);
  lines.push('');
  lines.push(`Work item ID: UI-010 (evidence bundle; the workflow exercises the surfaces of UI-002..UI-008 over the UI-011 composed runtime)`);
  lines.push(`Surfaces crossed: ${j.surfacesCrossed.join(' → ')}`);
  lines.push(`Explicit states exercised: ${j.statesExercised.join('; ')}`);
  lines.push(`Environment: ${j.environment}`);
  lines.push('');
  lines.push('### Steps');
  lines.push('');
  for (const s of j.steps) {
    lines.push(`1. **${s.label}**${s.outcome ? ` — ${s.outcome}` : ''}`);
    if (s.stateBefore) lines.push(`   - state before: ${s.stateBefore}`);
    if (s.stateAfter) lines.push(`   - state after: ${s.stateAfter}`);
    if (s.action) lines.push(`   - action: ${s.action}`);
  }
  lines.push('');
  lines.push('### Assertions');
  lines.push('');
  for (const a of j.assertions) {
    lines.push(`- ${a.pass ? 'PASS' : '**FAIL**'} — ${a.label}${a.evidence ? ` (${a.evidence})` : ''}`);
  }
  lines.push('');
  const nine = NINE[j.workflow];
  if (nine) {
    lines.push('### Nine reconciliation questions');
    lines.push('');
    const questions = [
      'Protocol object', 'Owning authority', 'Runtime boundary', 'Deployed component',
      'Persistent state', 'UNKNOWN handling', 'Reconciliation', 'Evidence', 'User-visible state',
    ];
    for (const [index, question] of questions.entries()) {
      lines.push(`${index + 1}. **${question}:** ${nine[question.replace(/[^A-Za-z]/g, '')] ?? nine[Object.keys(nine)[index]]}`);
    }
    if (nine.userVisibleVerifiedBy) {
      lines.push(`   - verified by: ${nine.userVisibleVerifiedBy}`);
    }
  }
  if (j.authoritativeUnknown) {
    lines.push('');
    lines.push(`**Authoritative-UNKNOWN rendered:** ${JSON.stringify(j.authoritativeUnknown.aggregates ?? j.authoritativeUnknown.subject ?? j.authoritativeUnknown)} — ${j.authoritativeUnknown.renderedAs}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
}

writeFileSync(join(EVIDENCE, 'port-journeys.md'), lines.join('\n'));
console.log(`wrote ${join(EVIDENCE, 'port-journeys.md')} (${lines.length} lines)`);
