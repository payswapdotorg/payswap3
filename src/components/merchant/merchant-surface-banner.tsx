/**
 * UI-003 — Merchant checkout surface.
 * src/components/merchant/merchant-surface-banner.tsx
 *
 * The shared header band for merchant checkout surfaces: role-scoping
 * declaration, authority attribution, and runtime honesty. Pure presentational
 * composition following the src/components/pay/* composition patterns.
 */

import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { CheckoutRuntimeStatus } from "@/lib/protocol/checkout-port";

export function MerchantSurfaceBanner({
  title,
  description,
  authorityOwner,
  runtime,
  currentAudience,
  backHref,
  backLabel,
}: {
  title: string;
  description?: string;
  authorityOwner: string;
  runtime: CheckoutRuntimeStatus;
  currentAudience: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <ShieldCheck aria-hidden="true" />
          Merchant surface
        </Badge>
        <Badge variant="secondary">Role-checked: merchant only</Badge>
        <Badge variant="secondary">Current audience: {currentAudience}</Badge>
        <Badge variant="destructive">Runtime: {runtime}</Badge>
        <Badge variant="destructive">
          Mock backing — NON-AUTHORITATIVE (presentation-only)
        </Badge>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm max-w-2xl">
              {description}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Checkout truth is owned by:{" "}
            <span className="text-foreground font-medium">{authorityOwner}</span>
            . This surface presents authority-reported values only — it never
            computes amounts and never applies decisions itself.
          </p>
        </div>
        {backHref ? (
          <Link
            href={backHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft aria-hidden="true" />
            {backLabel ?? "Back"}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
