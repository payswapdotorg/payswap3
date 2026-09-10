/**
 * Shell audience API (UI-002 additive).
 *
 * Server-side writer for the simulated authoritative audience signal used
 * by the verification harness. It only accepts declared audiences and
 * writes the session signal — it grants no product capability by itself;
 * every guarded surface still evaluates the signal through guardSurface
 * on entry (P8).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NAV_AUDIENCES, SHELL_AUDIENCE_COOKIE } from '@/lib/navigation';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }
  const audience = (body as { audience?: unknown } | null)?.audience;
  if (typeof audience !== 'string' || !(NAV_AUDIENCES as readonly string[]).includes(audience)) {
    return NextResponse.json({ ok: false, error: 'invalid-audience' }, { status: 400 });
  }
  const store = await cookies();
  store.set(SHELL_AUDIENCE_COOKIE, audience, {
    path: '/',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return NextResponse.json({ ok: true, audience });
}
