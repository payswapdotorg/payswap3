/**
 * PC-005 — API-keys view (module console.developers.api-keys).
 *
 * Renders EXCLUSIVELY the PC-005 read model's envelope:
 *   - the one-time secret panel (creation receipt consumed by the page —
 *     shown ONCE, with the honest "not retained, cannot be re-displayed"
 *     wording; a consumed/expired receipt renders the honest already-shown
 *     state instead);
 *   - the create form (plain HTML form POST to the credential boundary —
 *     no client JavaScript; the boundary redirects back with a receipt);
 *   - the key list (id/label/environment/created/revoked ONLY — the secret
 *     is never in the DTO at all);
 *   - an explicit revoke form per active key (explicit + audited);
 *   - the in-memory audit trail and the honest provenance note.
 *
 * Honesty rules encoded here (design §11):
 *   - the boundary contract section states the environment is
 *     server-derived and CANNOT be selected by any request value;
 *   - an EMPTY key list is the honest VALUE "no API keys recorded yet";
 *   - the provenance panel (developer-provenance-note.tsx) is rendered in
 *     BOTH envelope branches (hoisted out of the value renderer).
 */

import type { ReactNode } from 'react';
import type { ConsoleReadResult } from '@/lib/console/types';
import type { ConsoleDeveloperApiKeysDto } from '@/lib/console/developers/read-models';
import { ConsoleAuthorityLine } from '@/components/console';
import { ConsoleReadResultView } from '@/components/console/views/console-read-result';
import { formatConsoleEpochMs } from '@/components/console/views/view-format';
import { DeveloperProvenanceNote } from './developer-provenance-note';

const BOUNDARY_HREF = '/api/console/developers/api-keys';

/** What a consumed creation receipt hands the page (secret shown ONCE). */
export interface DeveloperSecretOncePanelProps {
  readonly secret: string;
  readonly targetId: string;
  readonly kind: 'api-key' | 'webhook-signing-secret';
}

/** The one-time secret display: creation time only, never re-displayed. */
export function DeveloperSecretOncePanel({ secret, targetId, kind }: DeveloperSecretOncePanelProps): ReactNode {
  return (
    <section
      data-console-developer-secret-once="true"
      aria-labelledby="developer-secret-once-heading"
      className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50 p-4 sm:p-6"
    >
      <h2 id="developer-secret-once-heading" className="text-lg font-semibold text-teal-900">
        {kind === 'api-key' ? 'API key created — the token is shown this one time only'
          : 'Webhook endpoint registered — the signing secret is shown this one time only'}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-teal-900">
        This is the only time this material is displayed. It is not retained retrievably, it cannot be
        re-displayed by any later read, and it is never logged. Copy it into your secret storage now;
        if you lose it, revoke this {kind === 'api-key' ? 'key' : 'endpoint'} and create a new one.
      </p>
      <output
        data-testid="developer-secret-once-value"
        className="mt-3 block max-w-3xl overflow-x-auto rounded-lg border border-teal-300 bg-white p-3 font-mono text-sm break-all"
      >
        {secret}
      </output>
      <p className="mt-2 text-xs text-teal-800">
        Issued for <code className="rounded bg-white/60 px-1 py-0.5">{targetId}</code> · server-generated ·
        environment-scoped by the server-derived configuration.
      </p>
    </section>
  );
}

/** The honest already-shown state (a receipt that no longer exists). */
export function DeveloperSecretAlreadyShownNote(): ReactNode {
  return (
    <p
      data-testid="developer-secret-already-shown"
      className="rounded-xl border border-stone-300 bg-stone-50 p-4 text-sm text-stone-700"
    >
      The creation receipt is unknown, already used, or expired. Secret material is shown exactly once
      at creation and cannot be re-displayed — if the token was lost, revoke the record and create a
      new one.
    </p>
  );
}

export interface ConsoleDeveloperApiKeysViewProps {
  readonly result: ConsoleReadResult<ConsoleDeveloperApiKeysDto>;
  /** The consumed creation receipt (secret-once panel), when one existed. */
  readonly secretOnce: DeveloperSecretOncePanelProps | null;
  /** An honest error flag the boundary redirected back with, when present. */
  readonly errorFlag: string | null;
}

