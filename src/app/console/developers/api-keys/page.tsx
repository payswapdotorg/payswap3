/**
 * PC-005 — Console module route entrypoint (composed): developers — API keys.
 *
 * Module:  console.developers.api-keys
 * Route:   /console/developers/api-keys
 *
 * Composed EXCLUSIVELY from the PC-005 API-keys read model over the
 * in-memory credential store. The one-time creation receipt (issued by the
 * credential boundary's form redirect) is consumed HERE, server-side, so
 * the plaintext token renders exactly once — a consumed, unknown, or
 * expired receipt renders the honest already-shown state instead.
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleDeveloperApiKeysView } from '@/components/console/developers/api-keys-view';
import type { DeveloperSecretOncePanelProps } from '@/components/console/developers/api-keys-view';
import { readConsoleDeveloperApiKeys } from '@/lib/console/developers/read-models';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { boundaryErrorFlag } from '@/lib/console/developers/api-boundary';

export const metadata = consoleRouteMetadata('/console/developers/api-keys');

type PageSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConsoleDevelopersApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console/developers/api-keys');
  const params = await searchParams;

  // The one-time creation receipt: consumed destructively here, so the
  // secret renders exactly once (a re-render answers the honest
  // already-shown state). The receipt id never entered the request log.
  const receiptId = firstValue(params.receipt);
  const receipt = receiptId === undefined ? null : getDeveloperCreationReceiptStore().consume(receiptId);
  const secretOnce: DeveloperSecretOncePanelProps | null =
    receipt === null
      ? null
      : { secret: receipt.secret, targetId: receipt.targetId, kind: 'api-key' };

  // The error flag the boundary redirects back with (already scrubbed at
  // the boundary; re-scrubbed here defensively before it touches markup).
  const rawError = firstValue(params.error);
  const errorFlag = rawError === undefined ? null : boundaryErrorFlag(rawError);

  const result = readConsoleDeveloperApiKeys(principal.role);

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/developers/api-keys"
        lead="Environment-scoped API-key controls through the dedicated credential boundary: the token is generated on the server, shown exactly once at creation, and never re-displayed; revocation is explicit and audited."
      />
      <ConsoleDeveloperApiKeysView result={result} secretOnce={secretOnce} errorFlag={errorFlag} />
    </article>
  );
}
