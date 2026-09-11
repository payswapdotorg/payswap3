/**
 * UI-008 — Branches a PortFetch result into the shared presentations:
 * - fetched     → render children with the record
 * - not-visible → explicit role-check denial (deep links are role-checked)
 * - unavailable → AvailabilityUnknownState (availability is UNKNOWN; nothing
 *                 is assumed)
 *
 * Server component (hook-free): used by every role-checked detail page.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityUnknownState } from "@/components/state";
import type { PortFetch } from "@/lib/protocol/mediation-port";

export function FetchedRecordFrame<T>({
  fetch,
  recordLabel,
  children,
}: {
  fetch: PortFetch<T>;
  recordLabel: string;
  children: (record: T) => ReactNode;
}) {
  if (fetch.kind === "fetched") {
    return <>{children(fetch.record)}</>;
  }
  if (fetch.kind === "not-visible") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{recordLabel} not visible to your role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert role="alert">
            <ShieldAlert className="size-4" aria-hidden="true" />
            <AlertTitle>Deep links are role-checked</AlertTitle>
            <AlertDescription>{fetch.reason}</AlertDescription>
          </Alert>
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Return home
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{recordLabel} could not be reported</CardTitle>
      </CardHeader>
      <CardContent>
        <AvailabilityUnknownState target={fetch.target} detail={fetch.detail} />
      </CardContent>
    </Card>
  );
}