function BoundaryContractView(): ReactNode {
  return (
    <section aria-labelledby="api-keys-boundary-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <h2 id="api-keys-boundary-heading" className="text-lg font-semibold text-stone-900">
        The credential boundary
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        API keys are generated, stored, and returned through a dedicated server-side boundary. The
        environment of every key is derived from server configuration at creation time — no query
        parameter, form field, header, or client value can select it. Revocation is explicit and
        audited. This registry is in-memory developer tooling, not protocol state.
      </p>
      <dl className="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="font-medium text-stone-600">Create (this form):</dt><dd><code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">POST {BOUNDARY_HREF}</code></dd></div>
        <div><dt className="font-medium text-stone-600">List (secret-free):</dt><dd><code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">GET {BOUNDARY_HREF}</code></dd></div>
        <div><dt className="font-medium text-stone-600">Revoke:</dt><dd><code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">DELETE {BOUNDARY_HREF}?id=…</code></dd></div>
        <div><dt className="font-medium text-stone-600">Shown:</dt><dd>id · label · environment · created · revoked</dd></div>
      </dl>
    </section>
  );
}

function CreateKeyFormView({ environment }: { readonly environment: string }): ReactNode {
  return (
    <section aria-labelledby="api-keys-create-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
      <h2 id="api-keys-create-heading" className="text-lg font-semibold text-stone-900">
        Create an API key
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-stone-600">
        The token is generated on the server and shown once on the next render. The key is created in
        the current server-derived environment (<span className="font-semibold">{environment}</span>) —
        this form has no environment field by design.
      </p>
      <form method="post" action={BOUNDARY_HREF} className="mt-4 flex max-w-xl flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="api-key-label" className="block text-sm font-medium text-stone-700">
            Label
          </label>
          <input
            id="api-key-label"
            name="label"
            type="text"
            required
            minLength={1}
            maxLength={64}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
            placeholder="e.g. ci-pipeline"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Create API key
        </button>
      </form>
    </section>
  );
}

function KeyItemView({
  apiKey,
}: {
  readonly apiKey: ConsoleDeveloperApiKeysDto['keys'][number];
}): ReactNode {
  return (
    <li
      data-console-developer-api-key={apiKey.id}
      className="rounded-xl border border-stone-300 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-medium">{apiKey.label}</p>
        <code className="break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{apiKey.id}</code>
        {apiKey.revokedWallMs === null ? (
          <span className="inline-flex min-h-6 items-center rounded-lg border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
            Active
          </span>
        ) : (
          <span className="inline-flex min-h-6 items-center rounded-lg border border-stone-300 bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
            Revoked
          </span>
        )}
      </div>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Environment:</dt>
          <dd data-testid="console-api-key-environment">{apiKey.environment}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-stone-600">Created:</dt>
          <dd>{formatConsoleEpochMs(apiKey.createdWallMs)}</dd>
        </div>
        {apiKey.revokedWallMs !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-stone-600">Revoked:</dt>
            <dd>{formatConsoleEpochMs(apiKey.revokedWallMs)}</dd>
          </div>
        )}
      </dl>
      {apiKey.revokedWallMs === null && (
        <form method="post" action={BOUNDARY_HREF} className="mt-3">
          <input type="hidden" name="action" value="revoke" />
          <input type="hidden" name="id" value={apiKey.id} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
          >
            Revoke this key
          </button>
        </form>
      )}
    </li>
  );
}

function AuditTrailView({ audit }: { readonly audit: ConsoleDeveloperApiKeysDto['audit'] }): ReactNode {
  if (audit.length === 0) {
    return (
      <p className="text-sm text-stone-600" data-testid="console-api-keys-audit-empty">
        No credential operations have been recorded yet (the audit trail is in-memory and starts empty).
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

export function ConsoleDeveloperApiKeysView({
  result,
  secretOnce,
  errorFlag,
}: ConsoleDeveloperApiKeysViewProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-console-view="developer-api-keys">
      <DeveloperProvenanceNote subject="API keys" />
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
        subject="the API-key registry"
        renderValue={(value, _status, authority) => (
          <>
            <BoundaryContractView />
            <CreateKeyFormView environment={value.environment} />
            <section aria-labelledby="api-keys-list-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="api-keys-list-heading" className="text-lg font-semibold text-stone-900">
                Keys in this environment ({value.environment})
              </h2>
              {value.keys.length === 0 ? (
                <p className="mt-2 max-w-3xl text-sm text-stone-600" data-testid="console-api-keys-empty-value">
                  No API keys recorded yet — the honest empty answer of the in-memory registry (cleared
                  on restart). Create one above; the list shows id, label, environment, created, and
                  revoked — never the secret.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {value.keys.map((apiKey) => (
                    <KeyItemView key={apiKey.id} apiKey={apiKey} />
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="api-keys-audit-heading" className="rounded-xl border border-stone-300 bg-white p-4 sm:p-6">
              <h2 id="api-keys-audit-heading" className="text-lg font-semibold text-stone-900">
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
