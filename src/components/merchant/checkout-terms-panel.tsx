/**
 * UI-003 — Merchant checkout surface.
 * src/components/merchant/checkout-terms-panel.tsx
 *
 * The complete conditions + obligations presentation for a checkout offer.
 * Nothing decision-relevant is collapsed (P2, P3): every condition and every
 * obligation is fully expanded, in words, before any commitment control.
 * Material conditions are flagged with an explicit text badge — state is
 * never signaled by color alone (P9).
 */

import { ClipboardCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  OfferCondition,
  OfferObligation,
} from "@/lib/protocol/checkout-port";

export function CheckoutTermsPanel({
  conditions,
  obligations,
}: {
  conditions: readonly OfferCondition[];
  obligations: readonly OfferObligation[];
}) {
  return (
    <section
      aria-labelledby="checkout-terms-heading"
      className="grid gap-4"
    >
      <div className="grid gap-1">
        <h2 id="checkout-terms-heading" className="text-lg font-semibold">
          Terms of this quote — fully expanded
        </h2>
        <p className="text-muted-foreground text-sm">
          Every condition and obligation below is shown in full. Nothing
          decision-relevant is collapsed, summarized away, or hidden behind a
          control on this surface.
        </p>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Conditions — what constrains or changes this deal
        </h3>
        <ul className="grid gap-3">
          {conditions.map((condition) => (
            <li
              key={condition.id}
              className="rounded-lg border p-4 grid gap-1.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                {condition.material ? (
                  <TriangleAlert
                    aria-hidden="true"
                    className="size-4 text-amber-600"
                  />
                ) : (
                  <Info aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
                <p className="font-medium leading-snug">{condition.title}</p>
                {condition.material ? (
                  <Badge variant="outline" className="text-amber-700">
                    Material condition
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {condition.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What you commit to if you accept
        </h3>
        <ul className="grid gap-3">
          {obligations.map((obligation) => (
            <li
              key={obligation.id}
              className="rounded-lg border p-4 grid gap-1.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <ClipboardCheck aria-hidden="true" className="size-4" />
                <p className="font-medium leading-snug">{obligation.title}</p>
                <Badge variant="outline">Obligation on acceptance</Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {obligation.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
