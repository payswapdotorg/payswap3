/**
 * PC-005 — Webhooks view (module console.developers.webhooks).
 *
 * Renders EXCLUSIVELY the PC-005 read model's envelope:
 *   - the endpoint registry (id/url/environment/created/revoked — the
 *     signing secret is never in the DTO);
 *   - the create form (plain HTML form POST to the credential boundary —
 *     the signing secret comes back ONCE through a one-time receipt);
 *   - an explicit revoke form per active endpoint;
 *   - the EVENT CATALOG: the identifiers a delivery WOULD reference — every
 *     entry quotes the real vocabulary that defines it (the frozen
 *     observability taxonomy; the durable substrate job-lifecycle event
 *     vocabulary) — with per-entry source attribution;
 *   - the HONEST DELIVERY STATE (design §11, stated — never simulated):
 *     no delivery worker exists at this baseline, retries are not
 *     implemented, and a retry must never imply protocol replay;
 *   - the in-memory audit trail + provenance note.
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleDeveloperWebhooksDto } from '@/lib/console/developers/read-models';
import { ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from '@/components/console/views/console-read-result';
import { formatConsoleEpochMs } from '@/components/console/views/view-format';
import { DeveloperProvenanceNote } from './developer-provenance-note';
import { DeveloperSecretAlreadyShownNote, DeveloperSecretOncePanel } from './api-keys-view';
import type { DeveloperSecretOncePanelProps } from './api-keys-view';

const BOUNDARY_HREF = '/api/console/developers/webhooks';

export interface ConsoleDeveloperWebhooksViewProps {
  readonly result: ConsoleReadResult<ConsoleDeveloperWebhooksDto>;
  /** The consumed creation receipt (signing secret shown ONCE), when present. */
  readonly secretOnce: DeveloperSecretOncePanelProps | null;
  /** An honest error flag the boundary redirected back with, when present. */
  readonly errorFlag: string | null;
}

function CreateEndpointFormView({ environment }: { readonly environment: string }): ReactNode {
  return (
    <section aria-labelledby="webhooks-create-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <h2 id="webhooks-create-heading" className="text-lg font-semibold text-stone-900">
        Register a webhook endpoint
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        The signing secret is generated on the server and shown once on the next render — it is a
        credential: never logged, never re-displayed. The endpoint is registered in the current
        server-derived environment (<span className="font-semibold">{environment}</span>). https URLs
        are accepted, plus http for loopback hosts (local development receivers).
      </p>
      <form method="post" action={BOUNDARY_HREF} className="mt-4 flex max-w-xl flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="webhook-url" className="block text-sm font-medium text-stone-700">
            Endpoint URL
          </label>
          <input
            id="webhook-url"
            name="url"
            type="url"
            required
            maxLength={2048}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            placeholder="https://example.com/webhooks/payswap"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Register endpoint
        </button>
      </form>
    </section>
  );
}

function EndpointItemView({
  endpoint,
}: {
  readonly endpoint: ConsoleDeveloperWebhooksDto['endpoints'][number];
}): ReactNode {
  return (
    <li data-console-developer-webhook={endpoint.id} className="rounded-xl border border-stone-300 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{endpoint.id}</code>
        {endpoint.revokedWallMs === null ? (
          <span className="inline-flex min-h-6 items-center rounded-lg border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
            Active
          </span>
        ) : (
          <span className="inline-flex min-h-6 items-center rounded-lg border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
            Revoked
          </span>
        )}
      </div>
      <p className="mt-1 break-all text-sm text-stone-800" data-testid="console-webhook-url">{endpoint.url}</p>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Environment:</dt>
          <dd>{endpoint.environment}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Registered:</dt>
          <dd>{formatConsoleEpochMs(endpoint.createdWallMs)}</dd>
        </div>
        {endpoint.revokedWallMs !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Revoked:</dt>
            <dd>{formatConsoleEpochMs(endpoint.revokedWallMs)}</dd>
          </div>
        )}
      </dl>
      {endpoint.revokedWallMs === null && (
        <form method="post" action={BOUNDARY_HREF} className="mt-3">
          <input type="hidden" name="action" value="revoke" />
          <input type="hidden" name="id" value={endpoint.id} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
          >
            Revoke this endpoint
          </button>
        </form>
      )}
    </li>
  );
}

