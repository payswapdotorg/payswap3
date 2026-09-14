/**
 * PC-004 — Payment detail view (module console.payments.detail — the design
 * §7 FLAGSHIP surface).
 *
 * Composed EXCLUSIVELY from the PC-003 payment-detail read model
 * (`readConsolePaymentDetail`): the A01 intent snapshot with its A15 evidence
 * records and the A08 waiting/queued sub-read. Presentation grammar (design
 * §7): outcome first, then detail, then evidence/diagnostics. Every
 * consequential field is authority-quoted and attributed; fields the read
 * does not carry (rail/effect, a customer reference the authority did not
 * report) render as honest absences — NEVER invented.
 *
 * Envelope discipline (design §9): an unavailable detail read (no-answer or
 * transport failure) renders the honest UNKNOWN panel with its
 * reconciliation path — never "not found" failure, never a fabricated state.
 * The A08 waiting sub-read keeps its OWN four honest answers distinct
 * (reported / none / role-denied / unknown) — a sub-read failure never
 * degrades the A01 answer above it.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type {
  ConsolePaymentDetailDto,
  ConsoleWaitingReadDto,
} from '@/lib/console/read-models/payments';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import {
  formatConsoleIsoTimestamp,
  formatConsoleQuotedAmount,
} from './view-format';

/** The authority's own state report, rendered verbatim per its kind. */
function PaymentStateReportView({ report }: { report: ConsolePaymentDetailDto['stateReport'] }) {
  switch (report.kind) {
    case 'acknowledged':
      return (
        <div>
          <p className="text-sm text-stone-700">{report.acknowledgementNote}</p>
          <p className="mt-1 text-xs text-stone-500">
            Recorded by the authority at {formatConsoleIsoTimestamp(report.recordedAt)}.
          </p>
        </div>
      );
    case 'rejected':
      return (
        <div>
          <p className="text-sm text-stone-700">
            The authority rejected the submission — reason code{' '}
            <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{report.reason.code}</code>:{' '}
            {report.reason.message}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Recovery hint: {report.recoveryHint ?? 'none offered by the authority'}.
          </p>
        </div>
      );
    case 'unresolved':
      return (
        <div>
          <p className="text-sm text-stone-700">{report.whatIsNotKnown}</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-stone-600 sm:grid-cols-2">
            <div className="flex flex-wrap gap-x-1">
              <dt className="font-medium">Who resolves:</dt>
              <dd>{report.reconciliation.whoResolves}</dd>
            </div>
            <div className="flex flex-wrap gap-x-1">
              <dt className="font-medium">Recheck available:</dt>
              <dd>{report.reconciliation.recheckAvailable ? 'yes' : 'no'}</dd>
            </div>
            <div className="flex flex-wrap gap-x-1 sm:col-span-2">
              <dt className="font-medium">Note:</dt>
              <dd>{report.reconciliation.note}</dd>
            </div>
          </dl>
        </div>
      );
    case 'held-for-recipient':
      return (
        <div>
          <p className="text-sm text-stone-700">{report.whatIsWaiting}</p>
          <p className="mt-1 text-xs text-stone-500">Why: {report.why}</p>
          <p className="mt-1 text-xs text-stone-500">What happens next: {report.whatHappensNext}</p>
          <p className="mt-1 text-xs text-stone-500">
            Cancel authorized: {report.cancelAuthorized ? 'yes' : 'no'} (the authority's own answer).
          </p>
        </div>
      );
    case 'processing':
      return (
        <div>
          <p className="text-sm text-stone-700">{report.activity}</p>
          <p className="mt-1 text-xs text-stone-500">As reported: {report.asReported}</p>
        </div>
      );
    case 'action-requested':
      return (
        <div>
          <p className="text-sm text-stone-700">Requested action: {report.requestedAction}</p>
          <p className="mt-1 text-xs text-stone-500">Rationale: {report.rationale}</p>
        </div>
      );
  }
}

/** The A15 evidence records the port surfaced — the authority's own timeline. */
function PaymentTimelineView({ evidence }: { evidence: readonly ConsolePaymentDetailDto['evidence'][number][] }) {
  if (evidence.length === 0) {
    return (
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        The intent port surfaced no evidence records for this reference — the honest
        content of this read, not a hidden trail. The A15 chain itself remains the
        durable evidence source (attribution below).
      </p>
    );
  }
  return (
    <ol className="mt-3 flex flex-col gap-3">
      {evidence.map((record) => (
        <li
          key={record.id}
          data-console-evidence={record.id}
          className="min-w-0 rounded-lg border border-stone-200 bg-white p-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {record.kind}
            </span>
            <span className="text-xs text-stone-500">{formatConsoleIsoTimestamp(record.at)}</span>
            <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{record.id}</code>
          </div>
          <p className="mt-1 text-sm text-stone-700">{record.summary}</p>
          {record.details.length > 0 && (
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-stone-600 sm:grid-cols-2">
              {record.details.map((detail) => (
                <div key={detail.label} className="flex flex-wrap gap-x-1">
                  <dt className="font-medium">{detail.label}:</dt>
                  <dd className="break-words">{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-xs text-stone-500">Reported by {record.authority}</p>
        </li>
      ))}
    </ol>
  );
}

/** The A08 waiting/queued sub-read — four honest answers, kept distinct. */
function PaymentWaitingView({ waiting }: { readonly waiting: ConsoleWaitingReadDto }) {
  if (waiting.status === 'none') {
    return (
      <p className="mt-2 max-w-3xl text-sm text-stone-700" data-testid="console-payment-waiting-none">
        {waiting.note}
      </p>
    );
  }
  if (waiting.status === 'role-denied') {
    return (
      <div className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
        <p data-testid="console-payment-waiting-role-denied">
          The Fulfillment/Queue Authority does not disclose waiting detail for this
          reference to the <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{waiting.viewerRole}</code>{' '}
          role — its own per-reference authorization answer, not an unavailable read.
          Viewer roles the authority serves:{' '}
          {waiting.allowedViewerRoles.join(', ')}.
        </p>
      </div>
    );
  }
  if (waiting.status === 'unknown') {
    return (
      <div className="mt-2 max-w-3xl rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
        <ConsoleStatusPresentation status="UNKNOWN" subject="the waiting/queued sub-read" />
        <p className="mt-2 text-sm text-stone-700" data-testid="console-payment-waiting-unknown">
          {waiting.note} The A01 intent answer above stands on its own — only this
          sub-read is unavailable.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 max-w-3xl rounded-lg border border-stone-300 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <ConsoleStatusPresentation status={waiting.displayStatus} subject="the waiting/queued record" />
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{waiting.authorityStateId}</code>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-stone-700 sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-1 sm:col-span-2">
          <dt className="font-medium text-stone-600">Summary:</dt>
          <dd>{waiting.summary}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1 sm:col-span-2">
          <dt className="font-medium text-stone-600">Reason:</dt>
          <dd>{waiting.reason}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Reported by:</dt>
          <dd>{waiting.reportedBy}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Reported at:</dt>
          <dd>{formatConsoleIsoTimestamp(waiting.reportedAt)}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Snapshot kind:</dt>
          <dd>{waiting.snapshotKind}</dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-medium text-stone-600">Recovery actions:</dt>
          <dd>
            {waiting.recoveryActions.length > 0
              ? waiting.recoveryActions.join(', ')
              : 'none reported for this viewer (explicit none)'}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-stone-500">
        Recheck inquiry available: {waiting.inquiryAvailable ? 'yes' : 'no'} (the queue
        authority's own answer for this viewer).
      </p>
    </div>
  );
}

/** A detail field that this read does not carry — an honest absence. */
function AbsentFieldNote({ explanation }: { readonly explanation: string }) {
  return <span className="text-xs text-stone-500">{explanation}</span>;
}

export interface ConsolePaymentDetailViewProps {
  /** The payment-detail read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsolePaymentDetailDto>;
  /** The reference requested in the deep link (shown in the unavailable branch too). */
  readonly requestedIntentId: string;
}

/** The flagship payment detail (design §7): outcome first, detail, evidence. */
export function ConsolePaymentDetailView({
  result,
  requestedIntentId,
}: ConsolePaymentDetailViewProps): ReactNode {
  return (
    <ConsoleReadResultView
      result={result}
      subject={`payment ${requestedIntentId}`}
      renderValue={(detail: ConsolePaymentDetailDto, status: ConsoleStatus, authority) => (
        <article data-console-view="payment-detail" className="min-w-0">
          <header>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Payment</p>
            <h1 className="mt-1 break-all text-2xl font-bold tracking-tight sm:text-3xl">
              <code className="break-all">{detail.intentId}</code>
            </h1>
          </header>

          {/* Outcome first (design §7): the authority-reported result state. */}
          <section
            aria-labelledby="console-payment-outcome"
            className="mt-4 rounded-xl border border-stone-300 bg-white p-4 sm:p-6"
          >
            <h2 id="console-payment-outcome" className="text-sm font-semibold text-stone-800">
              Result state from the authority
            </h2>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <ConsoleStatusPresentation status={status} subject={detail.intentId} />
              <span className="text-sm text-stone-600">
                authority state{' '}
                <code className="rounded bg-stone-100 px-1 py-0.5 text-xs" data-testid="console-payment-authority-state">
                  {detail.authorityState}
                </code>
                <span className="text-xs text-stone-500"> · reported {formatConsoleIsoTimestamp(detail.reportedAt)}</span>
              </span>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Display resolution record: {detail.mappingRecord}
            </p>
          </section>

          {/* Detail (design §7): authority-quoted figures and relationships. */}
          <section aria-labelledby="console-payment-facts" className="mt-6">
            <h2 id="console-payment-facts" className="text-lg font-semibold">
              Payment detail
            </h2>
            <dl className="mt-3 grid max-w-3xl grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-stone-300 bg-white p-4 text-sm sm:grid-cols-2">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Amount:</dt>
                <dd className="font-semibold" data-testid="console-payment-detail-amount">
                  {formatConsoleQuotedAmount(detail.amount, detail.currency)}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Recipient:</dt>
                <dd>{detail.recipientName}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Source:</dt>
                <dd>{detail.sourceName}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Created:</dt>
                <dd>{formatConsoleIsoTimestamp(detail.composedAt)}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Reference:</dt>
                <dd>
                  {detail.customerReference !== undefined ? (
                    <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{detail.customerReference}</code>
                  ) : (
                    <AbsentFieldNote explanation="not carried by this read — the authority reported no customer reference" />
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-stone-600">Rail / effect:</dt>
                <dd>
                  <AbsentFieldNote explanation="not carried by the intent read — rail/effect truth belongs to the capability authority and is never inferred here" />
                </dd>
              </div>
            </dl>
            <p className="mt-2 max-w-3xl text-xs text-stone-500">
              Every figure above is quoted by the intent authority and carried verbatim;
              the two honest absences state what this read does not carry rather than
              inventing a value.
            </p>
          </section>

          {/* The authority's own state report, verbatim. */}
          <section aria-labelledby="console-payment-state-report" className="mt-6">
            <h2 id="console-payment-state-report" className="text-lg font-semibold">
              Authority state report
            </h2>
            <div className="mt-3 max-w-3xl rounded-xl border border-stone-300 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {detail.stateReport.kind}
              </p>
              <div className="mt-2">
                <PaymentStateReportView report={detail.stateReport} />
              </div>
            </div>
          </section>

          {/* Evidence/diagnostics (design §7): the A15 timeline, then the A08 sub-read. */}
          <section aria-labelledby="console-payment-timeline" className="mt-6">
            <h2 id="console-payment-timeline" className="text-lg font-semibold">
              Timeline — the evidence records the port surfaced
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-stone-600">
              The A15 evidence chain is the durable timeline; these are the records the
              intent port surfaced for this reference, carried verbatim (vocabulary and
              ordering are the authority's own).
            </p>
            <PaymentTimelineView evidence={detail.evidence} />
          </section>

          <section aria-labelledby="console-payment-waiting" className="mt-6">
            <h2 id="console-payment-waiting" className="text-lg font-semibold">
              Waiting / queued record (Fulfillment/Queue Authority)
            </h2>
            <PaymentWaitingView waiting={detail.waiting} />
          </section>

          <footer className="mt-8 border-t border-stone-200 pt-4">
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </footer>
        </article>
      )}
    />
  );
}
