/**
 * PC-004 — Checkout sessions view (module console.checkout.sessions).
 *
 * Composed EXCLUSIVELY from the PC-003 checkout-sessions read models:
 * `readConsoleCheckoutSessions` (the open-offer list) plus
 * `readConsoleCheckoutSessionStatus` per session (the authority-reported
 * state of each open reference). Presentation only — nothing is recomputed.
 *
 * Honesty rules encoded here (design §9/§10 and the PC-003 DTO contracts):
 *   - an EMPTY session list is a legitimate VALUE (the authority answered:
 *     no open offers) — worded as an authoritative empty answer, never as an
 *     unavailable read;
 *   - an unavailable list read renders the honest UNKNOWN panel;
 *   - the port's own pinned boundary facts (runtime ARRIVING, authority
 *     owner, reportedBy) render verbatim — the area-20 Merchant Authority
 *     runtime is RTN wave 2 and the view neither hides nor overstates that;
 *   - a per-session status read that fails renders that session's status as
 *     UNKNOWN — it never degrades the session's own listed facts.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult, ConsoleStatus } from '@/lib/console/types';
import type {
  ConsoleCheckoutSessionsDto,
  ConsoleCheckoutSessionStatusDto,
} from '@/lib/console/read-models/checkout-sessions';
import { ConsoleStatusPresentation, ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from './console-read-result';
import {
  formatConsoleIsoTimestamp,
  formatConsoleMinorUnitsMoney,
} from './view-format';

function SessionStatusView({ result }: { result: ConsoleReadResult<ConsoleCheckoutSessionStatusDto> }) {
  if (result.outcome === 'unavailable') {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
        <ConsoleStatusPresentation status="UNKNOWN" subject="this session's authority status" />
        <p className="mt-1 text-xs text-stone-700" data-testid="console-checkout-status-unavailable">
          {result.note} The listed facts above are the list read's own answer — only the
          status sub-read is unavailable.
        </p>
      </div>
    );
  }
  const status: ConsoleCheckoutSessionStatusDto = result.value;
  return (
    <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <ConsoleStatusPresentation status={status.displayStatus} subject={status.checkoutId} />
        <span className="text-xs text-stone-600">
          authority state <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">{status.state}</code>
          <span className="text-stone-500"> · reported by {status.reportedBy} at {formatConsoleIsoTimestamp(status.at)}</span>
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-500">Mapping record: {status.mappingRecord}</p>
      {status.reason !== undefined && (
        <p className="mt-1 text-sm text-stone-700">Reason (authority-reported): {status.reason}</p>
      )}
      {status.nextActions !== undefined && (
        <p className="mt-1 text-sm text-stone-700">
          Authority-suggested next actions: {status.nextActions.join('; ')}
        </p>
      )}
      {status.reconciliation !== undefined && (
        <p className="mt-1 text-xs text-stone-600">
          Reconciliation: {status.reconciliation.whoResolves} resolves — recheck trigger:{' '}
          {status.reconciliation.recheckTrigger}
        </p>
      )}
      {status.evidence !== undefined && (
        <p className="mt-1 text-xs text-stone-600">
          Evidence:{' '}
          <a
            href={status.evidence.href}
            className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-stone-900"
          >
            {status.evidence.label}
          </a>
        </p>
      )}
    </div>
  );
}

function SessionItemView({
  session,
  status,
}: {
  readonly session: ConsoleCheckoutSessionsDto['sessions'][number];
  readonly status: ConsoleReadResult<ConsoleCheckoutSessionStatusDto> | undefined;
}) {
  return (
    <li data-console-checkout-session={session.checkoutId} className="rounded-xl border border-stone-300 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-medium">{session.title}</p>
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{session.checkoutId}</code>
      </div>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Protocol reference:</dt>
          <dd>
            <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{session.protocolReference}</code>
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">You receive:</dt>
          <dd className="font-semibold" data-testid="console-checkout-receive-amount">
            {formatConsoleMinorUnitsMoney(session.receiveAmount)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Valid until:</dt>
          <dd>{formatConsoleIsoTimestamp(session.validUntil)}</dd>
        </div>
      </dl>
      {status !== undefined ? (
        <SessionStatusView result={status} />
      ) : (
        <p className="mt-2 text-xs text-stone-500">
          Status sub-read not composed for this session (the page composes one status
          read per listed session).
        </p>
      )}
    </li>
  );
}

export interface ConsoleCheckoutSessionsViewProps {
  /** The checkout-sessions read-model envelope (PC-003). */
  readonly result: ConsoleReadResult<ConsoleCheckoutSessionsDto>;
  /** Per-session status reads, keyed by checkoutId (PC-003). */
  readonly statuses: ReadonlyMap<string, ConsoleReadResult<ConsoleCheckoutSessionStatusDto>>;
}

/** The composed checkout sessions list: honest boundary facts + per-session truth. */
export function ConsoleCheckoutSessionsView({ result, statuses }: ConsoleCheckoutSessionsViewProps): ReactNode {
  return (
    <ConsoleReadResultView
      result={result}
      subject="the open checkout sessions"
      renderValue={(value: ConsoleCheckoutSessionsDto, _status: ConsoleStatus, authority) => (
        <section data-console-view="checkout-sessions" aria-labelledby="console-checkout-sessions-heading" className="min-w-0">
          <h2 id="console-checkout-sessions-heading" className="text-lg font-semibold">
            Open checkout sessions — as the checkout port reports them
          </h2>
          <div className="mt-2 max-w-3xl rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
            <p>
              <span className="font-semibold">Boundary facts (the port's own, verbatim): </span>
              runtime <code className="rounded bg-stone-100 px-1 py-0.5">{value.runtime}</code> ·
              authority owner {value.authorityOwner} · items reported by {value.reportedBy}.
            </p>
            <p className="mt-1">
              The checkout authority surface (the area-20 Merchant Authority runtime) is a
              later-wave change and is honestly pinned ARRIVING at this boundary; reads the
              composed runtime answers are authoritative, and nothing here hides or
              overstates that.
            </p>
          </div>
          {value.sessions.length === 0 ? (
            <p
              data-testid="console-checkout-empty-value"
              className="mt-4 max-w-3xl rounded-xl border border-stone-300 bg-white p-4 text-sm text-stone-700"
            >
              The checkout authority answered: <span className="font-semibold">no open checkout
              offers are queued right now</span> — a legitimate authoritative VALUE (an
              authoritative empty answer), not an unavailable read. New sessions appear here
              when the authority presents them.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {value.sessions.map((session) => (
                <SessionItemView key={session.checkoutId} session={session} status={statuses.get(session.checkoutId)} />
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
