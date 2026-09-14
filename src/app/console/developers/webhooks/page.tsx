/**
 * PC-005 — Console module route entrypoint (composed): developers — webhooks.
 *
 * Module:  console.developers.webhooks
 * Route:   /console/developers/webhooks
 *
 * Composed EXCLUSIVELY from the PC-005 webhooks read model: the in-memory
 * endpoint registry (signing secret shown once through the same creation
 * receipt mechanism), the REAL event-identifier catalog, and the honest
 * delivery state (no delivery worker exists at this baseline — stated,
 * never simulated).
 *
 * Guard on direct entry (fail closed): requireConsoleRoute enforces the
 * module's allowed roles server-side (merchant only).
 */

import { consoleRouteMetadata, requireConsoleRoute } from '@/components/console/shell/console-route';
import { ConsoleModuleViewHeader } from '@/components/console/views/console-view-chrome';
import { ConsoleDeveloperWebhooksView } from '@/components/console/developers/webhooks-view';
import type { DeveloperSecretOncePanelProps } from '@/components/console/developers/api-keys-view';
import { readConsoleDeveloperWebhooks } from '@/lib/console/developers/read-models';
import { getDeveloperCreationReceiptStore } from '@/lib/console/developers/creation-receipt';
import { boundaryErrorFlag } from '@/lib/console/developers/api-boundary';

export const metadata = consoleRouteMetadata('/console/developers/webhooks');

type PageSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConsoleDevelopersWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  // Fail closed on direct entry (unauthenticated/unauthorized → redirect '/').
  const principal = await requireConsoleRoute('/console/developers/webhooks');
  const params = await searchParams;

  const receiptId = firstValue(params.receipt);
  const receipt = receiptId === undefined ? null : getDeveloperCreationReceiptStore().consume(receiptId);
  const secretOnce: DeveloperSecretOncePanelProps | null =
    receipt === null
      ? null
      : { secret: receipt.secret, targetId: receipt.targetId, kind: 'webhook-signing-secret' };

  const rawError = firstValue(params.error);
  const errorFlag = rawError === undefined ? null : boundaryErrorFlag(rawError);

  const result = readConsoleDeveloperWebhooks(principal.role);

  return (
    <article className="flex min-w-0 flex-col gap-6">
      <ConsoleModuleViewHeader
        href="/console/developers/webhooks"
        lead="Webhook endpoint ownership through the credential boundary (signing secret shown once, never logged) plus the referenceable event identifiers from the real vocabularies — and the honest delivery state: no delivery worker exists at this baseline."
      />
      <ConsoleDeveloperWebhooksView result={result} secretOnce={secretOnce} errorFlag={errorFlag} />
    </article>
  );
}
