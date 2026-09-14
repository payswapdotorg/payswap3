/**
 * PC-005 — Console developer webhooks boundary (the dedicated credential
 * boundary for webhook-endpoint operations, sanctioned by the PC-005 work
 * order under the PC-003-owned /api/console/developers root).
 *
 * POST   /api/console/developers/webhooks        register an endpoint
 *        (url) → the signing secret shown ONCE (JSON mode) or a one-time
 *        receipt + 303 redirect back to the page (form mode). The signing
 *        secret is generated server-side and treated EXACTLY like an API
 *        key (design §11): digest-only retention, never logged, never
 *        re-displayed.
 * POST   … (form field action=revoke + id) / DELETE …?id=…
 *        explicit endpoint revocation (audited).
 * GET    …                                          list — id/url/
 *        environment/created/revoked ONLY; never the signing secret.
 *
 * NO delivery worker exists at this baseline: this boundary registers
 * endpoints only. It never constructs deliveries, never enqueues anything,
 * and never implies protocol replay (the webhooks page renders the honest
 * delivery-state note from webhook-events.ts).
 *
 * Boundary order and the payload-free request-log ingestion are identical
 * to the API-keys boundary (see ./api-keys/route.ts).
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import { getDeveloperWebhookStore } from '@/lib/console/developers/webhook-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { readConsoleDeveloperWebhooks, developerCredentialContextFor } from '@/lib/console/developers/read-models';
import {
  boundaryErrorFlag,
  consoleApiDeniedBody,
  consoleDeveloperWriteResponseBody,
  ingestConsoleBoundaryRequest,
} from '@/lib/console/developers/api-boundary';

export const dynamic = 'force-dynamic';

const MODULE_ID = 'console.developers.webhooks';
const PATH = '/api/console/developers/webhooks' as const;
const PAGE_HREF = '/console/developers/webhooks';

function noStore<T>(body: T, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

interface ParsedWebhookInput {
  readonly mode: 'form' | 'json';
  readonly action: 'create' | 'revoke';
  readonly url?: string;
  readonly id?: string;
}

async function parseWebhookInput(request: Request): Promise<ParsedWebhookInput | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return null;
    }
    if (body === null || typeof body !== 'object') {
      return null;
    }
    const record = body as Record<string, unknown>;
    const action = record.action === 'revoke' ? 'revoke' : 'create';
    return {
      mode: 'json',
      action,
      ...(typeof record.url === 'string' ? { url: record.url } : {}),
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
    };
  }
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return null;
    }
    const action = form.get('action') === 'revoke' ? 'revoke' : 'create';
    const url = form.get('url');
    const id = form.get('id');
    return {
      mode: 'form',
      action,
      ...(typeof url === 'string' ? { url } : {}),
      ...(typeof id === 'string' ? { id } : {}),
    };
  }
  return null;
}

export async function GET() {
  const access = await authorizeConsoleApiRead(MODULE_ID);
  if (!access.allowed) {
    ingestConsoleBoundaryRequest({ method: 'GET', path: PATH, status: 404, event: 'console.developers.boundary.denied', outcome: 'denied' });
    return noStore(consoleApiDeniedBody(), 404);
  }
  const result = readConsoleDeveloperWebhooks(access.principal.role);
  ingestConsoleBoundaryRequest({ method: 'GET', path: PATH, status: 200, event: 'console.developers.webhooks.listed', outcome: 'listed' });
  return noStore(consoleDeveloperWriteResponseBody(access.principal.role, result), 200);
}

export async function POST(request: Request) {
  const access = await authorizeConsoleApiRead(MODULE_ID);
  if (!access.allowed) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 404, event: 'console.developers.boundary.denied', outcome: 'denied' });
    return noStore(consoleApiDeniedBody(), 404);
  }
  const input = await parseWebhookInput(request);
  if (input === null) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.webhooks.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'invalid-body' }, 422);
  }

  const context = developerCredentialContextFor(access.principal.role);
  const store = getDeveloperWebhookStore();

  if (input.action === 'revoke') {
    if (input.id === undefined) {
      ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.webhooks.invalid-input', outcome: 'invalid-input' });
      return noStore({ ok: false, error: 'missing-id' }, 422);
    }
    const revoked = store.revoke({ id: input.id }, context);
    if (!revoked.ok) {
      const status = revoked.error === 'unknown-id' ? 404 : 409;
      ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status, event: 'console.developers.webhooks.revocation-failed', outcome: revoked.error === 'unknown-id' ? 'unknown-target' : 'already-revoked' });
      if (input.mode === 'form') {
        return NextResponse.redirect(new URL(`${PAGE_HREF}?error=${boundaryErrorFlag(revoked.error)}`, request.url), 303);
      }
      return noStore({ ok: false, error: revoked.error }, status);
    }
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 200, event: 'console.developers.webhooks.revoked', outcome: 'revoked' });
    if (input.mode === 'form') {
      return NextResponse.redirect(new URL(PAGE_HREF, request.url), 303);
    }
    return noStore(consoleDeveloperWriteResponseBody(access.principal.role, { revoked: revoked.revoked }), 200);
  }

  if (input.url === undefined) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.webhooks.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'missing-url' }, 422);
  }
  const created = store.create({ url: input.url }, context);
  if (!created.ok) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.webhooks.invalid-input', outcome: 'invalid-input' });
    if (input.mode === 'form') {
      return NextResponse.redirect(new URL(`${PAGE_HREF}?error=${boundaryErrorFlag(created.error)}`, request.url), 303);
    }
    return noStore({ ok: false, error: created.error }, 422);
  }
  ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 200, event: 'console.developers.webhooks.created', outcome: 'created' });
  if (input.mode === 'form') {
    const receiptId = getDeveloperCreationReceiptStore().issue(
      created.created.signingSecret,
      created.created.endpoint.id,
    );
    return NextResponse.redirect(new URL(`${PAGE_HREF}?receipt=${receiptId}`, request.url), 303);
  }
  // JSON mode: the signing secret is shown ONCE here (a credential — never
  // logged, never re-displayed).
  return noStore(
    consoleDeveloperWriteResponseBody(access.principal.role, {
      created: created.created,
      note: 'The signing secret is shown this one time only. It is not retained retrievably and cannot be re-displayed; store it now. No delivery worker exists at this baseline — retries are not implemented and must never imply protocol replay.',
    }),
    200,
  );
}

export async function DELETE(request: Request) {
  const access = await authorizeConsoleApiRead(MODULE_ID);
  if (!access.allowed) {
    ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status: 404, event: 'console.developers.boundary.denied', outcome: 'denied' });
    return noStore(consoleApiDeniedBody(), 404);
  }
  const id = new URL(request.url).searchParams.get('id');
  if (id === null) {
    ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status: 422, event: 'console.developers.webhooks.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'missing-id' }, 422);
  }
  const revoked = getDeveloperWebhookStore().revoke(
    { id },
    developerCredentialContextFor(access.principal.role),
  );
  if (!revoked.ok) {
    const status = revoked.error === 'unknown-id' ? 404 : 409;
    ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status, event: 'console.developers.webhooks.revocation-failed', outcome: revoked.error === 'unknown-id' ? 'unknown-target' : 'already-revoked' });
    return noStore({ ok: false, error: revoked.error }, status);
  }
  ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status: 200, event: 'console.developers.webhooks.revoked', outcome: 'revoked' });
  return noStore(consoleDeveloperWriteResponseBody(access.principal.role, { revoked: revoked.revoked }), 200);
}
