/**
 * ════════════════════════════════════════════════════════════════════════
 *  UI-010 — LEG A: THE PORT-LEVEL END-TO-END WORKFLOW JOURNEYS
 * ════════════════════════════════════════════════════════════════════════
 *
 * The end-to-end workflow evidence over the composed product's RUNTIME-
 * BACKED PORTS: this harness composes the real protocol runtime exactly as
 * the product's single server-side composition root does
 * (src/lib/protocol/server-runtime.ts — see journey-lib.mjs for the two
 * recorded deviations: a parameterized runtime directory and the
 * tick-based drain the composed-journey harness itself uses), registers
 * THE SEVEN RUNTIME ADAPTERS into the product port modules, and then
 * drives the PRODUCT PORTS — the exact call surface the product's
 * server-rendered views and API routes consume — through complete
 * workflows that cross surface boundaries:
 *
 *   WF-1  customer intent lifecycle: consequence quote → explicit submit →
 *         compliance-gated authorize → tracking + A15 evidence proof trail
 *   WF-2  merchant checkout over a real DRAFT intent → offer → terminal
 *         cancel → failed status (+ tracking view of the failure)
 *   WF-3  checkout UNKNOWN over the post-DRAFT intent + the fail-closed
 *         accept-decision refusal (+ unknown-reference error mapping)
 *   WF-4  waiting/recovery: queue item → WAITING snapshot → re-check
 *         command → cancel recovery → terminal resolution (+ retry denial)
 *   WF-5  mediation/dispute: obligations via clearing → docket → initiation
 *         matrix → dispute open through the gateway → dispute record +
 *         recourse trail (+ re-dispute denial + area-19 unavailable gaps)
 *   WF-6  authoritative-UNKNOWN: operator oversight aggregates +
 *         provider positions + the oversight role gate
 *
 * Every step records the state before/after, the assertions, and the
 * outcomes; every consequential state is resolved through the product's
 * own display-state mapping where one exists (intent-state-mapping,
 * checkout-state-mapping). Artifacts: evidence/workflows/*.json (machine
 * journey records) + port-journeys.md (the dogfooding-protocol journey
 * record format: steps, assertions, and the nine reconciliation questions
 * per workflow).
 *
 * Usage:
 *   node --import ./alias-loader.mjs product-port-journeys.mjs
 * (run from spec/product/closure/tools/; artifacts land in
 *  spec/product/closure/evidence/workflows/)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

import { composeRuntime, approveGateSubject, sleep, verifyEvidenceChain } from './journey-lib.mjs';

const TOOLS_DIR = import.meta.dirname;
const REPO = join(TOOLS_DIR, '..', '..', '..', '..');
const EVIDENCE_DIR = join(TOOLS_DIR, '..', 'evidence', 'workflows');
const RUNTIME_DIR = join(REPO, 'var', 'ui010-journeys');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const U = (relative) => pathToFileURL(join(REPO, 'src', 'lib', relative)).href;
const { intentDisplayState, mappingRecordRef } = await import(U('protocol/intent-state-mapping.ts'));
const {
  resolveCheckoutDisplay,
  resolveCheckoutAdapterErrorPresentation,
} = await import(U('protocol/checkout-state-mapping.ts'));
const { clearingBatchId } = await import(U('protocol-runtime/clearing/summation.ts'));

// ── Journey-record plumbing ──────────────────────────────────────────────

const journeys = [];
function beginWorkflow(id, title, surfaces, states) {
  const record = {
    workflow: id,
    title,
    surfacesCrossed: surfaces,
    statesExercised: states,
    environment: [
      'sandbox topology of the real composed system:',
      'plain-Node harness (Node 24.19, native TS type stripping) composing',
      'substrate(DEP-003 node:sqlite) + A15 evidence log + A01/A02/A03/A04/A05/A06/A07/A08/A09/A10/A11/A12/A13/A14/A16 authorities',
      '+ persist hooks + gateway + scheduler + the seven product runtime adapters (the UI-011 splice)',
    ].join(' '),
    steps: [],
    assertions: [],
    artifacts: [],
  };
  journeys.push(record);
  return record;
}

function step(workflow, label, detail) {
  const entry = { label, ...detail };
  workflow.steps.push(entry);
  console.log(`  [${workflow.workflow}] ${label}${entry.outcome ? ` — ${entry.outcome}` : ''}`);
  return entry;
}

function check(workflow, label, condition, evidence) {
  const pass = Boolean(condition);
  workflow.assertions.push({ label, pass, evidence: evidence ?? null });
  if (!pass) {
    console.log(`  [${workflow.workflow}] ✗ ASSERTION FAILED: ${label}`);
    workflow.failed = true;
  }
  return pass;
}

function displayOf(authorityState) {
  try {
    return {
      displayState: intentDisplayState(authorityState),
      mappingRecord: mappingRecordRef(authorityState),
    };
  } catch {
    return { displayState: '(unmapped authority state)', mappingRecord: '(none)' };
  }
}

function checkoutDisplayOf(record) {
  try {
    const display = resolveCheckoutDisplay(record);
    return { displayState: display.kind, mappingRecord: `${display.recordId} (spec/product/checkout-mapping-records.md)` };
  } catch {
    return { displayState: '(resolution failed)', mappingRecord: '(none)' };
  }
}

// ── Compose ──────────────────────────────────────────────────────────────

console.log('Composing the runtime (the server composition root, over var/ui010-journeys/)…');
const composition = await composeRuntime(RUNTIME_DIR);
const { gateway, authorities, ports, money } = composition;
console.log('The seven runtime adapters are registered into the product port modules.\n');

const USD = (minor) => money('USD', minor, 2);

// ════════════════════════════════════════════════════════════════════════
// WF-1 — customer intent lifecycle: intent → capability → tracking
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-1',
    'Customer intent lifecycle: consequence quote → explicit submit → compliance-gated authorize → tracking + evidence proof trail',
    ['customer intent surface (/pay flow: compose→review→submit→state)', 'provider capability surface (/capabilities)', 'tracking surface (/track/[referenceId])'],
    ['WAITING (DRAFT, IMR-9)', 'IN_PROGRESS (AUTHORIZED, IMR-10)', 'UNKNOWN (no-answer query, IMR-8)', 'not-found tracking (TRK-LOOKUP-NOT-FOUND)'],
  );

  // Rails adapter (the corridor's rail must be registered for the capability declaration).
  step(wf, 'rails.adapter.register + activate — VIA THE GATEWAY', {
    action: "gateway.submitCommand('rails.adapter.register' / 'rails.adapter.activate')",
    stateBefore: 'no rail adapters',
  });
  const railsRegister = await composition.submitViaGateway('rails.adapter.register', 'Rail Authority', { railFamily: 'sim-bank', name: 'primary' }, 'ui010-rails-register-1');
  const adapterList = authorities.railAuthority.listAdapters();
  const registeredAdapter = adapterList[adapterList.length - 1];
  const railsActivate = await composition.submitViaGateway('rails.adapter.activate', 'Rail Authority', { adapterId: registeredAdapter?.adapterId }, `ui010-rails-activate-${registeredAdapter?.adapterId}`, [registeredAdapter?.adapterId]);
  step(wf, 'rails adapter ACTIVE', {
    stateAfter: `adapter ${registeredAdapter?.adapterId} = ${authorities.railAuthority.getAdapter(registeredAdapter?.adapterId)?.status}`,
    outcome: `register admitted=${railsRegister.ok}, activate admitted=${railsActivate.ok}`,
  });
  check(wf, 'the rail adapter is ACTIVE for the corridor', authorities.railAuthority.getAdapter(registeredAdapter?.adapterId)?.status === 'ACTIVE');

  // Capability register + compliance gate + activate (A03 direct — the journey-harness pattern).
  step(wf, 'capability register + gate approval + activate (A03 command surface)', {
    action: 'capability.registerCapability → risk.evaluateAndRecordCheck/decideCheck (APPROVED) → capability.activateCapability',
    stateBefore: 'no capabilities in the A03 registry',
  });
  const registered = await authorities.capability.registerCapability({
    capabilityId: 'cap-usd',
    declaration: {
      railId: 'sim-bank',
      corridor: { sourceCurrency: 'USD', sourceGeography: 'US', destinationCurrency: 'USD', destinationGeography: 'US' },
      costSchedule: USD(150),
      tier: 'standard',
    },
    declaredCapacity: USD(500_000),
  });
  const gateDecision = await approveGateSubject(composition, 'cap-usd', 'CAPABILITY_REGISTRATION', composition.protocolTime(2, Date.now()));
  const activated = await authorities.capability.activateCapability('cap-usd');
  step(wf, 'capability ACTIVE', {
    stateAfter: `cap-usd = ${authorities.capability.snapshot().capabilities.find((c) => c.capabilityId === 'cap-usd')?.state}`,
    outcome: `registered.ok=${registered.ok}, gate=${gateDecision.state}, activated.ok=${activated.ok}`,
  });
  check(wf, 'the capability is ACTIVE in the A03 snapshot', authorities.capability.snapshot().capabilities.find((c) => c.capabilityId === 'cap-usd')?.state === 'ACTIVE');

  // PROVIDER CAPABILITY SURFACE READ (cross-surface boundary #1).
  const capabilityListing = await ports.capability.listCapabilities();
  const capItem = capabilityListing.items.find((item) => item.report?.capabilityId === 'cap-usd');
  step(wf, 'PROVIDER CAPABILITY SURFACE read: ports.capability.listCapabilities()', {
    stateAfter: `${capabilityListing.items.length} capability item(s); boundary runtime=${capabilityListing.boundary.runtime}`,
    outcome: capItem ? `${capItem.report.capabilityId} (${capItem.report.state}) — CAP-MAP-001 'available'` : 'the cap-usd item was not found in the listing',
  });
  check(wf, 'the capability surface lists the ACTIVE capability from the A03 registry (CAP-MAP-001 \'available\')', capItem?.report?.state === 'available');

  // Policy author + publish (A02 direct).
  await authorities.policy.authorPolicy('policy-ui010', {
    allowedRails: ['sim-bank'],
    ordering: 'COST_ASC',
    costCeiling: USD(300_00),
    deadlineEpochMs: 999_999_999,
    fallbackPreference: [],
  });
  await authorities.policy.publishPolicyVersion('policy-ui010');

  // The CUSTOMER INTENT flow through the PRODUCT PORT.
  const draft = {
    outcomeKind: 'send-payment',
    outcomeStatement: 'I want to send money to a merchant.',
    amount: '25.00',
    currency: 'USD',
    recipient: { id: 'mrc_copperline', displayName: 'Copperline Coffee' },
    source: { id: 'src_sb_main', displayName: 'Sandbox balance · Main' },
    customerReference: 'ui010-wf1',
  };

  // (quote) — the consequence report the review surface renders.
  const quote = await ports.intent.requestConsequenceReport(draft);
  check(wf, 'the consequence report quotes terms from the A03 snapshot (fee 1.50 USD)', quote.kind === 'report' && quote.report.feeQuoted === '1.50');
  step(wf, 'CONSEQUENCE QUOTE: ports.intent.requestConsequenceReport(draft)', {
    outcome: quote.kind === 'report' ? `report ${quote.report.reportId}: fee=${quote.report.feeQuoted} USD, total=${quote.report.totalQuoted} USD, ${quote.report.terms.length} plain-language terms` : `no-answer: ${quote.note?.slice(0, 120)}`,
    stateAfter: quote.kind === 'report' ? 'a reviewed consequence report exists (the review surface can render it; the submit gate is armed)' : 'no report — the review would stay closed (P2/P3)',
  });

  // (submit) — the single explicit submit through the sole admission point.
  const submitResult = await ports.intent.submitIntent(draft, {
    explicitUserSubmit: true,
    consequenceReportId: quote.kind === 'report' ? quote.report.reportId : '',
    draftFingerprint: quote.kind === 'report' ? quote.report.draftFingerprint : '',
  });
  const intentId = submitResult.kind === 'transported' ? submitResult.intentId : undefined;
  const draftSnapshot = submitResult.kind === 'transported' ? submitResult.snapshot : undefined;
  check(wf, 'the explicit submit is transported (gateway admission + durable execution)', submitResult.kind === 'transported' && intentId !== undefined);
  step(wf, 'EXPLICIT SUBMIT: ports.intent.submitIntent(draft, authorization)', {
    outcome: submitResult.kind === 'transported'
      ? `transported — intent ${intentId}, authority state ${draftSnapshot?.authorityState} → display ${displayOf(draftSnapshot?.authorityState).displayState} (${displayOf(draftSnapshot?.authorityState).mappingRecord})`
      : JSON.stringify(submitResult).slice(0, 160),
    stateBefore: 'no intent record',
    stateAfter: draftSnapshot ? `A01 holds intent ${intentId} in ${draftSnapshot.authorityState}; evidence: ${draftSnapshot.evidence.map((e) => e.label ?? e.kind).join(' | ')}` : 'no intent',
  });
  if (draftSnapshot) {
    check(wf, 'the DRAFT snapshot resolves to the WAITING display state (IMR-9)', displayOf(draftSnapshot.authorityState).displayState === 'WAITING');
  }

  // (authorize) — compliance-gated DRAFT → AUTHORIZED through the gateway.
  const gateIntent = await approveGateSubject(composition, intentId, 'INTENT', composition.protocolTime(3, Date.now()));
  check(wf, 'the intent compliance gate check is APPROVED (the real risk authority)', gateIntent.state === 'APPROVED');
  const attached = await authorities.policy.attachPolicy({ policyId: 'policy-ui010', version: 1, intentId, snapshotId: authorities.capability.snapshot().snapshotId });
  const evaluation = await authorities.policy.evaluatePolicy({
    policyId: 'policy-ui010',
    version: 1,
    intentId,
    intentTerms: {
      amount: USD(2500),
      sourceCurrency: 'USD',
      destinationCurrency: 'USD',
      sourceGeography: 'US',
      destinationGeography: 'US',
      deadlineEpochMs: 999_999_999,
      allowedRails: ['sim-bank'],
      costCeiling: USD(100_00),
    },
    snapshot: authorities.capability.snapshot(),
  });
  const authorize = await composition.submitViaGateway('intent.authorize', 'Intent Authority', { intentId, policyDecisionId: evaluation.ok ? evaluation.record.evaluationId : '' }, `ui010-authorize-${intentId}`, [intentId]);
  const authorizedIntent = authorities.intent.getIntent(intentId);
  check(wf, 'intent.authorize admitted + executed: the intent is AUTHORIZED', authorize.ok && authorizedIntent?.state === 'AUTHORIZED');
  step(wf, 'AUTHORIZE: gateway intent.authorize (compliance-gated)', {
    outcome: `admitted=${authorize.ok}; A01 state=${authorizedIntent?.state}`,
    stateBefore: 'DRAFT',
    stateAfter: 'AUTHORIZED',
  });

  // (state read) — the state surface's own query.
  const stateResult = await ports.intent.getIntentState(intentId);
  check(wf, 'the intent state query returns the AUTHORIZED snapshot (IN_PROGRESS, IMR-10)', stateResult.kind === 'snapshot' && stateResult.snapshot.authorityState === 'AUTHORIZED');
  step(wf, 'STATE READ: ports.intent.getIntentState(intentId)', {
    outcome: stateResult.kind === 'snapshot'
      ? `${stateResult.snapshot.authorityState} → display ${displayOf(stateResult.snapshot.authorityState).displayState} (${displayOf(stateResult.snapshot.authorityState).mappingRecord})`
      : 'no-answer',
  });

  // (tracking read) — the tracking surface's own lookup (cross-surface boundary #2).
  const trackingResult = await ports.tracking.lookupReference(intentId, 'customer');
  check(wf, 'the tracking lookup resolves the intent by its protocol object id', trackingResult.kind === 'tracked');
  if (trackingResult.kind === 'tracked') {
    step(wf, 'TRACKING READ: ports.tracking.lookupReference(intentId, "customer")', {
      outcome: `tracked: state=${trackingResult.view.currentState.state}; history=${trackingResult.view.history.length} entries; evidenceTrail=${trackingResult.view.evidenceTrail.length} records`,
      stateAfter: `current: ${trackingResult.view.currentState.whatIsHappening ?? ''} · evidence: ${trackingResult.view.evidenceTrail.map((e) => `${e.kind === 'recorded' ? `${e.label}(${e.outcomeWording})` : 'no-answer'}`).join(' | ')}`,
    });
    check(wf, 'the tracked state is in-progress (TRK-IN-PROGRESS)', trackingResult.view.currentState.state === 'in-progress');
    check(wf, 'the evidence trail carries A15 record ids, sequences, and hashes', trackingResult.view.evidenceTrail.every((e) => e.kind === 'recorded' && e.recordId.startsWith('pid.') && /sequence \d+/.test(e.outcomeWording) && /hash [0-9a-f]+/.test(e.outcomeWording)));
  }

  // (UNKNOWN read) — a reference the runtime never recorded.
  const unknownState = await ports.intent.getIntentState('pid.v1.intentions-that-were-never-submitted');
  check(wf, 'an unknown reference queries as no-answer → UNKNOWN (never failure)', unknownState.kind === 'no-answer' && /UNKNOWN/i.test(unknownState.note ?? ''));
  step(wf, 'UNKNOWN READ: ports.intent.getIntentState(<never-submitted>)', {
    outcome: `no-answer (reason ${unknownState.reason ?? 'unreachable'}) — the note words it UNKNOWN with the reconciliation path`,
    stateAfter: 'the intent state surface renders UNKNOWN (IMR-8), never 404/failed',
  });

  const unknownTrack = await ports.tracking.lookupReference('NOT-A-REFERENCE', 'customer');
  check(wf, 'the tracking lookup of an unknown reference is not-found with UNKNOWN-honest wording', unknownTrack.kind === 'not-found' && /runtime/.test(unknownTrack.wording));
  step(wf, 'UNKNOWN TRACKING: ports.tracking.lookupReference("NOT-A-REFERENCE")', {
    outcome: 'not-found — "the runtime\'s real answer for this reference … never as a fabricated state" (TRK-LOOKUP-NOT-FOUND)',
  });
}

// ════════════════════════════════════════════════════════════════════════
// WF-2 — merchant checkout over a real DRAFT intent → offer → cancel → failed
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-2',
    'Merchant checkout over a real DRAFT intent → offer read → terminal cancel → failed status → tracking view of the failure',
    ['merchant checkout surface (/checkout, /checkout/[checkoutId])', 'customer intent surface (the port submit that creates the offer)', 'tracking surface (/track/[referenceId])'],
    ['ACTION_REQUIRED (offered, cko-map-01)', 'FAILED (CANCELLED with reason code, cko-map-07 / TRK-FAILED)'],
  );

  const draft = {
    outcomeKind: 'send-payment',
    outcomeStatement: 'I want to send money to a merchant.',
    amount: '12.50',
    currency: 'USD',
    recipient: { id: 'mrc_harborbooks', displayName: 'Harbor Bookstore' },
    source: { id: 'src_sb_reserve', displayName: 'Sandbox balance · Reserve' },
    customerReference: 'ui010-wf2',
  };
  const quote = await ports.intent.requestConsequenceReport(draft);
  const submit = await ports.intent.submitIntent(draft, {
    explicitUserSubmit: true,
    consequenceReportId: quote.kind === 'report' ? quote.report.reportId : '',
    draftFingerprint: quote.kind === 'report' ? quote.report.draftFingerprint : '',
  });
  const intent2 = submit.kind === 'transported' ? submit.intentId : undefined;
  check(wf, 'a second intent is submitted and held in DRAFT', intent2 !== undefined && authorities.intent.getIntent(intent2)?.state === 'DRAFT');
  step(wf, 'submit intent-2 (the offer behind the checkout)', { outcome: `intent ${intent2} DRAFT` });

  // CHECKOUT LIST — the merchant surface's queue read.
  const list = await ports.checkout.listOpenCheckouts();
  const offered = list.items.find((item) => item.checkoutId === intent2);
  check(wf, 'the checkout list presents the DRAFT intent as an open offer', list.ok && offered !== undefined);
  step(wf, 'CHECKOUT LIST: ports.checkout.listOpenCheckouts()', {
    outcome: `${list.items.length} open offer(s); ${offered?.checkoutId} — ACTION_REQUIRED (cko-map-01)`,
    stateAfter: `receiveAmount ${offered?.receiveAmount.amountMinorUnits / 100} USD, validUntil ${offered?.validUntil}`,
  });

  // CHECKOUT OFFER — the decision page's offer read.
  const offer = await ports.checkout.getOffer({ checkoutId: intent2 });
  check(wf, 'the offer read quotes the intent\'s own recorded terms (no fee invented)', offer.ok && offer.offer.quotedAmounts.length === 1 && offer.offer.quotedAmounts[0].key === 'customer-pays');
  step(wf, 'CHECKOUT OFFER: ports.checkout.getOffer({checkoutId})', {
    outcome: offer.ok ? `"${offer.offer.title}"; ${offer.offer.conditions.length} material conditions; plainLanguageSummary carries the no-settlement-finality wording` : `error ${offer.error}`,
    stateAfter: offer.ok ? 'the merchant decision page renders the offer (ACTION_REQUIRED)' : 'error presentation',
  });
  if (offer.ok) {
    check(wf, 'the offer wording never states settlement or finality (N2)', !/settled|final(ity)?\b/i.test(offer.offer.plainLanguageSummary) || /No settlement or finality is stated/i.test(offer.offer.plainLanguageSummary));
  }

  // STATUS — offered state record.
  const statusBefore = await ports.checkout.getStatus({ checkoutId: intent2 });
  if (statusBefore.ok) {
    const display = checkoutDisplayOf(statusBefore.record);
    step(wf, 'CHECKOUT STATUS (pre-cancel): ports.checkout.getStatus()', {
      outcome: `state=${statusBefore.record.state} → display ${display.displayState}`,
    });
    check(wf, 'the offered checkout resolves to ACTION_REQUIRED (cko-map-01)', statusBefore.record.state === 'offered');
  }

  // AUTHORIZE (the frozen table: CANCELLED is reachable only from
  // AUTHORIZED/ROUTED/FULFILLING — never from DRAFT). A published policy
  // version is attachable exactly once (core.md lines 99-100), so intent-2
  // gets its own authored + published policy.
  await authorities.policy.authorPolicy('policy-ui010-wf2', {
    allowedRails: ['sim-bank'],
    ordering: 'COST_ASC',
    costCeiling: USD(300_00),
    deadlineEpochMs: 999_999_999,
    fallbackPreference: [],
  });
  await authorities.policy.publishPolicyVersion('policy-ui010-wf2');
  await approveGateSubject(composition, intent2, 'INTENT', composition.protocolTime(4, Date.now()));
  await authorities.policy.attachPolicy({ policyId: 'policy-ui010-wf2', version: 1, intentId: intent2, snapshotId: authorities.capability.snapshot().snapshotId });
  const evaluation2 = await authorities.policy.evaluatePolicy({
    policyId: 'policy-ui010-wf2',
    version: 1,
    intentId: intent2,
    intentTerms: {
      amount: USD(1250),
      sourceCurrency: 'USD',
      destinationCurrency: 'USD',
      sourceGeography: 'US',
      destinationGeography: 'US',
      deadlineEpochMs: 999_999_999,
      allowedRails: ['sim-bank'],
      costCeiling: USD(100_00),
    },
    snapshot: authorities.capability.snapshot(),
  });
  const authorize2 = await composition.submitViaGateway('intent.authorize', 'Intent Authority', { intentId: intent2, policyDecisionId: evaluation2.ok ? evaluation2.record.evaluationId : '' }, `ui010-authorize-${intent2}`, [intent2]);
  check(wf, 'intent-2 is AUTHORIZED (the precondition for the terminal cancel)', authorize2.ok && authorities.intent.getIntent(intent2)?.state === 'AUTHORIZED');
  step(wf, 'AUTHORIZE intent-2', { outcome: `admitted=${authorize2.ok}; A01 state=${authorities.intent.getIntent(intent2)?.state}` });

  // TERMINAL CANCEL — through the gateway.
  const cancel = await composition.submitViaGateway('intent.cancel', 'Intent Authority', { intentId: intent2, reasonCode: 'PAYER_CANCELLED' }, `ui010-cancel-${intent2}`, [intent2]);
  check(wf, 'intent.cancel admitted + executed: the intent is CANCELLED', cancel.ok && authorities.intent.getIntent(intent2)?.state === 'CANCELLED');
  step(wf, 'TERMINAL CANCEL: gateway intent.cancel (reason PAYER_CANCELLED — the A01 reason-code vocabulary)', {
    stateBefore: 'AUTHORIZED (the offer rendered as UNKNOWN post-DRAFT)',
    stateAfter: 'CANCELLED (terminal)',
  });

  // STATUS AFTER — the failed presentation.
  const statusAfter = await ports.checkout.getStatus({ checkoutId: intent2 });
  if (statusAfter.ok) {
    const display = checkoutDisplayOf(statusAfter.record);
    step(wf, 'CHECKOUT STATUS (post-cancel): ports.checkout.getStatus()', {
      outcome: `state=${statusAfter.record.state} → display ${display.displayState}; reason: ${(statusAfter.record.reason ?? '').slice(0, 90)}`,
      stateAfter: `nextActions: ${(statusAfter.record.nextActions ?? []).join(' / ')}`,
    });
    check(wf, 'the cancelled checkout presents the failed record with reason and next actions (cko-map-07)', statusAfter.record.state === 'failed' && statusAfter.record.reason !== undefined);
  }

  // TRACKING view of the failure (cross-surface boundary).
  const tracking = await ports.tracking.lookupReference(intent2, 'merchant');
  if (tracking.kind === 'tracked') {
    step(wf, 'TRACKING READ of the cancelled intent', {
      outcome: `state=${tracking.view.currentState.state}; outcome: ${tracking.view.currentState.outcome?.slice(0, 140)}`,
    });
    check(wf, 'the tracked view presents the terminal failure with the recorded reason code (TRK-FAILED)', tracking.view.currentState.state === 'failed' && tracking.view.currentState.reason === 'PAYER_CANCELLED');
  }

  // The list no longer carries the cancelled offer.
  const listAfter = await ports.checkout.listOpenCheckouts();
  check(wf, 'the cancelled intent no longer appears as an open offer', !listAfter.items.some((item) => item.checkoutId === intent2));
}

// ════════════════════════════════════════════════════════════════════════
// WF-3 — checkout UNKNOWN + the fail-closed decision refusal
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-3',
    'Checkout UNKNOWN over the post-DRAFT intent + the fail-closed accept-decision refusal + the unknown-reference error mapping',
    ['merchant checkout surface (/checkout/[checkoutId])'],
    ['UNKNOWN (checkout session gap with reconciliation, cko-map-08)', 'honest refusal (decision-not-allowed)', 'checkout-not-found → UNKNOWN presentation'],
  );

  const wf1Intent = journeys[0].steps.find((s) => s.label.startsWith('EXPLICIT SUBMIT'))?.outcome?.match(/intent (pid[^,]+)/)?.[1];
  check(wf, 'WF-1\'s authorized intent is available for the post-DRAFT checkout read', wf1Intent !== undefined);
  if (wf1Intent) {
    const status = await ports.checkout.getStatus({ checkoutId: wf1Intent });
    if (status.ok) {
      const display = checkoutDisplayOf(status.record);
      step(wf, 'CHECKOUT STATUS over the AUTHORIZED intent: ports.checkout.getStatus()', {
        outcome: `state=${status.record.state} → display ${display.displayState}`,
        stateAfter: `reconciliation.whoResolves: ${(status.record.reconciliation?.whoResolves ?? '').slice(0, 110)}`,
      });
      check(wf, 'the post-DRAFT checkout state is UNKNOWN — never success or failure (cko-map-08)', status.record.state === 'unknown');
      check(wf, 'the UNKNOWN checkout carries its reconciliation path (who resolves + re-check trigger)', status.record.reconciliation?.whoResolves !== undefined && status.record.reconciliation?.recheckTrigger !== undefined);
    }

    // THE FAIR-CLOSED DECISION REFUSAL.
    const decision = await ports.checkout.submitDecision({ checkoutId: wf1Intent, decision: 'accept' });
    check(wf, 'the accept decision is REFUSED (decision-not-allowed) — nothing committed', !decision.ok && decision.error === 'decision-not-allowed');
    step(wf, 'DECISION SUBMIT: ports.checkout.submitDecision({decision: "accept"})', {
      outcome: `refused — ${decision.error}: ${(decision.detail ?? '').slice(0, 150)}…`,
      stateBefore: 'the merchant presses Accept on the offer',
      stateAfter: 'no decision recorded, nothing committed (fail closed; the area-20 wave-2 gap)',
    });

    // UNKNOWN-REFERENCE error mapping (the product's own presentation resolution).
    const unknownStatus = await ports.checkout.getStatus({ checkoutId: 'pid.v1.no-such-checkout' });
    if (!unknownStatus.ok) {
      const presentation = resolveCheckoutAdapterErrorPresentation(unknownStatus.error, unknownStatus.detail, unknownStatus.reportedBy);
      step(wf, 'UNKNOWN-REFERENCE STATUS: ports.checkout.getStatus(<unknown id>)', {
        outcome: `error=${unknownStatus.error} → presentation ${JSON.stringify(presentation).slice(0, 160)}`,
        stateAfter: 'the surface renders the availability-unknown presentation (UNKNOWN), never a fabricated state',
      });
      check(wf, 'the unknown-reference checkout maps to an UNKNOWN-class presentation', /unknown/i.test(JSON.stringify(presentation)) && /availability condition/i.test(presentation.detail));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// WF-4 — waiting/recovery: queue item → WAITING → re-check → cancel → terminal
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-4',
    'Waiting/recovery: queue item → WAITING snapshot → re-check command → cancel recovery → terminal resolution (+ the retry denial)',
    ['tracking surface (/track/[referenceId])', 'waiting/recovery surface (/track/[referenceId]/waiting)'],
    ['WAITING (fq.queued.liquidity-credit, WQ-01)', 're-check accepted (fq.inquiry.recheck-requested, WQ-15)', 'recovery denial (fq.recovery.denied, WQ-14)', 'FAILED terminal (fq.resolved.failed with reason, WQ-09)'],
  );

  const wf1Intent = journeys[0].steps.find((s) => s.label.startsWith('EXPLICIT SUBMIT'))?.outcome?.match(/intent (pid[^,]+)/)?.[1];
  check(wf, 'WF-1\'s intent is available for the queued fulfillment', wf1Intent !== undefined);

  if (wf1Intent) {
    // Queue creation + item enqueue (A08 command surface — the LCQ-harness pattern).
    const queue = await authorities.queues.createQueue({
      queueId: 'queue-ui010',
      policy: {
        orderingRule: 'PRIORITY_CLASS_THEN_SEQUENCE_NUMBER',
        maxWaitEpochMs: 60_000,
        releaseConditions: { minLiquidityAvailable: USD(100_00) },
      },
    });
    const item = await authorities.queues.enqueueItem({
      queueId: 'queue-ui010',
      intentId: wf1Intent,
      priorityClass: 0,
      terms: { intentId: wf1Intent, terms: USD(2500) },
    });
    check(wf, 'the queue item is enqueued (A08, ITEM_QUEUED in the A15 chain)', queue.ok && item.ok);
    step(wf, 'QUEUE + ITEM (A08 command surface)', {
      outcome: `queue-ui010 (${queue.record?.state ?? 'created'}); item ${item.record?.itemId} QUEUED`,
      stateBefore: 'no queue items',
      stateAfter: `item ${item.record?.itemId} for intent ${wf1Intent}`,
    });

    const itemId = item.record?.itemId;

    // WAITING LOOKUP — the waiting surface's own read.
    const waiting = ports.waiting.lookupWaiting(itemId, 'customer');
    check(wf, 'the waiting lookup finds the item and presents a QUEUED snapshot', waiting.status === 'found' && waiting.snapshot.snapshotKind === 'condition');
    if (waiting.status === 'found') {
      step(wf, 'WAITING LOOKUP: ports.waiting.lookupWaiting(itemId, "customer")', {
        outcome: `${waiting.snapshot.authorityStateId} (${waiting.snapshot.conditionKind}) — display WAITING (WQ-01)`,
        stateAfter: `whatIsWaiting: ${waiting.snapshot.whatIsWaiting?.slice(0, 110)} · reason: ${waiting.snapshot.reason?.slice(0, 110)} · expectation: ${waiting.snapshot.expectation?.slice(0, 80)}`,
      });
      check(wf, 'the WAITING snapshot carries what/why/next (P6 mandatory content)', waiting.snapshot.whatIsWaiting !== undefined && waiting.snapshot.reason !== undefined && waiting.snapshot.expectation !== undefined);
      check(wf, 'the recovery actions are explicit: cancel authorized, retry/escalate not-authorized', waiting.snapshot.recovery.some((a) => a.actionId === 'cancel' && a.authorization.status === 'authorized') && waiting.snapshot.recovery.some((a) => a.actionId === 'retry' && a.authorization.status === 'not-authorized'));
    }

    // RE-CHECK — the inquiry command through the gateway.
    const recheck = ports.waiting.requestRecheck({ referenceId: itemId, requestedByRole: 'customer' });
    check(wf, 'the re-check request is accepted and routed to queues.eligibility.evaluate', recheck.status === 'accepted' && /queues\.eligibility\.evaluate/.test(recheck.routedTo ?? ''));
    step(wf, 'RE-CHECK: ports.waiting.requestRecheck({referenceId, requestedByRole})', {
      outcome: `accepted (fq.inquiry.recheck-requested, WQ-15) — routedTo: ${recheck.routedTo}`,
      stateAfter: 'the command is admitted on the durable path; the snapshot re-read reports the authority\'s answer',
    });
    await sleep(400); // the adapter submits fire-and-forget; let the drain settle.
    const afterRecheck = ports.waiting.lookupWaiting(itemId, 'customer');
    step(wf, 'SNAPSHOT RE-READ after the re-check', {
      outcome: afterRecheck.status === 'found' ? `${afterRecheck.snapshot.authorityStateId} — the release conditions still do not hold (an honest no-progression answer, never a fabricated progression)` : 'not-found',
    });
    check(wf, 'the re-read after the re-check is still an honest QUEUED (no fabricated progression)', afterRecheck.status === 'found' && afterRecheck.snapshot.authorityStateId === 'fq.queued.liquidity-credit');

    // RETRY DENIAL — the protocol-structural denial.
    const retry = ports.waiting.requestRecovery({ referenceId: itemId, actionId: 'retry', requestedByRole: 'customer' });
    check(wf, 'the retry recovery is DENIED per protocol (INV-8-4 structural; no retry kind)', retry.status === 'denied' && /no retry command kind/.test(retry.reason ?? ''));
    step(wf, 'RETRY RECOVERY: ports.waiting.requestRecovery({actionId: "retry"})', {
      outcome: `denied (fq.recovery.denied, WQ-14) — ${((retry).reason ?? '').slice(0, 120)}…`,
    });

    // CANCEL RECOVERY — the authorized recovery command.
    const cancel = ports.waiting.requestRecovery({ referenceId: itemId, actionId: 'cancel', requestedByRole: 'customer' });
    check(wf, 'the cancel recovery is accepted and routed to queues.item.cancel', cancel.status === 'accepted' && /queues\.item\.cancel/.test(cancel.routedTo ?? ''));
    step(wf, 'CANCEL RECOVERY: ports.waiting.requestRecovery({actionId: "cancel"})', {
      outcome: 'accepted (fq.recovery.cancel-requested, WQ-12) — routedTo: ' + cancel.routedTo,
      stateBefore: 'item QUEUED',
      stateAfter: 'the cancel command is admitted; the item\'s next read reports the authority\'s state',
    });
    await sleep(400);
    const terminal = ports.waiting.lookupWaiting(itemId, 'customer');
    if (terminal.status === 'found' && terminal.snapshot.snapshotKind === 'resolution') {
      step(wf, 'TERMINAL RE-READ: ports.waiting.lookupWaiting(itemId)', {
        outcome: `${terminal.snapshot.authorityStateId} (outcome ${terminal.snapshot.outcome}) — display FAILED terminal (WQ-09)`,
        stateAfter: `failureReason: ${terminal.snapshot.failureReason} · nextActions: ${(terminal.snapshot.nextActions ?? []).join(' / ')}`,
      });
      check(wf, 'the cancelled item presents the explicit terminal resolution with the recorded reason', terminal.snapshot.authorityStateId === 'fq.resolved.failed' && /INTENT_CANCELLED/.test(terminal.snapshot.failureReason ?? ''));
    } else {
      check(wf, 'the cancelled item presents the explicit terminal resolution', false, JSON.stringify(terminal).slice(0, 200));
    }

    // Reference resolution by intent id (the tracking→waiting boundary).
    const byIntent = ports.waiting.lookupWaiting(wf1Intent, 'customer');
    check(wf, 'the waiting lookup also resolves the item by INTENT id (the tracking→waiting deep link)', byIntent.status === 'found');
  }
}

// ════════════════════════════════════════════════════════════════════════
// WF-5 — mediation/dispute: clearing → docket → matrix → dispute → trail
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-5',
    'Mediation/dispute: obligations via clearing → party docket → initiation matrix → dispute open through the gateway → dispute record + recourse trail (+ re-dispute denial + the area-19 gaps)',
    ['mediation surfaces (/mediation, /mediation/dispute/new, /mediation/dispute/[disputeId])', 'tracking surface (the obligation\'s origin reference)'],
    ['ACTION_REQUIRED (disputable obligation on the docket)', 'dispute open (MD-201 dispute-open with the authority)', 'denied re-dispute (frozen one-way table)', 'unavailable (area-19 proposals, MD-400-class)'],
  );

  const BATCH_LABEL = 'ui010-wf5-batch';
  const batchId = clearingBatchId(BATCH_LABEL);
  await composition.submitViaGateway('clearing.batch.open', 'Clearing Authority', { batchLabel: BATCH_LABEL }, `ui010-clearing-open-${BATCH_LABEL}`);
  const staged = await authorities.clearing.addRecord(batchId, {
    origin: { originActivityId: 'activity-ui010-wf5', originKind: 'INTENT' },
    parties: { debtorParticipantId: 'acct-source', creditorParticipantId: 'mrc_copperline' },
    amount: USD(2500),
    reason: 'ui010 wf5: a fulfilled activity whose obligation becomes disputable',
  });
  check(wf, 'the clearing record stages on the open batch', staged.ok);
  await composition.submitViaGateway('clearing.batch.stage', 'Clearing Authority', { batchId }, `ui010-clearing-stage-${BATCH_LABEL}`, [batchId]);
  const commit = await composition.submitViaGateway('clearing.batch.commit', 'Clearing Authority', { batchId }, `ui010-clearing-commit-${BATCH_LABEL}`, [batchId]);
  await composition.submitViaGateway('clearing.batch.finalize', 'Clearing Authority', { batchId }, `ui010-clearing-finalize-${BATCH_LABEL}`, [batchId]);
  const obligationsAfter = authorities.obligations.obligations();
  const obligation = obligationsAfter.find((o) => o.origin.kind === 'CLEARING' && o.origin.originActivityId === 'activity-ui010-wf5');
  check(wf, 'the clearing commit created the obligation in CREATED (the A10 sink)', commit.ok && obligation?.state === 'CREATED');
  step(wf, 'CLEARING: gateway clearing.batch.open/stage/commit/finalize', {
    outcome: `batch ${batchId} committed; obligation ${obligation?.obligationId} CREATED for origin activity-ui010-wf5`,
    stateBefore: 'no obligations in the A10 ledger',
    stateAfter: 'one OUTSTANDING (CREATED) obligation',
  });

  // PARTY DOCKET — the mediation hub's own read.
  const docket = await ports.mediation.getPartyDocket('customer');
  check(wf, 'the party docket reads the disputable obligation from the A10 ledger', docket.kind === 'fetched' && docket.record.disputableIntents.some((d) => d.reference === 'activity-ui010-wf5'));
  step(wf, 'PARTY DOCKET: ports.mediation.getPartyDocket("customer")', {
    outcome: `fetched — disputes: ${docket.record.disputes.length}; proposals: ${docket.record.proposals.length} (the runtime's authoritative empty set for the area-19 surface); mediations: ${docket.record.mediations.length}; disputableIntents: ${docket.record.disputableIntents.length}`,
    stateAfter: `disputable: ${docket.record.disputableIntents.map((d) => `${d.reference} (${d.label})`).join(' | ')}`,
  });

  // INITIATION BRIEFING — the P2 consequence wording the initiation
  // surface renders before any submit (shared adapter-boundary constant).
  const briefing = await ports.mediation.getDisputeInitiationBriefing();
  check(wf, 'the initiation briefing carries the authority consequence wording before any submit (P2)', /terminalizes the recorded obligation into DISPUTED/.test(briefing.consequences.join(' ')) && /does not settle/.test(briefing.consequences.join(' ')));
  step(wf, 'INITIATION BRIEFING: ports.mediation.getDisputeInitiationBriefing()', {
    outcome: `authority: ${briefing.authority.slice(0, 90)}…; ${briefing.grounds.length} grounds; ${briefing.consequences.length} consequences; whatHappensNext + consequenceOfInaction present`,
  });

  // INITIATION MATRIX — the role authorization matrix the initiation surface renders.
  const matrix = await ports.mediation.describeDisputeInitiationMatrix({ intentReference: 'activity-ui010-wf5' });
  const byRole = Object.fromEntries(matrix.map((row) => [row.role, row.authorized]));
  check(wf, 'the initiation matrix authorizes customer+merchant only (P8-style matrix over the A10 primitive)', byRole.customer === true && byRole.merchant === true && byRole.provider === false && byRole.operator === false && byRole.administrator === false);
  step(wf, 'INITIATION MATRIX: ports.mediation.describeDisputeInitiationMatrix({intentReference})', {
    outcome: `customer=${byRole.customer} merchant=${byRole.merchant} provider=${byRole.provider} operator=${byRole.operator} administrator=${byRole.administrator}`,
  });

  // DISPUTE INITIATION — the real command through the sole admission point.
  const initiation = await ports.mediation.initiateDispute({
    intentReference: 'activity-ui010-wf5',
    grounds: ['other-with-evidence'],
    accountOfWhatHappened: 'The goods were not received.',
    evidence: [],
    actor: 'customer',
  });
  check(wf, 'the dispute is initiated through obligations.dispute.open (gateway admission + execution)', initiation.kind === 'initiated');
  const disputeId = initiation.kind === 'initiated' ? initiation.reference : undefined;
  if (initiation.kind === 'initiated') {
    step(wf, 'DISPUTE INITIATION: ports.mediation.initiateDispute({...actor: "customer"})', {
      outcome: `initiated — dispute ${disputeId}; obligation now ${authorities.obligations.obligation(obligation.obligationId)?.state}; record authorityState=${initiation.record.authorityState}`,
      stateBefore: `obligation ${obligation.obligationId} CREATED (OUTSTANDING)`,
      stateAfter: 'obligation DISPUTED (terminalized; no settlement proceeds while the dispute is open)',
    });
    check(wf, 'the obligation is DISPUTED after the command executes', authorities.obligations.obligation(obligation.obligationId)?.state === 'DISPUTED');
    check(wf, 'the dispute record presents authorityState "open" (not resolved — the command executed)', initiation.record.authorityState === 'open');
    check(wf, 'the A15 chain records the DISPUTE_OPEN transition', composition.evidenceLog.records().some((r) => r.outcome.reasonCode === 'DISPUTE_OPEN'));
  }

  // DISPUTE READ — the dispute detail surface's own read.
  if (disputeId) {
    const disputeRead = await ports.mediation.getDispute({ disputeId, viewer: 'customer' });
    check(wf, 'the dispute read returns the fetched record with its recourse trail', disputeRead.kind === 'fetched');
    if (disputeRead.kind === 'fetched') {
      step(wf, 'DISPUTE READ: ports.mediation.getDispute({disputeId, viewer})', {
        outcome: `fetched — authorityState=${disputeRead.record.authorityState}; recourseTrail: ${disputeRead.record.recourseTrail.map((s) => `${s.stage} (${s.authorityState})`).join(' → ')}`,
        stateAfter: `proof: ${disputeRead.record.recourseTrail.map((s) => s.proof.map((p) => p.label).join(',')).join(' | ')}`,
      });
      check(wf, 'the recourse trail cites the A15 chain as its proof', disputeRead.record.recourseTrail.every((s) => s.proof.some((p) => /A15/.test(p.label))));
    }

    // DOCKET AFTER — the dispute is on the docket.
    const docketAfter = await ports.mediation.getPartyDocket('customer');
    check(wf, 'the party docket now lists the open dispute', docketAfter.kind === 'fetched' && docketAfter.record.disputes.some((d) => d.id === disputeId));

    // RE-DISPUTE DENIAL — the frozen one-way table.
    const reDispute = await ports.mediation.initiateDispute({
      intentReference: 'activity-ui010-wf5',
      grounds: ['other-with-evidence'],
      accountOfWhatHappened: 'Re-dispute attempt.',
      evidence: [],
      actor: 'customer',
    });
    check(wf, 'the re-dispute is DENIED (the frozen one-way table: DISPUTED is not re-enterable)', reDispute.kind === 'denied' && /frozen one-way table/.test(reDispute.reason ?? ''));
    step(wf, 'RE-DISPUTE DENIAL: initiateDispute on the DISPUTED obligation', {
      outcome: `denied — ${((reDispute).reason ?? '').slice(0, 150)}…`,
    });
  }

  // AREA-19 GAPS — the honest unavailable/denied presentations.
  const proposal = await ports.mediation.getProposal({ proposalId: 'P-001', viewer: 'customer' });
  check(wf, 'an agent proposal reads unavailable with the recorded area-19 gap (never fabricated)', proposal.kind === 'unavailable' && /area 19|RTN wave 2/.test(proposal.detail ?? ''));
  step(wf, 'AREA-19 GAP: ports.mediation.getProposal({proposalId: "P-001"})', {
    outcome: `unavailable — ${(proposal.detail ?? '').slice(0, 110)}…`,
  });
  const decision = await ports.mediation.submitProposalDecision({ proposalId: 'P-001', decision: 'accept', actor: 'customer' });
  check(wf, 'a proposal decision is denied (fail closed; nothing committed)', decision.kind === 'denied');
  const decisionMatrix = await ports.mediation.describeProposalDecisionMatrix({ proposalId: 'P-001' });
  check(wf, 'the proposal decision matrix is all-unauthorized (fail closed)', decisionMatrix.every((row) => row.entries.every((e) => e.authorized === false)));
}

// ════════════════════════════════════════════════════════════════════════
// WF-6 — the authoritative-UNKNOWN: operator oversight aggregates
// ════════════════════════════════════════════════════════════════════════
{
  const wf = beginWorkflow(
    'WF-6',
    'Authoritative-UNKNOWN: the operator oversight aggregates (A06/A07/A08 read-surface gap) + provider positions + the oversight role gate',
    ['operator oversight surface (/oversight)', 'provider liquidity surface (/liquidity)'],
    ['UNKNOWN — authoritative (LQ-009/LQ-010 aggregates, authority-unknown with reconciliation)', 'denied (oversight role gate, LQ-011)'],
  );

  // A real pool + funding so the provider positions read has real authority figures.
  const pool = await authorities.liquidity.openPool({ poolId: 'pool-usd', currency: 'USD', scale: 2 });
  const funding = await authorities.liquidity.recordConfirmedFunding({
    poolId: 'pool-usd',
    source: { kind: 'INTERNAL_TRANSFER', referenceId: 'transfer-ui010' },
    amount: USD(100_000),
  });
  check(wf, 'a real pool with confirmed funding exists in A06', pool.ok && funding.ok);
  step(wf, 'A06 pool + confirmed funding', {
    outcome: `pool-usd funded with 1000.00 USD (POOL_OPENED + FUNDING_CONFIRMED in the A15 chain)`,
  });

  // THE AUTHORITATIVE-UNKNOWN READ — the oversight surface's own port call.
  const oversight = await ports.liquidity.getOperatorOversight({ kind: 'operator-oversight', requester: 'operator' });
  check(wf, 'the operator oversight read is permitted', oversight.kind === 'permitted');
  if (oversight.kind === 'permitted') {
    const unknowns = oversight.view.aggregates.filter((a) => a.value.kind === 'authority-unknown');
    step(wf, 'OVERSIGHT READ: ports.liquidity.getOperatorOversight({requester: "operator"})', {
      outcome: `${oversight.view.aggregates.length} aggregates; ${unknowns.length} are authority-unknown`,
      stateAfter: oversight.view.aggregates.map((a) => `${a.aggregateId} (${a.label}): ${a.value.kind === 'authority-unknown' ? `UNKNOWN — ${a.value.explanation.slice(0, 90)}… resolves: ${a.value.reconciliation.whoResolves}` : `quoted ${a.value.amount ?? a.value.count}`}`).join('\n           '),
    });
    check(wf, 'the cross-provider aggregates present authority-UNKNOWN — never a UI-side sum (LQ-009/LQ-010)', unknowns.length === oversight.view.aggregates.length);
    check(wf, 'every authority-unknown aggregate carries who-resolves + recheck-trigger (P5 reconciliation)', unknowns.every((a) => a.value.reconciliation.whoResolves !== undefined && a.value.reconciliation.recheckTrigger !== undefined));
    wf.authoritativeUnknown = {
      aggregates: unknowns.map((a) => ({ aggregateId: a.aggregateId, subject: a.value.subject })),
      renderedAs: 'unknown (authority-unknown values with reconciliation paths) — never success, never failure, never a fabricated sum',
    };
  }

  // PROVIDER POSITIONS — the real figures contrast.
  const positions = await ports.liquidity.getProviderPositions({ kind: 'provider-positions', requester: 'provider' });
  check(wf, 'the provider positions read is permitted with real A06 figures', positions.kind === 'permitted');
  if (positions.kind === 'permitted') {
    step(wf, 'PROVIDER POSITIONS: ports.liquidity.getProviderPositions({requester: "provider"})', {
      outcome: `${positions.view.liquidity.length} liquidity position(s): ${positions.view.liquidity.map((p) => `${p.positionId} available ${p.available.kind === 'authority-quoted' ? `${p.available.amount} ${p.available.currency}` : 'authority-unknown'}`).join(' | ')}; credit lines: ${positions.view.credit.length}; queue snapshots: ${positions.view.queues.length}`,
      stateAfter: 'the provider surface renders the authority-quoted figures (contrasting the oversight aggregates\' authoritative UNKNOWN)',
    });
  }

  // THE OVERSIGHT ROLE GATE.
  const denied = await ports.liquidity.getOperatorOversight({ kind: 'operator-oversight', requester: 'customer' });
  check(wf, 'a non-operator requester is denied the oversight read (the port role gate)', denied.kind === 'denied' && /only the operator/.test(denied.reason ?? ''));
  step(wf, 'OVERSIGHT ROLE GATE: getOperatorOversight({requester: "customer"})', {
    outcome: `denied — ${(denied.reason ?? '').slice(0, 120)}…`,
  });
}

// ── Evidence-chain verification over the full journey log ────────────────

const chain = verifyEvidenceChain(composition.evidenceLog.records());
const chainOk = chain?.verdict === 'VERIFIED';
console.log(`\nA15 evidence chain verification: ${chain?.verdict} (verified height ${chain?.verifiedHeight}, final hash ${String(chain?.finalHash).slice(0, 24)}…)`);

// ── Persist artifacts ────────────────────────────────────────────────────

const summary = {
  bundle: 'UI-010 Leg A — port-level end-to-end workflow journeys',
  base: 'main @ 2e3b8314f3d1532b6032f9e5c93bf0aef9cd2e90',
  harness: 'node --import ./alias-loader.mjs product-port-journeys.mjs (Node 24.19, native TS stripping)',
  composition: 'journey-lib.mjs — the server composition root mirrored (substrate→evidence→authorities→persist→bindings→transition→gateway→scheduler + the seven runtime adapters registered into the product ports); recorded deviations: parameterized runtime dir (var/ui010-journeys/), tick-based drain (probe-drain.mjs evidences why)',
  runtimeDir: 'var/ui010-journeys/ (fresh per run; per-domain SQLite stores + the A15 evidence store)',
  workflows: journeys.map((j) => ({
    workflow: j.workflow,
    title: j.title,
    surfacesCrossed: j.surfacesCrossed,
    statesExercised: j.statesExercised,
    steps: j.steps.length,
    assertionsPassed: j.assertions.filter((a) => a.pass).length,
    assertionsFailed: j.assertions.filter((a) => !a.pass).length,
    ...(j.authoritativeUnknown ? { authoritativeUnknown: j.authoritativeUnknown } : {}),
  })),
  evidenceChainValid: chainOk,
  evidenceChain: { verdict: chain?.verdict, verifiedHeight: chain?.verifiedHeight, finalHash: chain?.finalHash },
  totalAssertions: journeys.reduce((sum, j) => sum + j.assertions.length, 0),
  failedAssertions: journeys.reduce((sum, j) => sum + j.assertions.filter((a) => !a.pass).length, 0),
};

writeFileSync(join(EVIDENCE_DIR, 'port-journeys.json'), JSON.stringify({ summary, journeys }, null, 2));
console.log(`\n${summary.totalAssertions} assertions, ${summary.failedAssertions} failed.`);
console.log('Artifact: spec/product/closure/evidence/workflows/port-journeys.json');

await composition.close();
process.exit(summary.failedAssertions > 0 || !chainOk ? 1 : 0);
