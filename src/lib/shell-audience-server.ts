/**
 * Server-side shell audience resolution (UI-002 additive helper).
 *
 * `getShellAudience()` in the navigation grammar stays synchronous (client
 * cookie read). Server components resolve the authoritative audience here,
 * asynchronously, from the same session signal — and never from anything
 * the UI itself decided (P8).
 */
import { cookies } from 'next/headers';
import { NAV_AUDIENCES, SHELL_AUDIENCE_COOKIE, type NavAudience } from '@/lib/navigation';

export async function resolveShellAudience(): Promise<NavAudience> {
  const store = await cookies();
  const raw = store.get(SHELL_AUDIENCE_COOKIE)?.value;
  if (raw && (NAV_AUDIENCES as readonly string[]).includes(raw)) {
    return raw as NavAudience;
  }
  // No authoritative signal → least visibility.
  return 'unauthenticated';
}
