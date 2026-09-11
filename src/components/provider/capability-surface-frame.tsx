/**
 * UI-004 — Provider surface frame.
 *
 * Structural chrome for the provider-facing capability surface. It consumes
 * the shared navigation grammar (entries resolved for the shell audience via
 * resolveNavigation) and the shared breakpoint set (Tailwind: mobile-first,
 * sm/md/lg), renders the read-only declaration of the surface, and keeps the
 * footer pinned to the bottom of the viewport (pushed down naturally when
 * content overflows).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { Eye, Landmark } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { NavAudience, NavEntry } from "@/lib/navigation";

export interface ProviderSurfaceFrameProps {
  readonly audience: NavAudience;
  readonly entries: readonly NavEntry[];
  readonly activeId?: string;
  readonly surfaceLabel: string;
  readonly surfaceDescription: string;
  readonly children: ReactNode;
}

export function ProviderSurfaceFrame({
  audience,
  entries,
  activeId,
  surfaceLabel,
  surfaceDescription,
  children,
}: ProviderSurfaceFrameProps) {
  const primaryEntries = entries.filter((entry) => entry.kind === "primary");
  const footerEntries = entries.filter((entry) => entry.kind === "footer");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#provider-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <Landmark className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="text-base font-semibold tracking-tight">
                PaySwap
              </span>
              <Badge variant="outline" className="text-muted-foreground">
                Provider surface
              </Badge>
            </div>
            <Badge variant="secondary" className="font-normal">
              Audience: {audience}
            </Badge>
          </div>
          {primaryEntries.length > 0 ? (
            <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 pb-3">
              {primaryEntries.map((entry) =>
                entry.status === "available" ? (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    aria-current={entry.id === activeId ? "page" : undefined}
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
                  >
                    {entry.label}
                  </Link>
                ) : (
                  <span
                    key={entry.id}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground/60"
                    aria-disabled="true"
                  >
                    {entry.label}
                    <Badge variant="outline" className="text-muted-foreground">
                      Planned
                    </Badge>
                  </span>
                ),
              )}
            </nav>
          ) : null}
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <Alert>
          <Eye aria-hidden="true" />
          <AlertTitle>Read-only surface</AlertTitle>
          <AlertDescription>
            {surfaceLabel} presents capability and routing truth owned by
            protocol authorities. It computes no capability, eligibility, or
            routing decision, and no control on it changes any protocol state.{" "}
            {surfaceDescription}
          </AlertDescription>
        </Alert>
      </div>

      <main
        id="provider-main"
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        {children}
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6">
          {footerEntries.length > 0 ? (
            <nav aria-label="Footer" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {footerEntries.map((entry) =>
                entry.status === "available" ? (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {entry.label}
                  </Link>
                ) : (
                  <span
                    key={entry.id}
                    className="text-xs text-muted-foreground/60"
                    aria-disabled="true"
                  >
                    {entry.label} (planned)
                  </span>
                ),
              )}
            </nav>
          ) : null}
          <p className="text-xs text-muted-foreground">
            PaySwap — provider surface · read-only presentation of protocol
            truth · mapping records: spec/product/capability-mapping-records.md
          </p>
        </div>
      </footer>
    </div>
  );
}
