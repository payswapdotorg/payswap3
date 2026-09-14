/**
 * PC-005 — Console developer API-keys boundary (the dedicated credential
 * boundary for API-key operations, sanctioned by the PC-005 work order
 * under the PC-003-owned /api/console/developers root).
 *
 * POST   /api/console/developers/api-keys        create (label)  → the
 *        plaintext token shown ONCE (JSON mode) or a one-time receipt +
 *        303 redirect back to the page (form mode — the console page's
 *        plain-HTML form). The token is generated server-side, its digest
 *        is all the store keeps, and the environment is the PC-001
 *        server-derived context — NO query parameter, header, cookie, or
 *        body value can select the environment (spoofed ?env= is ignored;
 *        proven by tests).
 * POST   … (form field action=revoke + id) / DELETE …?id=…
 *        explicit revocation (audited in the in-memory audit trail).
 * GET    …                                          list — id/label/
 *        environment/created/revoked ONLY; never the secret.
 *
 * Boundary order (design §8): server-side role check FIRST (fail-closed
 * 404 {ok:false} with no content — the console never confirms this
 * module's existence to a caller outside its frozen allowed roles), then
 * the operation, then the response envelope. Every request (authorized or
 * denied) is ingested into the diagnostic request-log ring payload-free
 * (method/path/status/outcome only — design §11 redaction is a property of
 * the ring itself: scrubCredentialReferences runs at ingestion).
 */

import { NextResponse } from 'next/server';
import { authorizeConsoleApiRead } from '@/lib/console/authority/route-access';
import { getDeveloperApiKeyStore } from '@/lib/console/developers/api-key-store';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { readConsoleDeveloperApiKeys, developerCredentialContextFor } from '@/lib/console/developers/read-models';
import {
  boundaryErrorFlag,
  consoleApiDeniedBody,
  consoleDeveloperWriteResponseBody,
  ingestConsoleBoundaryRequest,
} from '@/lib/console/developers/api-boundary';

export const dynamic = 'force-dynamic';

const MODULE_ID = 'console.developers.api-keys';
const PATH = '/api/console/developers/api-keys' as const;
const PAGE_HREF = '/console/developers/api-keys';

function noStore<T>(body: T, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const access = await authorizeConsoleApiRead(MODULE_ID);
  if (!access.allowed) {
    ingestConsoleBoundaryRequest({ method: 'GET', path: PATH, status: 404, event: 'console.developers.boundary.denied', outcome: 'denied' });
    return noStore(consoleApiDeniedBody(), 404);
  }
  const result = readConsoleDeveloperApiKeys(access.principal.role);
  ingestConsoleBoundaryRequest({ method: 'GET', path: PATH, status: 200, event: 'console.developers.api-keys.listed', outcome: 'listed' });
  return noStore(consoleDeveloperWriteResponseBody(access.principal.role, result), 200);
}

/** Parsed POST input (form-encoded or JSON — the two honest modes). */
interface ParsedCredentialInput {
  readonly mode: 'form' | 'json';
  readonly action: 'create' | 'revoke';
  readonly label?: string;
  readonly id?: string;
}

async function parseCredentialInput(request: Request): Promise<ParsedCredentialInput | null> {
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
      ...(typeof record.label === 'string' ? { label: record.label } : {}),
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
    const label = form.get('label');
    const id = form.get('id');
    return {
      mode: 'form',
      action,
      ...(typeof label === 'string' ? { label } : {}),
      ...(typeof id === 'string' ? { id } : {}),
    };
  }
  return null;
}

export async function POST(request: Request) {
  const access = await authorizeConsoleApiRead(MODULE_ID);
  if (!access.allowed) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 404, event: 'console.developers.boundary.denied', outcome: 'denied' });
    return noStore(consoleApiDeniedBody(), 404);
  }
  const input = await parseCredentialInput(request);
  if (input === null) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.api-keys.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'invalid-body' }, 422);
  }

  const context = developerCredentialContextFor(access.principal.role);
  const store = getDeveloperApiKeyStore();

  if (input.action === 'revoke') {
    if (input.id === undefined) {
      ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.api-keys.invalid-input', outcome: 'invalid-input' });
      return noStore({ ok: false, error: 'missing-id' }, 422);
    }
    const revoked = store.revoke({ id: input.id }, context);
    if (!revoked.ok) {
      const status = revoked.error === 'unknown-id' ? 404 : 409;
      ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status, event: 'console.developers.api-keys.revocation-failed', outcome: revoked.error === 'unknown-id' ? 'unknown-target' : 'already-revoked' });
      if (input.mode === 'form') {
        return NextResponse.redirect(new URL(`${PAGE_HREF}?error=${boundaryErrorFlag(revoked.error)}`, request.url), 303);
      }
      return noStore({ ok: false, error: revoked.error }, status);
    }
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 200, event: 'console.developers.api-keys.revoked', outcome: 'revoked' });
    if (input.mode === 'form') {
      return NextResponse.redirect(new URL(PAGE_HREF, request.url), 303);
    }
    return noStore(consoleDeveloperWriteResponseBody(access.principal.role, { revoked: revoked.revoked }), 200);
  }

  if (input.label === undefined) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.api-keys.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'missing-label' }, 422);
  }
  const created = store.create({ label: input.label }, context);
  if (!created.ok) {
    ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 422, event: 'console.developers.api-keys.invalid-input', outcome: 'invalid-input' });
    if (input.mode === 'form') {
      return NextResponse.redirect(new URL(`${PAGE_HREF}?error=${boundaryErrorFlag(created.error)}`, request.url), 303);
    }
    return noStore({ ok: false, error: created.error }, 422);
  }
  ingestConsoleBoundaryRequest({ method: 'POST', path: PATH, status: 200, event: 'console.developers.api-keys.created', outcome: 'created' });
  if (input.mode === 'form') {
    // One-time receipt: the page renders the secret exactly once after the
    // redirect; the receipt id is opaque and never enters the request log.
    const receiptId = getDeveloperCreationReceiptStore().issue(created.created.secret, created.created.key.id);
    return NextResponse.redirect(new URL(`${PAGE_HREF}?receipt=${receiptId}`, request.url), 303);
  }
  // JSON mode: the plaintext is shown ONCE here — never retained, never
  // re-displayed by any later read.
  return noStore(
    consoleDeveloperWriteResponseBody(access.principal.role, {
      created: created.created,
      note: 'The plaintext token is shown this one time only. It is not retained retrievably and cannot be re-displayed; store it now.',
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
    ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status: 422, event: 'console.developers.api-keys.invalid-input', outcome: 'invalid-input' });
    return noStore({ ok: false, error: 'missing-id' }, 422);
  }
  const revoked = getDeveloperApiKeyStore().revoke(
    { id },
    developerCredentialContextFor(access.principal.role),
  );
  if (!revoked.ok) {
    const status = revoked.error === 'unknown-id' ? 404 : 409;
    ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status, event: 'console.developers.api-keys.revocation-failed', outcome: revoked.error === 'unknown-id' ? 'unknown-target' : 'already-revoked' });
    return noStore({ ok: false, error: revoked.error }, status);
  }
  ingestConsoleBoundaryRequest({ method: 'DELETE', path: PATH, status: 200, event: 'console.developers.api-keys.revoked', outcome: 'revoked' });
  return noStore(consoleDeveloperWriteResponseBody(access.principal.role, { revoked: revoked.revoked }), 200);
}
