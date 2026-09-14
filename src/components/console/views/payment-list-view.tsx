/**
 * PC-004 — Payments list view (module console.payments.all).
 *
 * Composed EXCLUSIVELY from the PC-003 payments read model
 * (`readConsolePayments`): the intent authority's own listing, with the
 * frozen per-item display mapping already resolved in the DTO. This view
 * adds presentation only — it recomputes nothing, aggregates nothing (the
 * read-level status convention forbids counting item statuses into a
 * verdict), and invents no payment data.
 *
 * Envelope discipline (design §9): the list read's unavailable branch renders
 * the honest UNKNOWN panel — an empty list is NEVER fabricated to stand in
 * for a no-answer. An empty `records` answer that the authority DID give is
 * rendered as the legitimate VALUE it is.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type { ConsolePaymentListDto } from '@/lib/console/read-models/payments';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import {
  formatConsoleIsoTimestamp,
  formatConsoleQuotedAmount,
} from './view-format';

function paymentHref(intentId: string): string {
  return `/console/payments/${encodeURIComponent(intentId)}`;
}

function PaymentSummaryItemView({ payment }: { payment: ConsolePaymentListDto['payments'][number] }) {
  return (
    <li
      data-console-payment={payment.intentId}
      className="rounded-xl border border-stone-300 bg-white p-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <ConsoleStatusPresentation status={payment.displayStatus} subject={payment.intentId} />
          <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{payment.intentId}</code>
        </div>
        <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Amount:</dt>
            <dd className="font-semibold" data-testid="console-payment-amount">
              {formatConsoleQuotedAmount(payment.amount, payment.currency)}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Recipient:</dt>
            <dd>{payment.recipientName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Authority state:</dt>
            <dd>
              <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{payment.authorityState}</code>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Reported:</dt>
            <dd>{formatConsoleIsoTimestamp(payment.reportedAt)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2 sm:col-span-2">
            <dt className="font-medium text-stone-600">State mapping record:</dt>
            <dd className="text-xs text-stone-500">{payment.mappingRecord}</dd>
          </div>
        </dl>
        <div>
          <Link
            href={paymentHref(payment.intentId)}
            className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            Open payment detail
          </Link>
        </div>
      </div>
    </li>
  );
}

export interface ConsolePaymentListViewProps {
  /** The payments read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsolePaymentListDto>;
}

/** The composed payments list: envelope-first, per-item authority truth. */
export function ConsolePaymentListView({ result }: ConsolePaymentListViewProps): ReactNode {
  return (
    <ConsoleReadResultView
      result={result}
      subject="the payment list"
      renderValue={(value: ConsolePaymentListDto, _status: ConsoleStatus, authority) => (
        <section
          data-console-view="payments-list"
          aria-labelledby="console-payments-heading"
          className="min-w-0"
        >
          <h2 id="console-payments-heading" className="text-lg font-semibold">
            Payment list — as the intent authority reports it
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">
            The list read resolved — the owning authority answered with a collection. Each row below carries its own
            authority state and frozen display resolution; the list read never
            aggregates them into a single verdict.
          </p>
          <p className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
            <span className="font-semibold">Scope (the owning read's own honest note): </span>
            {value.scopeNote}
          </p>
          {value.payments.length === 0 ? (
            <p
              data-testid="console-payments-empty-value"
              className="mt-4 max-w-3xl rounded-xl border border-stone-300 bg-white p-4 text-sm text-stone-700"
            >
              The intent authority answered with an empty collection — a legitimate
              authoritative VALUE (no intent records are in this read's scope), not an
              unavailable read.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {value.payments.map((payment) => (
                <PaymentSummaryItemView key={payment.intentId} payment={payment} />
              ))}
            </ul>
          )}
          <footer className="mt-6 border-t border-stone-200 pt-4">
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </footer>
        </section>
      )}
    />
  );
}