function EventCatalogView({
  catalog,
}: {
  readonly catalog: ConsoleDeveloperWebhooksDto['eventCatalog'];
}): ReactNode {
  return (
    <section aria-labelledby="webhooks-events-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <h2 id="webhooks-events-heading" className="text-lg font-semibold text-stone-900">
        Referenceable event identifiers (the real vocabularies)
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        A webhook delivery references identifiers the repository actually defines — this catalog
        lists exactly those vocabularies and nothing invented. Each entry quotes the vocabulary that
        owns it.
      </p>
      <ul className="mt-3 space-y-2">
        {catalog.map((entry) => (
          <li
            key={entry.identifier}
            data-console-webhook-event={entry.identifier}
            className="rounded-lg border border-stone-200 bg-stone-50 p-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs font-semibold">{entry.identifier}</code>
              <span className="text-xs text-stone-500">
                {entry.source === 'observability-taxonomy' ? 'observability domain' : 'substrate job lifecycle'}
              </span>
            </div>
            <p className="mt-1 text-sm text-stone-700">{entry.definition}</p>
            <p className="mt-1 text-xs text-stone-500">Vocabulary: {entry.sourceModule}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeliveryStateView({ note }: { readonly note: string }): ReactNode {
  return (
    <section
      data-console-webhook-delivery-state="no-worker"
      aria-labelledby="webhooks-delivery-heading"
      className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 sm:p-6"
    >
      <h2 id="webhooks-delivery-heading" className="text-lg font-semibold text-amber-900">
        Delivery records — honest state
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-amber-900" data-testid="console-webhooks-delivery-note">
        {note}
      </p>
      <p className="mt-2 max-w-3xl text-sm text-amber-800">
        The catalog above therefore describes the identifiers a delivery WOULD reference once a
        delivery worker exists as its own governed change — nothing on this page simulates a
        delivery, and no retry semantics are implied.
      </p>
    </section>
  );
}

function AuditTrailView({ audit }: { readonly audit: ConsoleDeveloperWebhooksDto['audit'] }): ReactNode {
  if (audit.length === 0) {
    return (
      <p className="text-sm text-stone-600" data-testid="console-webhooks-audit-empty">
        No webhook operations have been recorded yet (the audit trail is in-memory and starts empty).
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-2">
      {audit.map((entry) => (
        <li
          key={`${entry.wallMs}-${entry.action}-${entry.targetId}`}
          data-console-developer-audit={entry.action}
          className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700"
        >
          <span className="font-medium">{entry.action}</span>
          <span className="text-stone-500"> · {formatConsoleEpochMs(entry.wallMs)} · by {entry.actorRole} · env {entry.environment} · target {entry.targetId}</span>
          <p className="mt-1 text-xs text-stone-600">{entry.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function ConsoleDeveloperWebhooksView({
  result,
  secretOnce,
  errorFlag,
}: ConsoleDeveloperWebhooksViewProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-console-view="developer-webhooks">
      <DeveloperProvenanceNote subject="Webhook endpoints" />
      {secretOnce !== null ? (
        <DeveloperSecretOncePanel {...secretOnce} />
      ) : (
        <DeveloperSecretAlreadyShownNote />
      )}
      {errorFlag !== null && (
        <p
          data-testid="console-developer-boundary-error"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          The credential boundary rejected the last operation: <code className="rounded bg-white/60 px-1 py-0.5">{errorFlag}</code>.
          Nothing was recorded for it beyond the diagnostic request log.
        </p>
      )}
      <ConsoleReadResultView
        result={result}
        subject="the webhook endpoint registry"
        renderValue={(value, _status, authority) => (
          <>
            <CreateEndpointFormView environment={value.environment} />
            <section aria-labelledby="webhooks-list-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="webhooks-list-heading" className="text-lg font-semibold text-stone-900">
                Endpoints in this environment ({value.environment})
              </h2>
              {value.endpoints.length === 0 ? (
                <p className="mt-2 max-w-3xl text-sm text-stone-600" data-testid="console-webhooks-empty-value">
                  No webhook endpoints registered yet — the honest empty answer of the in-memory
                  registry (cleared on restart). The list shows id, url, environment, registered, and
                  revoked — never the signing secret.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {value.endpoints.map((endpoint) => (
                    <EndpointItemView key={endpoint.id} endpoint={endpoint} />
                  ))}
                </ul>
              )}
            </section>
            <EventCatalogView catalog={value.eventCatalog} />
            <DeliveryStateView note={value.deliveryStateNote} />
            <section aria-labelledby="webhooks-audit-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="webhooks-audit-heading" className="text-lg font-semibold text-stone-900">
                Audit trail (in-memory)
              </h2>
              <AuditTrailView audit={value.audit} />
            </section>
            <ConsoleAuthorityLine
              owningAuthority={authority.owningAuthority}
              runtimeBoundary={authority.runtimeBoundary}
              durableSource={authority.durableSource}
              evidenceReference={authority.evidenceReference}
            />
          </>
        )}
      />
    </div>
  );
}
